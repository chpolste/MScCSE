// @flow
"use strict";

import type { AnalysisResults, AnalysisResult } from "./game.js";
import type { Region } from "./geometry.js";
import type { Objective, AutomatonStateID } from "./logic.js";
import type { LSS, AbstractedLSS, State } from "./system.js";

import { Polytope, Union } from "./geometry.js";
import * as linalg from "./linalg.js";
import { itemizedOperatorPartition } from "./system.js";
import { just, iter, ValueError, NotImplementedError } from "./tools.js";


// Positive AttrR refinement kernel: return [AttrR, rest]
function refineAttrR(lss: LSS, origin: Polytope, target: Region): [Region, Region] {
    // Select a control input to refine with
    const u = sampleControl(lss, origin, target);
    // Compute the Robust Attractor in origin wrt to the target region and
    // selected control input
    const attrR = (u == null) ? null : lss.attrR(origin, u, target).simplify();
    // A usable Robust Attractor is available
    if (attrR != null && !attrR.isEmpty) {
        return [attrR, origin.remove(attrR)];
    // Refinement step could not be executed, fallback: shatter the origin
    } else {
        return [Polytope.ofDim(lss.dim).empty(), origin.shatter()];
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
    return (u == null) ? null : u.region;
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

export type NegativeAttrRefinerySettings = {
    origin: AutomatonStateID,
    iterations: number,
    simplify?: boolean
};

export class NegativeAttrRefinery extends Refinery {

    +settings: NegativeAttrRefinerySettings;
    +_attrs: Region[];

    constructor(system: AbstractedLSS, objective: Objective, results: AnalysisResults,
                settings: NegativeAttrRefinerySettings): void {
        super(system, objective, results);
        const lss = system.lss;
        // Settings required later for origin and simplify
        this.settings = settings;
        // Start with no-region of given origin as target
        let no = this.getStateRegion("no", settings.origin);
        // Cache attractors for given number of iterations
        this._attrs = [];
        for (let i = 0; i < settings.iterations; i++) {
            // Attr of no-region in the state space
            const attr = lss.attr(lss.xx, lss.uu, no).simplify();
            this._attrs.push(attr);
            // If Attr has converged, stop
            const added = attr.remove(no);
            if (added.isEmpty) break;
            // Extend no-region with latest Attr
            no = no.union(added);
        }
    }

    partition(x: State): Region {
        // Only refine maybe states
        if (this.isDecided(x, this.settings.origin)) {
            return x.polytope;
        }
        // Remove Attr layers
        let done = this.getEmpty();
        let rest = x.polytope;
        for (let attr of this._attrs) {
            const cut = rest.intersect(attr).simplify();
            if (!cut.isEmpty) {
                done = done.union(cut);
                if (this.settings.simplify === true) {
                    // TODO
                    done = done.simplify();
                }
                rest = rest.remove(cut).simplify();
            }
        }
        return rest.union(done);
    }

}


/* Safety refinement */

export type SafetyRefinerySettings = {
    origin: AutomatonStateID,
    iterations: number
}

export class SafetyRefinery extends Refinery {

    +settings: SafetyRefinerySettings;
    +_no: Region;
    +_ok: Region;

    constructor(system: AbstractedLSS, objective: Objective, results: AnalysisResults,
                settings: SafetyRefinerySettings): void {
        super(system, objective, results);
        // Settings required later for origin and simplify
        this.settings = settings;
        // Cache no-region and its complement
        this._no = this.getStateRegion("no", settings.origin).simplify();
        this._ok = system.lss.xx.remove(this._no).simplify();
    }

    partition(x: State): Region {
        // Only refine maybe states
        if (this.isDecided(x, this.settings.origin)) {
            return x.polytope;
        }
        const lss = this.system.lss;
        const maxIter = this.settings.iterations;
        // Refine partition until all polytopes are safe or max number of
        // iterations is exceeded
        const done = [];
        const rest = [[x.polytope, 0]];
        while (rest.length > 0) {
            const [poly, iter] = rest.pop();
            // State is unsafe if for every possible control input the
            // probability of reaching the no-region after one step is non-zero
            const act = lss.act(poly, this._no);
            if (iter < maxIter && act.isSameAs(lss.uu)) {
                // Positive refinement wrt complement of no-region
                const [safe, other] = refineAttrR(lss, poly, this._ok);
                // Push pices into rest with increased iteration counter
                done.push(...safe.polytopes);
                rest.push(...other.polytopes.map(_ => [_, iter + 1]));
            } else {
                done.push(poly);
            }
        }
        return Union.from(done);
    }

}


/* Self-Loop removal refinement */

export type SelfLoopRefinerySettings = {
    origin: AutomatonStateID,
    iterations: number
}

export class SelfLoopRefinery extends Refinery {

    +settings: SelfLoopRefinerySettings;

    constructor(system: AbstractedLSS, objective: Objective, results: AnalysisResults,
                settings: SelfLoopRefinerySettings): void {
        super(system, objective, results);
        // Settings required later for origin and simplify
        this.settings = settings;
    }

    partition(x: State): Region {
        // Only refine maybe states
        if (this.isDecided(x, this.settings.origin)) {
            return x.polytope;
        }
        const lss = this.system.lss;
        const post = x.post(lss.uu).intersect(x.polytope);
        if (!post.pontryagin(lss.ww).isEmpty) {
            // TODO smarter refinement than shatter
            return x.polytope.shatter();
        } else {
            return x.polytope;
        }
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
                done = done.union(good);
                remaining.push(...other.polytopes.map(_ => [_, it + 1]));
            }
            // Entire layer is considered as done
            rest = rest.remove(intersection).simplify();
        }
        return done.union(rest);
    }

}

