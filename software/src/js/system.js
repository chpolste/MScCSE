// @flow
"use strict";

import type { Matrix, Vector } from "./linalg.js";
import type { ConvexPolytope, ConvexPolytopeUnion, Halfspace } from "./geometry.js";

import { zip2map } from "./tools.js";
import * as linalg from "./linalg.js";
import { polytopeType, union } from "./geometry.js";


// State status coded as integer:
type StateKind = number;
// < 0: non-satisfying
// = 0: undecided
// > 0: satisfying
const OUTSIDE = -10;
const NONSATISFYING = -1;
const UNDECIDED = 0;
const SATISFYING = 1;


export class LSS {

    +dim: number;
    +A: Matrix;
    +B: Matrix;
    +stateSpace: ConvexPolytope;
    +randomSpace: ConvexPolytope;
    +controlSpace: ConvexPolytopeUnion;
    +oneStepReachable: ConvexPolytopeUnion;
    +extendedStateSpace: ConvexPolytopeUnion;

    constructor(A: Matrix, B: Matrix, stateSpace: ConvexPolytope, randomSpace: ConvexPolytope,
                controlSpace: ConvexPolytopeUnion): void {
        this.A = A;
        this.B = B;
        this.stateSpace = stateSpace;
        this.randomSpace = randomSpace;
        this.controlSpace = controlSpace;
        this.dim = stateSpace.dim;

        this.oneStepReachable = this.post(stateSpace, controlSpace);
        this.extendedStateSpace = union.disjunctify([this.stateSpace, ...this.oneStepReachable]);
    }

    decompose(predicates: Halfspace[]): AbstractedLSS {
        return new AbstractedLSS(this, predicates);
    }

    get extent(): Vector[] {
        let ext1 = union.extent(this.post(this.stateSpace, this.controlSpace));
        let ext2 = this.stateSpace.extent;
        return zip2map((a, b) => [Math.min(a[0], b[0]), Math.max(a[1], b[1])], ext1, ext2);
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

}


export class AbstractedLSS {

    +lss: LSS;
    +predicates: Map<string, Halfspace>; // TODO
    labelNum: number;
    states: State[];

    // TODO: labeled predicates
    constructor(lss: LSS, predicates: Halfspace[], predicateLabels?: (?string)[]): void {
        this.lss = lss;

        this.labelNum = 0;
        this.states = [];

        // Initial abstraction into states is given by decomposition and
        // partition of outside region into convex polytopes
        let outer = union.remove(this.lss.oneStepReachable, [this.lss.stateSpace]);
        for (let polytope of outer) {
            this.newState(polytope, OUTSIDE);
        }
        // TODO: use preciseOperatorPartition to split while attaching predicates!
        for (let polytope of this.lss.stateSpace.split(...predicates)) {
            this.newState(polytope, UNDECIDED);
        }

    }

    get extent(): Vector[] {
        return this.lss.extent;
    }

    newState(polytope: ConvexPolytope, kind: StateKind): State {
        let state = new State(this, this.genLabel(), polytope, kind);
        this.states.push(state);
        return state;
    }

    genLabel(): string {
        this.labelNum++;
        return "X" + this.labelNum.toString();
    }

    // Convenience wrappers for polytopic operators

    post(x: State, us: ConvexPolytopeUnion): ConvexPolytopeUnion {
        return this.lss.post(x.polytope, us);
    }

    pre(x: State, us: ConvexPolytopeUnion, ys: State[]): ConvexPolytopeUnion {
        return this.lss.pre(x.polytope, us, ys.map(y => y.polytope));
    }

    preR(x: State, us: ConvexPolytopeUnion, ys: State[]): ConvexPolytopeUnion {
        return this.lss.preR(x.polytope, us, ys.map(y => y.polytope));
    }

    attr(x: State, us: ConvexPolytopeUnion, ys: State[]): ConvexPolytopeUnion {
        return this.lss.attr(x.polytope, us, ys.map(y => y.polytope));
    }

    attrR(x: State, us: ConvexPolytopeUnion, ys: State[]): ConvexPolytopeUnion {
        return this.lss.attrR(x.polytope, us, ys.map(y => y.polytope));
    }

