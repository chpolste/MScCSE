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
    decompose(lss: LSS): State[];
}


export class SplitWithSatisfyingPredicates implements Decomposition {

    +predicates: Halfspace[];

    constructor(predicates: Halfspace[]): void {
        this.predicates = predicates;
    }

    decompose(lss: LSS): State[] {
        let satisfying = lss.stateSpace.intersect(...this.predicates);
        return lss.stateSpace.split(...this.predicates).map(poly => {
            return new State(lss, poly, poly.isSameAs(satisfying) ? SATISFYING : UNDECIDED);
        });
    }

}


export class LSS {

    +A: Matrix;
    +B: Matrix;
    +stateSpace: ConvexPolytope;
    +extendedStateSpace: ConvexPolytopeUnion;
    +randomSpace: ConvexPolytope;
    +controlSpace: ConvexPolytope;
    +decomposition: Decomposition;
    +dim: number;
    states: State[];
    +extent: Vector[];

    constructor(A: Matrix, B: Matrix, stateSpace: ConvexPolytope, randomSpace: ConvexPolytope,
                controlSpace: ConvexPolytope, decomposition: Decomposition): void {
        this.A = A;
        this.B = B;
        this.stateSpace = stateSpace;
        this.randomSpace = randomSpace;
        this.controlSpace = controlSpace;
        this.decomposition = decomposition;
        this.dim = stateSpace.dim;

        let oneStepReachable = this.post(stateSpace, controlSpace);
        this.extendedStateSpace = union.disjunctify([this.stateSpace, oneStepReachable]);

        this.states = oneStepReachable.remove(stateSpace).map(poly => new State(this, poly, OUTSIDE));
        this.states.push(...decomposition.decompose(this));
    }

    get extent(): Vector[] {
        let ext1 = this.post(this.stateSpace, this.controlSpace).extent;
        let ext2 = this.stateSpace.extent;
        return zip2map((a, b) => [Math.min(a[0], b[0]), Math.max(a[1], b[1])], ext1, ext2);
    }

    post(x: ConvexPolytope, u: ConvexPolytope): ConvexPolytope {
        let xvs = x.vertices;
        let uvs = u.vertices;
        let wvs = this.randomSpace.vertices;
        return polytopeType(this.dim).hull(
            linalg.minkowski.axpy(this.A, xvs, linalg.minkowski.axpy(this.B, uvs, wvs))
        );
    }

    pre(x: ConvexPolytope, u: ConvexPolytope, ...ys: ConvexPolytopeUnion): ConvexPolytopeUnion {
        // Minkowski sum: hull of translated vertices (union of translated polygons)
        let Bupws = linalg.minkowski.axpy(this.B, u.vertices, this.randomSpace.vertices);
        return union.disjunctify(ys.map(y => {
            // "Project" backward (inverse Ax + Bu)
            let poly = polytopeType(this.dim).hull(linalg.minkowski.xmy(y.vertices, Bupws));
            return x.intersect(poly.applyRight(this.A));
        }).filter(y => !y.isEmpty));
    }

    preR(x: ConvexPolytope, u: ConvexPolytope, ...ys: ConvexPolytopeUnion): ConvexPolytopeUnion {
        let Bus = u.vertices.map(uv => linalg.apply(this.B, uv));
        let eroded = union.erode(ys, this.randomSpace.invert());
        return eroded.map(e => {
            // "Project" backward (inverse Ax + Bu)
            let poly = polytopeType(this.dim).hull(linalg.minkowski.xmy(e.vertices, Bus));
            return x.intersect(poly.applyRight(this.A));
        }).filter(y => !y.isEmpty);
    }

    attr(x: ConvexPolytope, u: ConvexPolytope, ...ys: ConvexPolytopeUnion): ConvexPolytopeUnion {
        return x.remove(...this.preR(x, u, ...union.remove(this.extendedStateSpace, ys)));
    }

    attrR(x: ConvexPolytope, u: ConvexPolytope, ...ys: ConvexPolytopeUnion): ConvexPolytopeUnion {
        return x.remove(...this.pre(x, u, ...union.remove(this.extendedStateSpace, ys)));
    }

}


export class State {

    +lss: LSS;
    +polytope: ConvexPolytope;
    +kind: StateKind;
    +actions: Action[];

    constructor(lss: LSS, polytope: ConvexPolytope, kind: StateKind): void {
        this.lss = lss;
        this.polytope = polytope;
        this.kind = kind;
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
        return this.lss.post(this.polytope, u);
    }

    pre(u: ConvexPolytope, ...ys: State[]): ConvexPolytopeUnion {
        return this.lss.pre(this.polytope, u, ...ys.map(y => y.polytope));
    }
    
    preR(u: ConvexPolytope, ...ys: State[]): ConvexPolytopeUnion {
        return this.lss.preR(this.polytope, u, ...ys.map(y => y.polytope));
    } 
    
    preP(u: ConvexPolytope, ...ys: State[]): ConvexPolytopeUnion {
        return []; // TODO
    }
    
    attr(u: ConvexPolytope, ...ys: State[]): ConvexPolytopeUnion {
        return this.lss.attr(this.polytope, u, ...ys.map(y => y.polytope));
    }
    
    attrR(u: ConvexPolytope, ...ys: State[]): ConvexPolytopeUnion {
        return this.lss.attrR(this.polytope, u, ...ys.map(y => y.polytope));
    }

    /*

    actionPolytope(target: State): ConvexPolytope {
        let xs = this.polytope.vertices;
        let ys = target.polytope.vertices;
        let ws = this.lss.randomPoly.vertices;
        let A = this.lss.matrixA;
        let B = this.lss.matrixB;
        let ps = [];
        for (let x of xs) {
            for (let y of ys) {
                for (let w of ws) {
                    ps.push(linalg.sub(linalg.sub(y, linalg.apply(A, x)), w));
                }
            }
        }
        let poly = polytopeType(this.polytope.dim).hull(ps);
        return poly.applyRight(B);
    }

    actions(): Action[] {
        if (this.kind === OUTSIDE) {
            return [];
        }
        let reachableStates = this.lss.states.filter(state => {
            return !this.polytope.intersect(state.polytope).isEmpty;
        });
        let actions = [];
        for (let target of reachableStates) {
            let actionPoly = this.actionPolytope(target);
            let controls = actionPoly.isEmpty ? [] : [actionPoly];
            for (let action of actions) {
                if (controls.length == 0) {
                    break;
                }
                let ctrl1 = [];
                let ctrl2 = [];
                // TODO

                if (ctrl2.length > 0) {
                    action.pushControls(...ctrl2);
                    // TODO
                } else {

                }
            }

            if (controls.length > 0) {
                actions.push(new Action(this, [target], controls));
            }
        }
        return actions;
    }
    
    */
    
}


class Action {

    origin: State;
    targets: State[];
    controls: ConvexPolytopeUnion;

    constructor(origin: State, targets: State[], controls: ConvexPolytopeUnion): void {
        this.origin = origin;
        this.targets = targets;
        this.controls = controls;
    }

    pushControls(...controls: ConvexPolytopeUnion): void {
        this.controls.push(...controls);
    }

    // TODO
}

