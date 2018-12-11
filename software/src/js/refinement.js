// @flow
"use strict";

import type { AnalysisResults } from "./game.js";
import type { Region } from "./geometry.js";
import type { Objective, AutomatonStateLabel } from "./logic.js";
import type { AbstractedLSS, State, Action } from "./system.js";

import { Polytope, Union } from "./geometry.js";
import { iter, NotImplementedError } from "./tools.js";


// Associate a partition to states (input to AbstractedLSS.refine)
export type PartitionMap = Map<State, Region>;

// Create a PartitionMap for the states when applying the refinement steps
export function partitionMap(steps: Refinery[], states: Iterable<State>): PartitionMap {
    // TODO for each qi... (combine this with AbstractedLSS.partition)
    return new Map(iter.map(state => [state, state.partition(steps)], states));
}

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

    // Collection of refineries for module export
    static builtIn(): { [string]: Class<Refinery> } {
        return {
            NegativeAttr: NegativeAttrRefinery,
            PositivePreR: PositivePreRRefinery,
            PositiveAttrR: PositiveAttrRRefinery
        };
    }

}


/* Refinement procedures */

// Remove Attractor of non-satisfying states
class NegativeAttrRefinery extends Refinery {

    +attr: Region;

    constructor(system: AbstractedLSS, objective: Objective,
                results: AnalysisResults, settings: RefinerySettings): void {
        super(system, objective, results, settings);
        const lss = system.lss;
        const winCoop = new Set(); // TODO
        if (winCoop.size === 0) {
            this.attr = Polytope.ofDim(lss.dim).empty();
        } else {
            const states = Array.from(system.states.values()).filter(_ => !winCoop.has(_.label));
            const target = Union.from(states.map(_ => _.polytope)).simplify();
            this.attr = lss.attr(lss.xx, lss.uus, target);
        }
    }

    partition(x: State, q: AutomatonStateLabel, rest: Region): RefinementPartition {
        const done = this.attr.intersect(rest).simplify();
        const newRest = rest.remove(done).simplify();
        return { done: done, rest: newRest };
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

