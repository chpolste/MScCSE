// @flow
"use strict";

import type { AbstractedLSS, State } from "./system.js";
import type { ConvexPolytopeUnion } from "./geometry.js";

import { iter } from "./tools.js";
import { union } from "./geometry.js";


// ...
export function partitionAll(steps: Refinery[], states: Iterable<State>): Map<State, ConvexPolytopeUnion> {
    return new Map(iter.map(
        state => [state, partition(steps, state)],
        states
    ));
}


// ...
export function partition(steps: Refinery[], state: State): ConvexPolytopeUnion {
    let parts = { done: [], rest: [state.polytope] };
    for (let step of steps) {
        const newParts = step.execute(state, parts.rest);
        parts.done.push(...newParts.done);
        parts.rest = newParts.rest;
        if (union.isEmpty(parts.rest)) {
            break;
        }
    }
    return [].concat(parts.done, parts.rest);
}


// ...
export interface Refinery {
    execute(State, ConvexPolytopeUnion): RefinementPartition;
}

// ...
export type RefinementPartition = { done: ConvexPolytopeUnion, rest: ConvexPolytopeUnion };


/* Refinement procedures */

// Remove attractor of outer states (guaranteed to be non-satisfying)
export class OuterAttr implements Refinery {

    +outerStates: State[];
    +controlSpace: ConvexPolytopeUnion;

    constructor(system: AbstractedLSS): void {
        this.outerStates = Array.from(system.states.values()).filter(s => s.isOuter);
        this.controlSpace = system.lss.controlSpace;
    }

    execute(state: State, rest: ConvexPolytopeUnion): RefinementPartition {
        const attr = state.attr(this.controlSpace, this.outerStates);
        const done = union.simplify(union.intersect(attr, rest));
        const newRest = union.simplify(union.remove(rest, done));
        return { done: done, rest: newRest };
    }

}

