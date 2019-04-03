// @flow
"use strict";

import type { AnalysisResults, AnalysisResult } from "./game.js";
import type { Region } from "./geometry.js";
import type { Objective, AutomatonStateID } from "./logic.js";
import type { AbstractedLSS, State } from "./system.js";

import { Polytope, Union } from "./geometry.js";
import * as linalg from "./linalg.js";
import { just, iter, ValueError, NotImplementedError } from "./tools.js";


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
        throw new NotImplementedError();
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

    static valueControl(x: State, control: Region, reach: Region, avoid: Region, weights: [number, number, number]): number {
        const post = x.post(control);
        const postVol = post.volume;
        const ratioReach = reach.intersect(post).volume / postVol;
        const ratioAvoid = reach.intersect(post).volume / postVol;
        const ratioOther = 1 - ratioReach - ratioAvoid;
        // Weighted linear combination of intersection ratios
        const [wReach, wAvoid, wOther] = weights;
        return wReach * ratioReach + wAvoid * ratioAvoid + wOther * ratioOther;
    }

}


/* Local (state-based) refinement procedures */

export type StateRefineryApproximation = "none" | "hull";
export type StateRefinerySettings = {
    q: AutomatonStateID,
    approximation: StateRefineryApproximation
};


export class StateRefinery extends Refinery {

    +settings: StateRefinerySettings;

    constructor(system: AbstractedLSS, objective: Objective, results: AnalysisResults,
                settings: StateRefinerySettings): void {
        super(system, objective, results);
        this.settings = settings;
    }

    _approximate(r: Region): Region {
        if (this.settings.approximation === "hull") return r.hull();
        return r.simplify();
    }

    static builtIns(): { [string]: Class<StateRefinery> } {
        return {
            "Attr-": NegAttrStateRefinery,
            "AttrR+": PosAttrRStateRefinery
        };
    }

}

// Remove attractor of non-satisfying states
export class NegAttrStateRefinery extends StateRefinery {

    partition(x: State): Region {
        const q = this.settings.q;
        // Refine wrt next automaton state
        const qNext = this.qNext(x, q);
        // Only refine maybe states
        if (!this.getResult(x).maybe.has(q) || qNext == null) {
            return x.polytope;
        }
        // Use entire control space
        const u = this.system.lss.uu;
        // Attractor set of "no" states is guaranteed to be part of the "no"
        // region
        const neg = Array.from(this.getStates("no", qNext));
        const attr = this._approximate(x.attr(u, neg));
        const rest = x.polytope.remove(attr).simplify();
        return attr.union(rest);
    }

}

// Case 1 of the Positive AttrR refinement from Svorenova et al. (2017)
export class PosAttrRStateRefinery extends StateRefinery {

    partition(x: State): Region {
        const q = this.settings.q;
        // Refine wrt next automaton state
        const qNext = this.qNext(x, q);
        // Only refine maybe states
        if (!this.getResult(x).maybe.has(q) || qNext == null) {
            return x.polytope;
        }
        // Estimate which action is "best" by looking at the overlap of each
        // action's posterior with yes/maybe/no states.
        const reach = this.getStateRegion("yes", qNext);
        const avoid = this.getStateRegion("no", qNext);
        // Look for most overlap with yes targets
        const action = iter.argmax(
            _ => Refinery.valueControl(x, _.controls, reach, avoid, [10, -1, 1]),
            x.actions
        );
        if (action == null) return x.polytope;
        // Robust Attractor set of yes states is guaranteed to be part of the
        // "yes" region
        const yes = Array.from(this.getStates("yes", qNext));
        const attrR = (u) => x.attrR(u, yes);
        // Subdivide action polytope into smaller parts and find best part to
        // refine with (largest AttrR)
        let done = iter.argmax(
            _ => _.volume,
            action.controls.shatter().polytopes.map(attrR)
        );
        if (done == null) return x.polytope;
        done = this._approximate(done);
        const rest = x.polytope.remove(done).simplify();
        return done.union(rest);
    }

}



/* Global Negative Attr refinement */

export type OuterAttrRefinerySettings = {
    iterations: number
};

export class OuterAttrRefinery extends Refinery {

    +_attr: Region;

    constructor(system: AbstractedLSS, objective: Objective, results: AnalysisResults,
                settings: OuterAttrRefinerySettings): void {
        super(system, objective, results);
        const lss = system.lss;
        const iterations = settings.iterations;
        const outer = this.asRegion(iter.filter(_ => _.isOuter, this.system.states.values()));
        // Precompute Attractor of outer states in entire system
        let attr = this.getEmpty();
        for (let i = 0; i < iterations; i++) {
            attr = lss.attr(lss.xx, lss.uu, attr.union(outer)).simplify();
        }
        this._attr = attr;
    }

    partition(x: State): Region {
        const attr = x.polytope.intersect(this._attr).simplify();
        const rest = x.polytope.remove(attr).simplify();
        return attr.union(rest);
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
        if (settings.range[0] < 1 || settings.range[1] < settings.range[0]) throw new ValueError(
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
        for (let i = 0; i <= settings.range[1]; i++) {
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
        if (!this.getResult(x).maybe.has(q) || this.qNext(x, q) == null) {
            return x.polytope;
        }
        const lss = this.system.lss;
        const [start, end] = this.settings.range;
        // Remove inner target
        let done = x.polytope.intersect(this.layers[start - 1]).simplify();
        // Refine rest
        let rest = x.polytope.remove(done).simplify();
        // For every active layer:
        for (let i = start; i <= end; i++) {
            // Return if nothing remains to be refined
            if (rest.isEmpty) return done;
            // Target this:
            const target = this.layers[i - 1];
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
                // Sample points from the part for the refinement control input
                // selection: start with vertices of part, and add a few random
                // points from within the polytope
                const zs = Array.from(part.vertices);
                for (let j = 0; j < (10 * lss.dim); j++) {
                    zs.push(part.sample());
                }
                // Find control input clusters based on sampled points
                const us = [];
                for (let z of zs) {
                    // Compute robust action of origin point
                    const Axpw = lss.ww.translate(linalg.apply(lss.A, z));
                    const u = target.pontryagin(Axpw).applyRight(lss.B).intersect(lss.uu);
                    if (u.isEmpty) continue;
                    // Merge with (first) overlapping cluster, reduce cluster
                    // to intersection of both
                    let k = 0;
                    while (k < us.length) {
                        const uu = us[k].intersect(u);
                        if (!uu.isEmpty) {
                            us[k] = uu;
                            break;
                        }
                        k++;
                    }
                    // No overlapping cluster found, create new one
                    if (k >= us.length) {
                        us.push(u);
                    }
                }
                // Refine with largest AttrR based on control input clusters
                let attrR = iter.argmax(
                    _ => _.volume,
                    us.map((u) => lss.attrR(part, u, target))
                );
                // If a non-empty AttrR exists, split part: put the AttrR into
                // the decided collection, the rest into the queue. Increase
                // iteration count of all parts.
                if (attrR != null && !attrR.isEmpty) {
                    attrR = attrR.simplify();
                    done = done.union(attrR);
                    remaining.push(...part.remove(attrR).polytopes.map(_ => [_, it + 1]));
                // No usable action found, just shatter polytope and hope for
                // the best in the next iteration.
                } else {
                    remaining.push(...part.shatter().polytopes.map(_ => [_, it + 1]));
                }
            }
            // Entire layer is considered as done
            rest = rest.remove(intersection).simplify();
        }
        return done.union(rest);
    }

}

