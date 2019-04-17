// @flow
"use strict";

import type { AnalysisResults, AnalysisResult } from "./game.js";
import type { Region } from "./geometry.js";
import type { Objective, AutomatonStateID } from "./logic.js";
import type { LSS, AbstractedLSS, State } from "./system.js";

import { Polytope, Union } from "./geometry.js";
import * as linalg from "./linalg.js";
import { itemizedOperatorPartition } from "./system.js";
import { just, obj, sets, iter, ValueError, NotImplementedError } from "./tools.js";


// Positive AttrR refinement kernel: return [AttrR (good), rest (unknown)]
function refineAttrR(lss: LSS, origin: Polytope, target: Region): [Region, Region] {
    // If a control space region ensuring an exclusive transition to target
    // already exists, return origin unchanged in good part
    if (!lss.actR(origin, target).isEmpty) {
        return [origin, Polytope.ofDim(lss.dim).empty()];
    }
    // Select a control input to refine with
    const u = sampleControl(lss, origin, target);
    // Compute the Robust Attractor in origin wrt to the target region and
    // selected control input
    const attrR = (u == null) ? null : lss.attrR(origin, u, target).simplify();
    // A usable Robust Attractor is available
    if (attrR != null && !attrR.isEmpty) {
        return [attrR, origin.remove(attrR)];
    // Refinement step could not be executed, return without change in unknown
    // region (caller must decide what to do then)
    } else {
        return [Polytope.ofDim(lss.dim).empty(), origin];
    }
}

// Monte-Carlo sampling of control inputs for positive refinement
function sampleControl(lss: LSS, origin: Polytope, target: Region): ?Region {
    // Sample points from the part for the refinement control input
    // selection: start with vertices of part, and add a few random points
    // from within the polytope
    const xs = Array.from(origin.vertices);
    for (let i = 0; i < (3 * lss.dim); i++) {
        xs.push(origin.sample());
    }
    // Use ActRs of sample points wrt to target region to determine
    // a control input to refine with
    const actR = (x) => {
        const Axpw = lss.ww.translate(linalg.apply(lss.A, x));
        return target.pontryagin(Axpw).applyRight(lss.B).intersect(lss.uu);
    };
    // Intersect all control inputs with one another to find
    // a subregion that most points can use. The exponential
    // complexity of itemizedOperatorPartition makes this quite
    // expensive so a simpler clustering should be chosen if this
    // is ever applied to higher dimensions.
    const u = iter.argmax(
        _ => _.items.length,
        itemizedOperatorPartition(xs, actR).filter(_ => !_.region.isEmpty)
    );
    return (u == null) ? null : u.region.polytopes[0];
}


export class Refinery {

    +system: AbstractedLSS;
    +objective: Objective;
    +results: AnalysisResults;

    constructor(system: AbstractedLSS, objective: Objective, results: AnalysisResults): void {
        this.system = system;
        this.objective = objective;
        this.results = results;
    }

    // Partition the system states using the given refinement steps. Modifies
    // the given system partition in-place.
    partitionAll(states: Iterable<State>): Map<State, Region> {
        return new Map(iter.map(_ => [_, this.partition(_)], states));
    }

    // Implement in subclass:
    partition(x: State): Region {
        throw new NotImplementedError("Refinery must override method 'partition'");
    }

    // States that have are already decided should not be refined further
    isDecided(x: State, q: AutomatonStateID): boolean {
        return !this.getResult(x).maybe.has(q);
    }

    // Convenience accessors

    getStates(which: "yes"|"no"|"maybe", q: AutomatonStateID): Iterable<State> {
        return iter.filter((state) => this.getResult(state)[which].has(q), this.system.states.values());
    }

    getStateRegion(which: "yes"|"no"|"maybe", q: AutomatonStateID): Region {
        return this.asRegion(this.getStates(which, q));
    }

    // States that have a transition from q to qTarget (only inner states)
    getTransitionStates(qTarget: AutomatonStateID, q: AutomatonStateID): Iterable<State> {
        const origin = this.objective.getState(q);
        return iter.filter(
            (state) => (!state.isOuter && this.qNext(state, q) === qTarget),
            this.system.states.values()
        );
    }

    getTransitionRegion(qTarget: AutomatonStateID, q: AutomatonStateID): Region {
        return this.asRegion(this.getTransitionStates(qTarget, q));
    }

    getResult(x: State): AnalysisResult {
        return just(this.results.get(x.label));
    }

    getEmpty(): Region {
        return Polytope.ofDim(this.system.lss.dim).empty();
    }

    asRegion(xs: Iterable<State>): Region {
        const polys = [];
        for (let x of xs) {
            polys.push(x.polytope);
        }
        return polys.length === 0 ? this.getEmpty() : Union.from(polys).simplify();
    }
    
    qNext(x: State, q: AutomatonStateID): ?AutomatonStateID {
        return this.objective.nextState(x.predicates, q);
    }

}


/* Negative Attractor refinement */

export class NegativeAttrRefinery extends Refinery {

    +_attr: { [AutomatonStateID]: Region };

