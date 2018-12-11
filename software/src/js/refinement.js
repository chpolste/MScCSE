// @flow
"use strict";

import type { AnalysisResults } from "./game.js";
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
                done = partition.done.union(done);
                rest = partition.rest;
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

    // Implement in subclass
    partition(x: State, q: AutomatonStateLabel, rest: Region): RefinementPartition {
        throw new NotImplementedError();
    }

}


/* Refinement procedures */

// Remove Attractor of non-satisfying states
class NegativeAttrRefinery extends Refinery {

    +attr: Map<AutomatonStateLabel,Region>;

    constructor(system: AbstractedLSS, objective: Objective,
                results: AnalysisResults, settings: RefinerySettings): void {
        super(system, objective, results, settings);
        // Precompute attractors of "no" states for every
        this.attr = new Map();
        const lss = system.lss;
        for (let q of objective.allStates) {
            const xNo = [];
            for (let x of system.states.values()) {
                const result = results.get(x.label);
                if (result == null) throw new Error("NAR1"); // TODO
                if (result.no.has(q)) {
                    xNo.push(x.polytope);
                }
            }
            const target = xNo.length > 0 ? Union.from(xNo).simplify() : Polytope.ofDim(lss.dim).empty();
            this.attr.set(q, lss.attr(lss.xx, lss.uus, target));
        }
    }

    partition(x: State, q: AutomatonStateLabel, rest: Region): RefinementPartition {
        const result = this._results.get(x.label);
        if (result == null) {
            throw new Error("NAR3");
        } else if (result.maybe.has(q)) {
            const attr = this.attr.get(q);
            if (attr == null) throw new Error("NAR2"); // TODO
            const done = attr.intersect(rest).simplify();
            const newRest = rest.remove(done).simplify();
            return { done: done, rest: newRest };
        } else {
            return { done: rest, rest: Polytope.ofDim(rest.dim).empty() };
        }
    }

}

// Remove Attractor of non-satisfying states
class PositivePreRRefinery extends Refinery {

    +preR: Region;

    constructor(system: AbstractedLSS, objective: Objective,
                results: AnalysisResults, settings: RefinerySettings): void {
        super(system, objective, results, settings);
        const lss = system.lss;
        const win = new Set(); // TODO
        if (win.size === 0) {
            this.preR = Polytope.ofDim(lss.dim).empty();
        } else {
            const states = Array.from(system.states.values()).filter(_ => win.has(_.label));
            const target = Union.from(states.map(_ => _.polytope)).simplify();
            this.preR = lss.preR(lss.xx, lss.uus, target);
        }
    }

    partition(x: State, q: AutomatonStateLabel, rest: Region): RefinementPartition {
        const done = this.preR.intersect(rest).simplify();
        const newRest = rest.remove(done).simplify();
        return { done: done, rest: newRest };
    }

}

class PositiveAttrRRefinery extends Refinery {

    // TODO

    partition(x: State, q: AutomatonStateLabel, rest: Region): RefinementPartition {
        return { done: Polytope.ofDim(rest.dim).empty(), rest: rest };
    }

}

