// @flow
"use strict";

import type { Matrix, Vector } from "./linalg.js";
import type { ConvexPolytope, ConvexPolytopeUnion, Halfspace } from "./geometry.js";

import { zip2map } from "./tools.js";
import * as linalg from "./linalg.js";
import { polytopeType, union } from "./geometry.js";


type StateKind = number;

const OUTSIDE = -10;
const NOTSATISFYING = -1;
const UNDECIDED = 0;
const SATISFYING = 1;


export interface Decomposition {
    decompose(lss: AbstractedLSS): State[];
}


export class SplitWithSatisfyingPredicates implements Decomposition {

    +predicates: Halfspace[];

    constructor(predicates: Halfspace[]): void {
        this.predicates = predicates;
    }

    decompose(lss: AbstractedLSS): State[] {
        let satisfying = lss.stateSpace.intersect(...this.predicates);
        return lss.stateSpace.split(...this.predicates).map(poly => {
            return new State(lss, poly, poly.isSameAs(satisfying) ? SATISFYING : UNDECIDED);
        });
    }

}


export type Action = { origin: State, targets: State[], controls: ConvexPolytopeUnion };

export class AbstractedLSS {

    +dim: number;
    +A: Matrix;
    +B: Matrix;
    +stateSpace: ConvexPolytope;
    +randomSpace: ConvexPolytope;
    +controlSpace: ConvexPolytope;
    +decomposition: Decomposition;

    +extendedStateSpace: ConvexPolytopeUnion;

    labelNum: number;
    states: State[];

    constructor(A: Matrix, B: Matrix, stateSpace: ConvexPolytope, randomSpace: ConvexPolytope,
                controlSpace: ConvexPolytope, decomposition: Decomposition): void {
        this.A = A;
        this.B = B;
        this.stateSpace = stateSpace;
        this.randomSpace = randomSpace;
        this.controlSpace = controlSpace;
        this.decomposition = decomposition;
        this.dim = stateSpace.dim;

        this.labelNum = 0;

        let oneStepReachable = this.post(stateSpace, controlSpace);
        this.extendedStateSpace = union.disjunctify([this.stateSpace, oneStepReachable]);

        // Initial abstraction into states is given by decomposition and
        // partition of outside region into convex polytopes
        this.states = oneStepReachable.remove(stateSpace).map(poly => new State(this, poly, OUTSIDE));
        this.states.push(...decomposition.decompose(this));

        for (let state of this.states) {
            state.actions = this.computeActions(state, this.controlSpace);
        }
    }

    get extent(): Vector[] {
        let ext1 = this.post(this.stateSpace, this.controlSpace).extent;
        let ext2 = this.stateSpace.extent;
        return zip2map((a, b) => [Math.min(a[0], b[0]), Math.max(a[1], b[1])], ext1, ext2);
    }

    genLabel(): string {
        this.labelNum++;
        return "X" + this.labelNum.toString();
    }

    // Posterior: Post(x, u)
    post(x: ConvexPolytope, u: ConvexPolytope): ConvexPolytope {
        let xvs = x.vertices;
        let uvs = u.vertices;
        let wvs = this.randomSpace.vertices;
        return polytopeType(this.dim).hull(
            linalg.minkowski.axpy(this.A, xvs, linalg.minkowski.axpy(this.B, uvs, wvs))
        );
    }

    // Predecessor: Pre(x, u, {y0, y1, ...})
    pre(x: ConvexPolytope, u: ConvexPolytope, ...ys: ConvexPolytopeUnion): ConvexPolytopeUnion {
        // Minkowski sum: hull of translated vertices (union of translated polygons)
        let Bupws = linalg.minkowski.axpy(this.B, u.vertices, this.randomSpace.vertices);
        return union.disjunctify(ys.map(y => {
            // "Project" backward (inverse Ax + Bu)
            let poly = polytopeType(this.dim).hull(linalg.minkowski.xmy(y.vertices, Bupws));
            return x.intersect(poly.applyRight(this.A));
        }).filter(y => !y.isEmpty));
    }

    // Robust Predecessor: PreR(x, u, {y0, y1, ...})
    preR(x: ConvexPolytope, u: ConvexPolytope, ...ys: ConvexPolytopeUnion): ConvexPolytopeUnion {
        let Bus = u.vertices.map(uv => linalg.apply(this.B, uv));
        let pontrys = union.pontryagin(ys, this.randomSpace);
        return pontrys.map(e => {
            // "Project" backward (inverse Ax + Bu)
            let poly = polytopeType(this.dim).hull(linalg.minkowski.xmy(e.vertices, Bus));
            return x.intersect(poly.applyRight(this.A));
        }).filter(y => !y.isEmpty);
    }