    constructor(system: AbstractedLSS, objective: Objective, results: AnalysisResults): void {
        super(system, objective, results);
        const lss = this.system.lss;
        // Cache attractors of no-regions for target qs
        this._attr = obj.fromMap(q => {
            const no = this.getStateRegion("no", q);
            return lss.attr(lss.xx, lss.uu, no).simplify();
        }, objective.allStates);
    }

    partition(x: State): Region {
        let parts = x.polytope;
        for (let q of this.objective.allStates) {
            // Only refine undecided, state that aren't dead-ends
            const qNext = this.qNext(x, q);
            if (this.isDecided(x, q) || qNext == null) {
                continue;
            }
            // Partition with Attractor of target q no-region
            let newParts = this.getEmpty();
            for (let part of parts.polytopes) {
                const attr = part.intersect(this._attr[qNext]).simplify();
                if (attr.isEmpty) {
                    newParts = newParts.union(part);
                } else {
                    newParts = newParts.union(attr).union(part.remove(attr).simplify());
                }
            }
            parts = newParts;
        }
        return parts;
    }

}


/* Safety refinement */

export class SafetyRefinery extends Refinery {

    +_no: { [AutomatonStateID]: Region };
    +_ok: { [AutomatonStateID]: Region };

    constructor(system: AbstractedLSS, objective: Objective, results: AnalysisResults): void {
        super(system, objective, results);
        const lss = this.system.lss;
        // Cache unsafe regions for target qs
        this._no = obj.fromMap(q => this.getStateRegion("no", q).simplify(), objective.allStates);
        // Cache safe regions for target qs
        this._ok = obj.map((q, no) => system.lss.xx.remove(no).simplify(), this._no);
    }

    partition(x: State): Region {
        const lss = this.system.lss;
        let parts = x.polytope;
        for (let q of this.objective.allStates) {
            // Only refine undecided, state that aren't dead-ends
            const qNext = this.qNext(x, q);
            if (this.isDecided(x, q) || qNext == null) {
                continue;
            }
            let newParts = this.getEmpty();
            for (let part of parts.polytopes) {
                const [safe, other] = refineAttrR(lss, part, this._ok[qNext]);
                newParts = newParts.union(safe).union(other);
            }
            parts = newParts;
        }
        return parts;
    }

}


/* Self-Loop removal refinement */

export class SelfLoopRefinery extends Refinery {

    // Settings
    +optimistic: boolean;
    +onlySafe: boolean;
    // Caches
    +_noStates: { [AutomatonStateID]: Set<State> };

    constructor(system: AbstractedLSS, objective: Objective, results: AnalysisResults,
                optimistic: boolean, onlySafe: boolean): void {
        super(system, objective, results);
        this.optimistic = optimistic;
        this.onlySafe = onlySafe;
        // Cache ... TODO
        this._noStates = obj.fromMap(q => new Set(this.getStates("no", q)), objective.allStates);
    }

    partition(x: State): Region {
        // Quick geometric test if self-loop is possible
        if (x.post(this.system.lss.uu).intersect(x.polytope).isEmpty) {
            return x.polytope;
        }
        for (let q of this.objective.allStates) {
            // Only refine undecided, state that aren't dead-ends
            const qNext = this.qNext(x, q);
            if (this.isDecided(x, q) || qNext == null) {
                continue;
            }
            // Examine actions: try to find an action that has no self-loop and
            // and an action that has a self-loop
            let goodAction = null;
            let support = null;
            for (let action of x.actions) {
                const targetsSelf = action.targets.has(x);
                // If only safe actions should be considered, ignore the action
                // if it is not
                if (!this.onlySafe || this._isSafe(action.targets, qNext)) {
                    // If the action does not self-target, it cannot have
                    // a self-loop
                    if (!targetsSelf) {
                        goodAction = action;
                    } else {
                        // Find a self-loop in the player 2 actions
                        let selfLoopSupport = null;
                        for (let support of action.supports) {
                            if (support.targets.size === 1 && support.targets.has(x)) {
                                selfLoopSupport = support;
                                break; // exit loop over supports
                            }
                        }
                        // No self-loop found
                        if (selfLoopSupport == null) {
                            goodAction = action;
                        // Self-loop found, this action/support combination is
                        // suitable for refinement
                        } else {
                            support = selfLoopSupport;
                            break; // exit loop over actions
                        }
                    }
                }
            }
            // If refinement is optimistic and a non-self-looping action was
            // found, continue. Otherwise partition the state if an
            // action/support combination for refinement was found.
            if (!(this.optimistic && goodAction != null) && support != null) {
                // Split with PreP associated with the action support
                const preP = support.origins.simplify();
                return preP.union(x.polytope.remove(preP).simplify());
            }
        }
        // No suitable action/support combination was found for refinement
        return x.polytope;
    }

    _isSafe(targets: Set<State>, q: AutomatonStateID): boolean {
        return !sets.doIntersect(targets, this._noStates[q]);
    }

}



/* Layer-based refinement procedures */

