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
    +controlSpace: ConvexPolytopeUnion;
    +decomposition: Decomposition;

    +extendedStateSpace: ConvexPolytopeUnion;

    labelNum: number;
    states: State[];

    constructor(A: Matrix, B: Matrix, stateSpace: ConvexPolytope, randomSpace: ConvexPolytope,
                controlSpace: ConvexPolytopeUnion, decomposition: Decomposition): void {
        this.A = A;
        this.B = B;
        this.stateSpace = stateSpace;
        this.randomSpace = randomSpace;
        this.controlSpace = controlSpace;
        this.decomposition = decomposition;
        this.dim = stateSpace.dim;

        this.labelNum = 0;

        let oneStepReachable = this.post(stateSpace, controlSpace);
        this.extendedStateSpace = union.disjunctify([this.stateSpace, ...oneStepReachable]);

        // Initial abstraction into states is given by decomposition and
        // partition of outside region into convex polytopes
        this.states = union.remove(oneStepReachable, [stateSpace]).map(poly => new State(this, poly, OUTSIDE));
        this.states.push(...decomposition.decompose(this));

        for (let state of this.states) {
            state.actions = this.computeActions(state, this.controlSpace);
            // TODO: assert that union of all action controls is Same as controlSpace -> unit test
        }
    }

    get extent(): Vector[] {
        let ext1 = union.extent(this.post(this.stateSpace, this.controlSpace));
        let ext2 = this.stateSpace.extent;
        return zip2map((a, b) => [Math.min(a[0], b[0]), Math.max(a[1], b[1])], ext1, ext2);
    }

    genLabel(): string {
        this.labelNum++;
        return "X" + this.labelNum.toString();
    }

    // Posterior: Post(x, {u0, ...})
    post(x: ConvexPolytope, us: ConvexPolytopeUnion): ConvexPolytopeUnion {
        let xvs = x.vertices;
        let wvs = this.randomSpace.vertices;
        let posts = [];
        for (let u of us) {
            let uvs = u.vertices;
            posts.push(
                polytopeType(this.dim).hull(
                    linalg.minkowski.axpy(this.A, xvs, linalg.minkowski.axpy(this.B, uvs, wvs))
                )
            );
        }
        return union.simplify(posts);
    }

    // Predecessor: Pre(x, {u0, ...}, {y0, ...})
    pre(x: ConvexPolytope, us: ConvexPolytopeUnion, ys: ConvexPolytopeUnion): ConvexPolytopeUnion {
        let pres = [];
        for (let u of us) {
            // Minkowski sum: hull of translated vertices (union of translated polygons)
            let Bupws = linalg.minkowski.axpy(this.B, u.vertices, this.randomSpace.vertices);
            for (let y of ys) {
                let pre = polytopeType(this.dim).hull(linalg.minkowski.xmy(y.vertices, Bupws));
                pres.push(x.intersect(pre.applyRight(this.A)));
            }
        }
        return union.simplify(pres);
    }

    // Robust Predecessor: PreR(x, {u0, ...}, {y0, ...})
    preR(x: ConvexPolytope, us: ConvexPolytopeUnion, ys: ConvexPolytopeUnion): ConvexPolytopeUnion {
        let pontrys = union.pontryagin(ys, this.randomSpace);
        let prers = [];
        for (let u of us) {
            let Bus = u.vertices.map(uv => linalg.apply(this.B, uv));
            for (let pontry of pontrys) {
                let poly = polytopeType(this.dim).hull(linalg.minkowski.xmy(pontry.vertices, Bus));
                prers.push(x.intersect(poly.applyRight(this.A)));
            }
        }
        return union.simplify(prers);
    }

    // Attractor: Attr(x, {u0, ...}, {y0, ...})
    attr(x: ConvexPolytope, us: ConvexPolytopeUnion, ys: ConvexPolytopeUnion): ConvexPolytopeUnion {
        return x.remove(...this.preR(x, us, union.remove(this.extendedStateSpace, ys)));
    }

    // Robust Attractor: AttrR(x, {u0, ...}, {y0, ...})
    attrR(x: ConvexPolytope, us: ConvexPolytopeUnion, ys: ConvexPolytopeUnion): ConvexPolytopeUnion {
        return x.remove(...this.pre(x, us, union.remove(this.extendedStateSpace, ys)));
    }

    // Action Polytope
    // TODO: accept a u that isn't the entire control space
    actionPolytope(x: ConvexPolytope, y: ConvexPolytope): ConvexPolytopeUnion {
        let Axpws = linalg.minkowski.axpy(this.A, x.vertices, this.randomSpace.vertices);
        let poly = polytopeType(this.dim).hull(linalg.minkowski.xmy(y.vertices, Axpws));
        return union.intersect([poly.applyRight(this.B)], this.controlSpace);
    }

    computeActions(state: State, us: ConvexPolytopeUnion): Action[] {
        if (state.isOutside) {
            return []; // Outside states have no actions
        }
        let reachableStates = state.oneStepReachable(us);
        let op = target => state.actionPolytope(target);
        return preciseOperatorPartition(reachableStates, op).map(
            part => ({ origin: state, targets: part.items, controls: part.polys })
        );
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

    post(us: ConvexPolytopeUnion): ConvexPolytopeUnion {
        return this.system.post(this.polytope, us);
    }

    pre(us: ConvexPolytopeUnion, ys: State[]): ConvexPolytopeUnion {
        return this.system.pre(this.polytope, us, ys.map(y => y.polytope));
    }
    
    preR(us: ConvexPolytopeUnion, ys: State[]): ConvexPolytopeUnion {
        return this.system.preR(this.polytope, us, ys.map(y => y.polytope));
    } 
    
    attr(us: ConvexPolytopeUnion, ys: State[]): ConvexPolytopeUnion {
        return this.system.attr(this.polytope, us, ys.map(y => y.polytope));
    }
    
    attrR(us: ConvexPolytopeUnion, ys: State[]): ConvexPolytopeUnion {
        return this.system.attrR(this.polytope, us, ys.map(y => y.polytope));
    }

    oneStepReachable(us: ConvexPolytopeUnion): State[] {
        let post = this.post(us);
        return this.system.states.filter(state => !union.isEmpty(union.intersect(post, [state.polytope])));
    }

    actionPolytope(y: State): ConvexPolytopeUnion {
        return this.system.actionPolytope(this.polytope, y.polytope);
    }

}


