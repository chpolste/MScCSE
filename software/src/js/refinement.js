// @flow
"use strict";

import type { ConvexPolytopeUnion } from "./geometry.js";
import type { State, AbstractedLSS } from "./system.js";

import { union } from "./geometry.js";
import { iter } from "./tools.js";


// Associate a partition to states (input to AbstractedLSS.refine)
export type PartitionMap = Map<State, ConvexPolytopeUnion>;

// Create a PartitionMap for the states when applying the refinement steps
export function partitionMap(steps: Refinery[], states: Iterable<State>): PartitionMap {
    return new Map(iter.map(state => [state, state.partition(steps)], states));
}


// A Refinery partitions a (subset of a) state
export interface Refinery {
    constructor(AbstractedLSS): void;
    partition(State, ConvexPolytopeUnion): RefinementPartition;
}

// After every refinement step, the partition is divided into "done" and "rest"
// parts. The former will not be refined further by subsequent refinement
// steps, while the latter might be.
export type RefinementPartition = { done: ConvexPolytopeUnion, rest: ConvexPolytopeUnion };


/* Refinement procedures */

// Remove Attractor of non-satisfying states
class NegativeAttrRefinery implements Refinery {

    +nonSatisfyingStates: State[];
    +uus: ConvexPolytopeUnion;

    constructor(system: AbstractedLSS): void {
        this.nonSatisfyingStates = Array.from(system.states.values()).filter(s => s.isNonSatisfying);
        this.uus = system.lss.uus;
    }

    partition(state: State, rest: ConvexPolytopeUnion): RefinementPartition {
        const attr = state.attr(this.uus, this.nonSatisfyingStates);
        const done = union.simplify(union.intersect(attr, rest));
        const newRest = union.simplify(union.remove(rest, done));
        return { done: done, rest: newRest };
    }

}

class PositivePreRRefinery implements Refinery {

    constructor(system: AbstractedLSS): void {
        // TODO
    }

    partition(state: State, rest: ConvexPolytopeUnion): RefinementPartition {
        return { done: [], rest: rest };
    }

}

class PositiveAttrRRefinery implements Refinery {

    constructor(system: AbstractedLSS): void {
        // TODO
    }

    partition(state: State, rest: ConvexPolytopeUnion): RefinementPartition {
        return { done: [], rest: rest };
    }

}

// Collection of refineries for module export
export const refinery = {
    NegativeAttr: NegativeAttrRefinery,
    PositivePreR: PositivePreRRefinery,
    PositiveAttrR: PositiveAttrRRefinery
};