// Polytopic operator from which the layers are iteratively generated
export type LayerRefineryGenerator = "PreR" | "Pre";
// Which layers participate in the refinement (inclusive range)
export type LayerRefineryRange = [number, number];
// Settings object
export type LayerRefinerySettings = {
    origin: AutomatonStateID,
    target: AutomatonStateID,
    generator: LayerRefineryGenerator,
    scaling: number,
    range: LayerRefineryRange,
    iterations: number,
    // Modifiers with default = false
    expandSmallTarget?: boolean,
    invertTarget?: boolean,
    dontRefineSmall?: boolean
};

export class LayerRefinery extends Refinery {

    +settings: LayerRefinerySettings;
    +layers: Region[];

    constructor(system: AbstractedLSS, objective: Objective, results: AnalysisResults,
                settings: LayerRefinerySettings): void {
        super(system, objective, results);
        this.settings = settings;
        // Settings sanity checks
        if (settings.range[0] < 0 || settings.range[1] < settings.range[0]) throw new ValueError(
            "settings.range = [" + settings.range.join(", ") + "] is invalid"
        );
        // States already known to be non-satisfying (e.g. due to a safety
        // objective) are removed from the layers as they should not be
        // targeted
        const noRegion = this.getStateRegion("no", settings.origin).simplify();
        // Target region
        let target = this.getTransitionRegion(settings.target, settings.origin);
        // Invert target region if desired
        if (this.settings.invertTarget === true) {
            target = system.lss.xx.remove(target);
        }
        // If the target region is small, expand (if desired) such that
        // pontragin with ww is guaranteed to exist (required for PreR)
        if (this.settings.expandSmallTarget === true && target.pontryagin(system.lss.ww).isEmpty) {
            const wwTrans = system.lss.ww.translate(system.lss.ww.centroid.map(_ => -_));
            target = target.minkowski(wwTrans).intersect(system.lss.xx);
        }
        // Iteratively generate layers starting from target
        const layer0 = target.remove(noRegion).simplify();
        this.layers = [layer0];
        for (let i = 1; i <= settings.range[1]; i++) {
            // Target of next layer is previous layer
            const previous = this.layers[this.layers.length - 1];
            const layer = this._generateLayer(previous).remove(noRegion).simplify();
            this.layers.push(layer);
        }
    }

    get _dontRefineSmall(): boolean {
        return this.settings.dontRefineSmall === true;
    }

    _generateLayer(target: Region): Region {
        const lss = this.system.lss;
        const uu = lss.uu.scale(this.settings.scaling);
        switch (this.settings.generator) {
            case "PreR":
                return lss.preR(lss.xx, uu, target);
            case "Pre":
                return lss.pre(lss.xx, uu, target);
            default:
                throw new NotImplementedError(
                    "layer generator '" + this.settings.generator + "' does not exist"
                );
        }
    }

    partition(x: State): Region {
        // Only refine maybe states
        const q = this.settings.origin;
        if (this.isDecided(x, q) || this.qNext(x, q) == null) {
            return x.polytope;
        }
        const lss = this.system.lss;
        const [start, end] = this.settings.range;
        // Remove inner target for all layers > 0.  Layer 0 is special to
        // enable self-targeting for safety objectives and expanded targets.
        let done = start === 0
                 ? this.getEmpty()
                 : x.polytope.intersect(this.layers[start - 1]).simplify();
        // Refine rest
        let rest = x.polytope.remove(done).simplify();
        // For every active layer:
        for (let i = start; i <= end; i++) {
            // Return if nothing remains to be refined
            if (rest.isEmpty) return done;
            // Target this (0th layer targets itself):
            const target = this.layers[Math.max(0, i - 1)];
            // Refine this:
            const intersection = rest.intersect(this.layers[i]).simplify();
            // Initialize queue of remaining polytopes with intersection
            // polytopes (iteration 0)
            const remaining = intersection.polytopes.map(_ => [_, 0]);
            while (remaining.length > 0) {
                const [part, it] = remaining.shift();
                // If iteration count exceeds limit, don't refine the part
                if (it >= this.settings.iterations) {
                    done = done.union(part);
                    continue;
                }
                // If there are control inputs that lead exclusively to the
                // target, add to decided collection, continue
                const uRobust = lss.actR(part, target);
                if (!uRobust.isEmpty) {
                    done = done.union(part);
                    continue;
                }
                // If part cannot be targeted individually (and is therefore
                // guaranteed to have no self-loop), add to decided parts
                if (this._dontRefineSmall && part.pontryagin(lss.ww).isEmpty) {
                    done = done.union(part);
                    continue;
                }
                // AttrR refinement step
                const [good, other] = refineAttrR(lss, part, target);
                // Fallback if refinement failed: shatter polytope
                if (good.isEmpty) {
                    remaining.push(...other.shatter().polytopes.map(_ => [_, it + 1]));
                } else {
                    done = done.union(good);
                    remaining.push(...other.polytopes.map(_ => [_, it + 1]));
                }
            }
            // Entire layer is considered as done
            rest = rest.remove(intersection).simplify();
        }
        return done.union(rest);
    }

}

