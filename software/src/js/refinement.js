// @flow
"use strict";

import type { AnalysisResults } from "./game.js";
import type { Region } from "./geometry.js";
import type { State, AbstractedLSS } from "./system.js";

import { Polytope, Union } from "./geometry.js";
import { iter } from "./tools.js";


// Associate a partition to states (input to AbstractedLSS.refine)
export type PartitionMap = Map<State, Region>;

// Create a PartitionMap for the states when applying the refinement steps
export function partitionMap(steps: Refinery[], states: Iterable<State>): PartitionMap {
    return new Map(iter.map(state => [state, state.partition(steps)], states));
}


// A Refinery partitions a (subset of a) state
export interface Refinery {
    constructor(AbstractedLSS, ?AnalysisResults): void;
    partition(State, Region): RefinementPartition;
}

// After every refinement step, the partition is divided into "done" and "rest"
// parts. The former will not be refined further by subsequent refinement
// steps, while the latter might be.
export type RefinementPartition = { done: Region, rest: Region };


/* Refinement procedures */

// Remove Attractor of non-satisfying states
class NegativeAttrRefinery implements Refinery {

    +attr: Region;

    constructor(system: AbstractedLSS, results: ?AnalysisResults): void {
        const lss = system.lss;
        const winCoop = results != null ? results.winCoop : new Set();
        if (winCoop.size === 0) {
            this.attr = Polytope.ofDim(lss.dim).empty();
        } else {
            const states = Array.from(system.states.values()).filter(_ => !winCoop.has(_.label));
            const target = Union.from(states.map(_ => _.polytope)).simplify();
            this.attr = lss.attr(lss.xx, lss.uus, target);
        }
    }

    partition(state: State, rest: Region): RefinementPartition {
        const done = this.attr.intersect(rest).simplify();
        const newRest = rest.remove(done).simplify();
        return { done: done, rest: newRest };
    }

}

// Remove Attractor of non-satisfying states
class PositivePreRRefinery implements Refinery {

    +preR: Region;

    constructor(system: AbstractedLSS, results: ?AnalysisResults): void {
        const lss = system.lss;
        const win = results != null ? results.win : new Set();
        if (win.size === 0) {
            this.preR = Polytope.ofDim(lss.dim).empty();
        } else {
            const states = Array.from(system.states.values()).filter(_ => win.has(_.label));
            const target = Union.from(states.map(_ => _.polytope)).simplify();
            this.preR = lss.preR(lss.xx, lss.uus, target);
        }
    }

    partition(state: State, rest: Region): RefinementPartition {
        const done = this.preR.intersect(rest).simplify();
        const newRest = rest.remove(done).simplify();
        return { done: done, rest: newRest };
    }

}

class PositiveAttrRRefinery implements Refinery {

    constructor(system: AbstractedLSS, results: ?AnalysisResults): void {
        // TODO
    }

    partition(state: State, rest: Region): RefinementPartition {
        return { done: Polytope.ofDim(rest.dim).empty(), rest: rest };
    }

}

// Collection of refineries for module export
export const Refineries = {
    NegativeAttr: NegativeAttrRefinery,
    PositivePreR: PositivePreRRefinery,
    PositiveAttrR: PositiveAttrRRefinery
};

