// @flow
"use strict";

import type { AnalysisResults, AnalysisResult } from "./game.js";
import type { Region } from "./geometry.js";
import type { Objective, AutomatonStateLabel } from "./logic.js";
import type { AbstractedLSS, State } from "./system.js";

import { Polytope, Union } from "./geometry.js";
import { iter, NotImplementedError } from "./tools.js";


// After every refinement step, the partition is divided into "done" and "rest"
// parts. The former will not be refined further by subsequent refinement
// steps, while the latter might be.
export type RefinementPartition = { done: Region, rest: Region };

// ...
export type RefineryApproximation = "none" | "target" | "after";
export type RefinerySettings = {
    approximation: RefineryApproximation
};



function valueControl(x: State, control: Region, reach: Region, avoid: Region, weights: [number, number, number]): number {
    const post = x.post(control);
    const postVol = post.volume;
    const ratioReach = reach.intersect(post).volume / postVol;
    const ratioAvoid = reach.intersect(post).volume / postVol;
    const ratioOther = 1 - ratioReach - ratioAvoid;
    // Weighted linear combination of intersection ratios
    const [wReach, wAvoid, wOther] = weights;
    return wReach * ratioReach + wAvoid * ratioAvoid + wOther * ratioOther;
}


export class Refinery {

    +q: AutomatonStateLabel;
    +system: AbstractedLSS;
    +objective: Objective;
    +results: AnalysisResults;
    +settings: RefinerySettings;

    constructor(system: AbstractedLSS, objective: Objective, results: AnalysisResults,
                settings: RefinerySettings, q: AutomatonStateLabel): void {
        this.q = q;
        this.system = system;
        this.objective = objective;
        this.results = results;
        this.settings = settings;
        // Subclasses could override the constructor but due to the many
        // arguments, a separate initialization method seems cleaner. Subclass
        // properties cannot be declared readonly because of this though...
        this.initialize();
    }

    // Partition the system states using the given refinement steps. Modifies
    // the given system partition in-place.
    static execute(steps: Refinery[], partitions: Map<State, Region>): void {
        // Apply all refinement steps for every system state (automaton state
        // is baked into the refinement steps)
        for (let [x, rest] of partitions) {
            // Partition elements can be marked as "done" in a refinement step
            // and will not be modified further by subsequent steps
            let done = Union.empty(rest.dim);
            for (let step of steps) {
                // Only refine maybe states
                if (!step.requiresRefinement(x)) continue;
                const partition = step.partition(x, rest);
                // null-return: refinery does not want to partition the state
                if (partition == null) continue;
                // Collect parts
                done = partition.done.union(done);
                rest = partition.rest;
                // Nothing left to refine?
                if (rest.isEmpty) break;
            }
            // Assign new partition. For other qs, rest is reset to cover the
            // entire state polytope. Parts marked as done in this automaton
            // state will generally not also be done in another.
            partitions.set(x, rest.union(done));
        }
    }

    // Collection of built-in refineries for module export
    static builtIns(): { [string]: Class<Refinery> } {
        return {
            "Negative Attractor": NegativeAttrRefinery,
            "Positive Robust Predecessor": PositivePreRRefinery,
            "Positive Robust Attractor": PositiveAttrRRefinery
        };
    }

    // Approximation helpers

    approximate(r: Region, what: RefineryApproximation): Region {
        return (this.settings.approximation === what) ? r.hull() : r;
    }

    // Convenience accessors

    requiresRefinement(x: State): boolean {
        return this.getResult(x).maybe.has(this.q);
    }

    getStates(which: "yes"|"no"|"maybe", q: AutomatonStateLabel): Iterable<State> {
        return iter.filter((state) => this.getResult(state)[which].has(q), this.system.states.values());
    }

    getStateRegion(which: "yes"|"no"|"maybe", q: AutomatonStateLabel): Region {
        return this.asRegion(this.getStates(which, q));
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
        return polys.length === 0 ? this.getEmpty() : Union.from(polys);
    }
    
    qNext(x: State): ?AutomatonStateLabel {
        return this.objective.nextState(x.predicates, this.q);
    }

    // Implement in subclass

    // Global computations necessary for the refinement that is called once
    // during construction of the refinery.
    initialize(): void {
        // If no initialization is needed, this can be left empty
    }

