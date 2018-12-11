// @flow
"use strict";

import type { AnalysisResults, AnalysisResult } from "./game.js";
import type { Region } from "./geometry.js";
import type { Objective, AutomatonStateLabel } from "./logic.js";
import type { AbstractedLSS, State, Action } from "./system.js";

import { Polytope, Union } from "./geometry.js";
import { iter, NotImplementedError } from "./tools.js";


// After every refinement step, the partition is divided into "done" and "rest"
// parts. The former will not be refined further by subsequent refinement
// steps, while the latter might be.
export type RefinementPartition = { done: Region, rest: Region };

// ...
export type RefineryActionPick = "best" | "random3";
export type RefinerySettings = {
    actionPick: RefineryActionPick
};


export class Refinery {

    +_system: AbstractedLSS;
    +_objective: Objective;
    +_results: AnalysisResults;
    +_settings: RefinerySettings;

    constructor(system: AbstractedLSS, objective: Objective,
                results: AnalysisResults, settings: RefinerySettings): void {
        this._system = system;
        this._objective = objective;
        this._results = results;
        this._settings = settings;
    }

    // Partition the system state x in automaton states qs using the given
    // refinement steps
    static execute(steps: Refinery[], x: State, qs: AutomatonStateLabel[]): Region {
        let rest = x.polytope;
        // Apply all refinement steps for every given automaton state
        for (let q of qs) {
            let done = Union.empty(rest.dim);
            for (let step of steps) {
                const partition = step.partition(x, q, rest);
                // null-return: refinery does not want to partition the state
                if (partition == null) continue;
                // Collect parts
                done = partition.done.union(done);
                rest = partition.rest;
                // Nothing left to refine?
                if (rest.isEmpty) break;
            }
            // Reset rest to entire polytope as parts marked as done in some
            // automaton state will generally not also be done in another
            rest = rest.union(done);
        }
        return rest;
    }

    // Collection of refineries for module export
    static builtIns(): { [string]: Class<Refinery> } {
        return {
            "Negative Attractor": NegativeAttrRefinery,
            "Positive Robust Predecessor": PositivePreRRefinery,
            "Positive Robust Attractor": PositiveAttrRRefinery
        };
    }

    _pickActions(x: State, q: AutomatonStateLabel): Action[] {
        const actions = [];
        // Estimate best action
        if (this._settings.actionPick === "best") {
            // TODO
        // 3 randomly chosen actions
        } else {
            // TODO
        }
        return actions;
    }

    // Convenience accessors

    _getResult(x: State): AnalysisResult {
        const result = this._results.get(x.label);
        if (result == null) throw new Error("TODO477"); // TODO
        return result;
    }
    
    _qNext(x: State, q: AutomatonStateLabel): ?AutomatonStateLabel {
        return this._objective.nextState(x.predicates, q);
    }

    // Implement in subclass
    partition(x: State, q: AutomatonStateLabel, rest: Region): ?RefinementPartition {
        throw new NotImplementedError();
    }

}


/* Refinement procedures */

// Remove Attractor of non-satisfying states
class NegativeAttrRefinery extends Refinery {

    +attr: Map<AutomatonStateLabel, Region>;

    constructor(system: AbstractedLSS, objective: Objective,
                results: AnalysisResults, settings: RefinerySettings): void {
        super(system, objective, results, settings);
        // Precompute attractor of "no" states for every q
        this.attr = new Map();
        const lss = system.lss;
        for (let q of objective.allStates) {
            const xNo = [];
            for (let x of system.states.values()) {
                if (this._getResult(x).no.has(q)) {
                    xNo.push(x.polytope);
                }
            }
            const target = xNo.length > 0 ? Union.from(xNo).simplify() : Polytope.ofDim(lss.dim).empty();
            this.attr.set(q, lss.attr(lss.xx, lss.uus, target));
        }
    }

    partition(x: State, q: AutomatonStateLabel, rest: Region): ?RefinementPartition {
        // Only refine maybe states
        if (!this._getResult(x).maybe.has(q)) return null;
        // Refine wrt to next automaton state
        const qNext = this._qNext(x, q);
        if (qNext == null) return null;
        // Cut attractor of "no" region out of state
        const attr = this.attr.get(qNext);
        if (attr == null) throw new Error("NAR2"); // TODO
        const done = attr.intersect(rest).simplify();
        const newRest = rest.remove(done).simplify();
        // Progress guarantee, don't refine the attr further
        return { done: done, rest: newRest };
    }

}

// Remove Attractor of non-satisfying states
class PositivePreRRefinery extends Refinery {

    +preR: Map<AutomatonStateLabel, Region>;

    constructor(system: AbstractedLSS, objective: Objective,
                results: AnalysisResults, settings: RefinerySettings): void {
        super(system, objective, results, settings);
        // Precompute robust predecessor of "yes" states for every q
        this.preR = new Map();
        const lss = system.lss;
        for (let q of objective.allStates) {
            const xYes = [];
            for (let x of system.states.values()) {
                if (this._getResult(x).yes.has(q)) {
                    xYes.push(x.polytope);
                }
            }
            const target = xYes.length > 0 ? Union.from(xYes).simplify() : Polytope.ofDim(lss.dim).empty();
            this.preR.set(q, lss.preR(lss.xx, lss.uus, target));
        }
    }

    partition(x: State, q: AutomatonStateLabel, rest: Region): ?RefinementPartition {
        // Only refine maybe states
        if (!this._getResult(x).maybe.has(q)) return null;
        // Refine wrt to next automaton state
        const qNext = this._qNext(x, q);
        if (qNext == null) return null;
        // Cut robust predecessor of "yes" region out of state
        const preR = this.preR.get(qNext);
        if (preR == null) throw new Error("NAR2"); // TODO
        const done = preR.intersect(rest).simplify();
        const newRest = rest.remove(done).simplify();
        // No progress guarantee, everything can be refined further
        return { done: Polytope.ofDim(rest.dim).empty(), rest: done.union(newRest) };
    }

}

// ...
class PositiveAttrRRefinery extends Refinery {

    // TODO

    partition(x: State, q: AutomatonStateLabel, rest: Region): RefinementPartition {
        return { done: Polytope.ofDim(rest.dim).empty(), rest: rest };
    }

}

