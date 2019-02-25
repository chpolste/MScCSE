// @flow
"use strict";

import type { AnalysisResults, AnalysisResult } from "./game.js";
import type { Region } from "./geometry.js";
import type { Objective, AutomatonStateLabel } from "./logic.js";
import type { AbstractedLSS, State } from "./system.js";

import { Polytope, Union } from "./geometry.js";
import { iter, NotImplementedError } from "./tools.js";


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

    getStates(which: "yes"|"no"|"maybe", q: AutomatonStateLabel): Iterable<State> {
        return iter.filter((state) => this.getResult(state)[which].has(q), this.system.states.values());
    }

    getStateRegion(which: "yes"|"no"|"maybe", q: AutomatonStateLabel): Region {
        return this.asRegion(this.getStates(which, q));
    }

    getTransitionStates(qTarget: AutomatonStateLabel, q: AutomatonStateLabel): Iterable<State> {
        const origin = this.objective.getState(q);
        const target = this.objective.getState(qTarget);
        return iter.filter((state) => {
            const valuation = this.objective.valuationFor(state.predicates);
            return origin.successor(valuation) === target;
        }, this.system.states.values());
    }

    getTransitionRegion(qTarget: AutomatonStateLabel, q: AutomatonStateLabel): Region {
        return this.asRegion(this.getTransitionStates(qTarget, q));
    }

    getResult(x: State): AnalysisResult {
        const result = this.results.get(x.label);
        if (result == null) throw new Error("TODO477"); // TODO
        return result;
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
    
    qNext(x: State, q: AutomatonStateLabel): ?AutomatonStateLabel {
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
    q: AutomatonStateLabel,
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
            "Attr-": NegAttrRefinery,
            "AttrR+": PosAttrRRefinery
        };
    }

}

// Remove attractor of non-satisfying states
export class NegAttrRefinery extends StateRefinery {

    partition(x: State): Region {
        const q = this.settings.q;
        // Refine wrt next automaton state
        const qNext = this.qNext(x, q);
        // Only refine maybe states
        if (!this.getResult(x).maybe.has(q) || qNext == null) {
            return x.polytope;
        }
        // Use entire control space
        const u = this.system.lss.uus;
        // Attractor set of "no" states is guaranteed to be part of the "no"
        // region
        const neg = Array.from(this.getStates("no", qNext));
        const attr = this._approximate(x.attr(u, neg));
        const rest = x.polytope.remove(attr).simplify();
        return attr.union(rest);
    }

}

// Case 1 of the Positive AttrR refinement from Svorenova et al. (2017)
export class PosAttrRRefinery extends StateRefinery {

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


/* (Global) layer-based refinement procedures */

// Target region
export type LayerRefineryTarget = "__yes" | "__no" | AutomatonStateLabel;
// Polytopic operator from which the layers are iteratively generated
export type LayerRefineryGenerator = "PreR" | "Pre";
// Which layers participate in the refinement (inclusive range)
export type LayerRefineryRange = [number, number];
// How many generations of refinement are executed?
export type LayerRefineryGenerations = number;
// Settings object
export type LayerRefinerySettings = {
    origin: AutomatonStateLabel,
    target: LayerRefineryTarget,
    generator: LayerRefineryGenerator,
    range: LayerRefineryRange,
    generations: LayerRefineryGenerations
};

export class LayerRefinery extends Refinery {

    +settings: LayerRefinerySettings;
    +layers: Region[];

    constructor(system: AbstractedLSS, objective: Objective, results: AnalysisResults,
                settings: LayerRefinerySettings): void {
        super(system, objective, results);
        this.settings = settings; // TODO: value sanity checks (e.g. range start > 0, ...)
        // Target region
        let target;
        if (settings.target === "__yes") {
            target = this.getStateRegion("yes", settings.origin);
        } else if (settings.target === "__no") {
            target = this.getStateRegion("no", settings.origin);
        } else {
            target = this.getTransitionRegion(settings.target, settings.origin);
        }
        // Iteratively generate layers starting from target
        this.layers = [target];
        for (let i = 0; i <= settings.range[1]; i++) {
            // Target of next layer is previous layer
            const previous = this.layers[this.layers.length - 1];
            this.layers.push(this._generateLayer(previous).simplify());
        }
    }

    _generateLayer(target: Region): Region {
        const lss = this.system.lss;
        switch (this.settings.generator) {
            case "PreR":
                return lss.preR(lss.xx, lss.uus, target);
            case "Pre":
                return lss.pre(lss.xx, lss.uus, target);
            default:
                throw new NotImplementedError(
                    "layer generator '" + this.settings.generator + "' does not exist"
                );
        }
    }

    partition(x: State): Region {
        const [start, end] = this.settings.range;
        // Remove inner target
        let done = x.polytope.intersect(this.layers[start - 1]).simplify();
        // Refine rest
        let rest = x.polytope.remove(done).simplify();
        // For every active layer:
        for (let i = start; i <= end; i++) {
            // Return if nothing remains to be refined
            if (rest.isEmpty) return done;
            // Refine this:
            const intersection = rest.intersect(this.layers[i]).simplify();
            // TODO: priority queue, generations
            // Set up priority queue of not-decided parts (first out are largest polys, initial elements: intersection polytopes gen0)
            let queue = [...intersection.polytopes];
            while (queue.length > 0) {
                const part = queue.pop();
                // TODO: if generation of part is >= final generation: add part to decided collection, continue
                // TODO: compute action polytope to target
                // TODO: shatter this action polytope, for every part do:
                    // compute the robust attractor wrt the target region
                    // -> pick the action polytope part that decides the largest area of the origin polytope
                // TODO: split the not-decided part: put AttrR into decided collection, rest into queue. Increase generation count of all parts.
                done = done.union(part);
            }
            // Entire layer is considered as done
            rest = rest.remove(intersection).simplify();
        }
        return done.union(rest);
    }

}