    actionPolytope(x: State, y: State) {
        return this.lss.actionPolytope(x.polytope, y.polytope);
    }

}


export class State {

    +system: AbstractedLSS;
    +polytope: ConvexPolytope;
    +label: string;
    +actions: Action[];
    _actions: ?Action[];
    kind: StateKind;

    constructor(system: AbstractedLSS, label: string, polytope: ConvexPolytope, kind: StateKind): void {
        this.system = system;
        this.polytope = polytope;
        this.label = label;
        this.kind = kind;
        this._actions = this.isOutside ? [] : null; // Outside states have no actions
    }

    get actions(): Action[] {
        if (this._actions != null) {
            return this._actions;
        } else {
            let reachableStates = this.oneStepReachable(this.system.lss.controlSpace);
            let op = target => this.actionPolytope(target);
            this._actions = preciseOperatorPartition(reachableStates, op).map(
                part => new Action(this, part.items, part.polys)
            );
            return this.actions;
        }
    }

    // State kind properties

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

    // Convenience wrappers for polytopic operators

    post(us: ConvexPolytopeUnion): ConvexPolytopeUnion {
        return this.system.post(this, us);
    }

    pre(us: ConvexPolytopeUnion, ys: State[]): ConvexPolytopeUnion {
        return this.system.pre(this, us, ys);
    }
    
    preR(us: ConvexPolytopeUnion, ys: State[]): ConvexPolytopeUnion {
        return this.system.preR(this, us, ys);
    } 
    
    attr(us: ConvexPolytopeUnion, ys: State[]): ConvexPolytopeUnion {
        return this.system.attr(this, us, ys);
    }
    
    attrR(us: ConvexPolytopeUnion, ys: State[]): ConvexPolytopeUnion {
        return this.system.attrR(this, us, ys);
    }

    oneStepReachable(us: ConvexPolytopeUnion): State[] {
        let post = this.post(us);
        return this.system.states.filter(state => !union.isEmpty(union.intersect(post, [state.polytope])));
    }

    actionPolytope(y: State): ConvexPolytopeUnion {
        return this.system.actionPolytope(this, y);
    }

}


export class Action {

    +origin: State;
    +targets: State[];
    +controls: ConvexPolytopeUnion;
    +supports: ActionSupport[];
    _supports: ?ActionSupport[];

    constructor(origin: State, targets: State[], controls: ConvexPolytopeUnion): void {
        this.origin = origin;
        this.targets = targets;
        this.controls = controls;
        this._supports = null;
    }

    get supports(): ActionSupport[] {
        if (this._supports != null) {
            return this._supports;
        } else {
            let op = target => this.origin.pre(this.controls, [target]);
            let prer = this.origin.preR(this.controls, this.targets);
            this._supports = preciseOperatorPartition(this.targets, op).map(
                part => new ActionSupport(this, part.items, union.intersect(part.polys, prer))
            );
            return this.supports;
        }
    }

        /*
    computeActionSupports(action: Action): ActionSupport[] {
        return sup;
        // TODO: turn this into a unit test
        let ps = [];
        let ok = true;
        for (let s of sup) {
            ps.push(...s.supports);
        }
        ok = ok && union.isSameAs(ps, [action.origin.polytope]);
        for (let s of sup) {
            for (let ss of sup) {
                //if (s === ss) continue;
                ok = ok && union.isEmpty(union.intersect(s.supports, ss.supports));
            }
        }
        console.log("support tests: ", ok);
    }
        */

}


export class ActionSupport {

    +action: Action;
    +targets: State[];
    +origins: ConvexPolytopeUnion;

    constructor(action: Action, targets: State[], origins: ConvexPolytopeUnion): void {
        this.action = action;
        this.targets = targets;
        this.origins = origins;
    }

}


type PrecisePart<T> = { polys: ConvexPolytopeUnion, items: T[] };
function preciseOperatorPartition<T>(items: T[], operator: (T) => ConvexPolytopeUnion): PrecisePart<T>[] {
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