    // Attractor: Attr(x, u, {y0, y1, ...})
    attr(x: ConvexPolytope, u: ConvexPolytope, ...ys: ConvexPolytopeUnion): ConvexPolytopeUnion {
        return x.remove(...this.preR(x, u, ...union.remove(this.extendedStateSpace, ys)));
    }

    // Robust Attractor: AttrR(x, u, {y0, y1, ...})
    attrR(x: ConvexPolytope, u: ConvexPolytope, ...ys: ConvexPolytopeUnion): ConvexPolytopeUnion {
        return x.remove(...this.pre(x, u, ...union.remove(this.extendedStateSpace, ys)));
    }

    // Action Polytope
    actionPolytope(x: ConvexPolytope, y: ConvexPolytope): ConvexPolytope {
        let Axpws = linalg.minkowski.axpy(this.A, x.vertices, this.randomSpace.vertices);
        let poly = polytopeType(this.dim).hull(linalg.minkowski.xmy(y.vertices, Axpws));
        return poly.applyRight(this.B).intersect(this.controlSpace);
    }

    computeActions(state: State, u: ConvexPolytope): Action[] {
        if (state.isOutside) {
            return []; // Outside states have no actions
        }
        let reachableStates = state.oneStepReachable(u);
        let actions = [];
        for (let target of reachableStates) {
            // Collect new actions in separate array so they are not visited
            // immediately when looping over actions
            let newActions: Action[] = [];
            // Start with all control inputs that can lead to target state: Uc
            let ucs = [state.actionPolytope(target)];
            for (let action of actions) {
                // Stop early when there is no control subset Uc left
                if (union.isEmpty(ucs)) {
                    break;
                }
                // Control inputs from the intersection of the action's control
                // inputs and Uc can lead to action's targets and currently
                // considered target. This must be incorporated in the action.
                let u1s = union.intersect(ucs, action.controls);
                if (!union.isEmpty(u1s)) {
                    // By removing the intersection, only control inputs are
                    // left that cannot lead to the currently considered target
                    let u2s = union.remove(action.controls, u1s);
                    // Nothing left, entire action.controls can lead to target,
                    // therefore include it as a target of the action
                    if (union.isEmpty(u2s)) {
                        action.targets.push(target);
                    // Restrict action.controls to those controls that will not
                    // lead to the currently considered target and create a new
                    // action that can lead to the action's targets and the
                    // considered target
                    } else {
                        action.controls = u2s;
                        newActions.push({
                            origin: state,
                            targets: action.targets.concat([target]),
                            controls: u1s
                        });
                    }
                    // Remove the just processed subset of Uc
                    ucs = union.remove(ucs, u1s);
                }
            }
            // What is left of Uc can only lead to the target (or reachable
            // state that have not been considered yet). Create a new action.
            if (!union.isEmpty(ucs)) {
                newActions.push({
                    origin: state,
                    targets: [target],
                    controls: ucs
                });
            }
            // Commit new actions
            actions.push(...newActions);
        }
        return actions;
    }

}


export class State {

    +system: AbstractedLSS;
    +polytope: ConvexPolytope;
    +label: string;
    kind: StateKind;
    actions: Action[];

    constructor(system: AbstractedLSS, polytope: ConvexPolytope, kind: StateKind): void {
        this.system = system;
        this.polytope = polytope;
        this.label = system.genLabel();
        this.kind = kind;
        // Actions are given to each state later by the system (it would be
        // very inefficient to recompute actions after each state-related
        // change).
        this.actions = [];
    }

    get isUndecided(): boolean {
        return this.kind == 0;
    }

    get isSatisfying(): boolean {
        return this.kind > 0;
    }

    get isNonSatisfying(): boolean {
        return this.kind < 0;
    }

    get isOutside(): boolean {
        return this.kind <= -10;
    }

    post(u: ConvexPolytope): ConvexPolytope {
        return this.system.post(this.polytope, u);
    }

    pre(u: ConvexPolytope, ...ys: State[]): ConvexPolytopeUnion {
        return this.system.pre(this.polytope, u, ...ys.map(y => y.polytope));
    }
    
    preR(u: ConvexPolytope, ...ys: State[]): ConvexPolytopeUnion {
        return this.system.preR(this.polytope, u, ...ys.map(y => y.polytope));
    } 
    
    attr(u: ConvexPolytope, ...ys: State[]): ConvexPolytopeUnion {
        return this.system.attr(this.polytope, u, ...ys.map(y => y.polytope));
    }
    
    attrR(u: ConvexPolytope, ...ys: State[]): ConvexPolytopeUnion {
        return this.system.attrR(this.polytope, u, ...ys.map(y => y.polytope));
    }

    oneStepReachable(u: ConvexPolytope): State[] {
        let post = this.post(u);
        return this.system.states.filter(state => !post.intersect(state.polytope).isEmpty);
    }

    actionPolytope(y: State): ConvexPolytope {
        return this.system.actionPolytope(this.polytope, y.polytope);
    }

}