function preciseOperatorPartition<T>(items: T[], operator: (T) => ConvexPolytopeUnion): { polys: ConvexPolytopeUnion, items: T[] }[] {
    let parts = [];
    for (let item of items) {
        // Collect new parts in a separate array so they are not visited
        // immediately when looping over the existing parts
        let newParts = [];
        // Start with the set (points in space, represented as a union of
        // convex polytopes) that is related to the current item
        let remaining = operator(item);
        // Loop over the existing parts and refine them according to the
        // current item
        for (let part of parts) {
            // Stop early when nothing remains
            if (union.isEmpty(remaining)) {
                break;
            }
            let common = union.intersect(remaining, part.polys);
            // The subset that the current item and the existing part have in
            // common must be associated with the current item too
            if (!union.isEmpty(common)) {
                let notCommon = union.remove(part.polys, common);
                // If all of the part's set is associated with the current
                // item, extend the association of the part
                if (union.isEmpty(notCommon)) {
                    part.items.push(item);
                // Else split the set into a subset that is still exclusively
                // associated with the part and a subset that is also
                // associated with the current item (a new part)
                } else {
                    part.polys = notCommon;
                    newParts.push({ polys: common, items: part.items.concat([item]) });
                }
                // Remove the just processed subset of remaining
                remaining = union.remove(remaining, common);
            }
        }
        // What is not common with the already existing parts is a new part
        // that is (for now) exclusively associated with the current item
        if (!union.isEmpty(remaining)) {
            newParts.push({ polys: remaining, items: [item] });
        }
        // Commit new parts
        parts.push(...newParts);
    }
    return parts;
}

