// @flow
"use strict";

import type { AnalysisResults } from "./game.js";
import type { Region } from "./geometry.js";
import type { State, AbstractedLSS } from "./system.js";

import { Polytope } from "./geometry.js";
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

    +negStates: State[];
    +uus: Region;

    constructor(system: AbstractedLSS, results: ?AnalysisResults): void {
        if (results == null) {
            this.negStates = [];
        } else {
            const winCoop = results.winCoop;
            // TODO: make dynamics operators accept iterables in system
            this.negStates = Array.from(system.states.values()).filter(_ => !winCoop.has(_.label));
        }
        this.uus = system.lss.uus;
    }

    partition(state: State, rest: Region): RefinementPartition {
        const attr = state.attr(this.uus, this.negStates);
        const done = attr.intersect(rest).simplify();
        const newRest = rest.remove(done).simplify();
        return { done: done, rest: newRest };
    }

}

// Remove Attractor of non-satisfying states
class PositivePreRRefinery implements Refinery {

    +posStates: State[];
    +uus: Region;

    constructor(system: AbstractedLSS, results: ?AnalysisResults): void {
        if (results == null) {
            this.posStates = [];
        } else {
            const win = results.win;
            this.posStates = Array.from(system.states.values()).filter(_ => win.has(_.label));
        }
        this.uus = system.lss.uus;
    }

    partition(state: State, rest: Region): RefinementPartition {
        const prer = state.preR(this.uus, this.posStates);
        const done = prer.intersect(rest).simplify();
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