    // Refine the region rest, which is a partition of state x
    partition(x: State, rest: Region): ?RefinementPartition {
        throw new NotImplementedError();
    }

}


/* Refinement procedures */

// Remove Attractor of non-satisfying states
class NegativeAttrRefinery extends Refinery {

    attr: Map<AutomatonStateLabel, Region>;

    initialize(): void {
        // Precompute attractor of "no" states for every q
        this.attr = new Map();
        const lss = this.system.lss;
        for (let q of this.objective.allStates) {
            const target = this.approximate(this.getStateRegion("no", q), "target");
            this.attr.set(q, lss.attr(lss.xx, lss.uus, target).simplify());
        }
    }

    partition(x: State, rest: Region): ?RefinementPartition {
        // Refine wrt to next automaton state
        const qNext = this.qNext(x);
        if (qNext == null) return null;
        // Cut attractor of "no" region out of state
        const attr = this.attr.get(qNext);
        if (attr == null) throw new Error("NAR2"); // TODO
        const done = this.approximate(attr, "after").intersect(rest).simplify();
        rest = rest.remove(done).simplify();
        // Progress guarantee, don't refine the attr further
        return { done: done, rest: rest };
    }

}

// TODO: all following positive refinement methods only work for co-safe
// reachability/avoidance problems because they target yes-states. Instead,
// they should target states that enable an automaton transition in general.

// Robust Predecessor of satisfying states
class PositivePreRRefinery extends Refinery {

    preR: Map<AutomatonStateLabel, Region>;

    initialize(): void {
        // Precompute robust predecessor of "yes" states for every q
        this.preR = new Map();
        const lss = this.system.lss;
        for (let q of this.objective.allStates) {
            const target = this.approximate(this.getStateRegion("yes", q), "target");
            this.preR.set(q, lss.preR(lss.xx, lss.uus, target).simplify());
        }
    }

    partition(x: State, rest: Region): ?RefinementPartition {
        // Refine wrt to next automaton state
        const qNext = this.qNext(x);
        if (qNext == null) return null;
        // Cut robust predecessor of "yes" region out of state
        const preR = this.preR.get(qNext);
        if (preR == null) throw new Error("NAR2"); // TODO
        const done = this.approximate(preR, "after").intersect(rest).simplify();
        rest = rest.remove(done).simplify();
        // No progress guarantee, everything can be refined further
        return { done: this.getEmpty(), rest: done.union(rest) };
    }

}

// Case 1 of the Positive AttrR refinement from Svorenova et al. (2017)
class PositiveAttrRRefinery extends Refinery {

    yes: Map<AutomatonStateLabel, Region>;

    initialize(): void {
        // Precompute target region ("yes" states) for every q
        this.yes = new Map();
        for (let q of this.objective.allStates) {
            const target = this.approximate(this.getStateRegion("yes", q), "target");
            this.yes.set(q, target.simplify());
        }
    }

    partition(x: State, rest: Region): ?RefinementPartition {
        // Refine wrt to next automaton state
        const qNext = this.qNext(x);
        if (qNext == null) return null;
        const target = this.yes.get(qNext);
        if (target == null || target.isEmpty) return null;
        // Choose an action for refining with
        if (x.actions.length === 0) return null;
        // Estimate which action is "best" by looking at the overlap of each
        // action's posterior with yes/maybe/no states.
        const reach = this.getStateRegion("yes", qNext);
        const avoid = this.getStateRegion("no", qNext);
        // Look for most overlap with yes targets
        const action = iter.argmax(
            _ => valueControl(x, _.controls, reach, avoid, [10, -1, 1]),
            x.actions
        );
        if (action == null) return null;
        // Subdivide action polytope into smaller parts and find best part to
        // refine with (largest AttrR)
        const lss = this.system.lss;
        const attrR = (u) => lss.attrR(x.polytope, u, target).intersect(rest);
        let done = iter.argmax(
            _ => _.volume,
            action.controls.shatter().polytopes.map(attrR)
        );
        if (done == null) return null;
        done = this.approximate(done, "after").simplify();
        rest = rest.remove(done).simplify();
        // Progress guarantee, don't refine the AttrR further
        return { done: done, rest: rest };
    }

}

