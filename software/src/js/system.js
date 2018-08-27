// @flow
"use strict";

import type { Matrix, Vector } from "./linalg.js";
import type { ConvexPolytope, ConvexPolytopeUnion, Halfspace } from "./geometry.js";
import type { GameGraph } from "./game.js";

import { iter, arr, ValueError } from "./tools.js";
import * as linalg from "./linalg.js";
import { polytopeType, union } from "./geometry.js";


type PrecisePart<T> = { polys: ConvexPolytopeUnion, items: T[] };
// Partition the region operator(items) based on each operator(items[i]) and
// associate the items with each corresponding part.
function preciseOperatorPartition<T>(items: Iterable<T>, operator: (T) => ConvexPolytopeUnion): PrecisePart<T>[] {
    let parts = [];
    for (let item of items) {
        // Collect new parts in a separate array so they are not visited
        // immediately when looping over the existing parts
        let newParts = [];
        // Start with the set (points in space, represented as a union of
        // convex polytopes) that is related to the current item
        let remaining = operator(item);
        // Refine existing parts according to the current item
        for (let part of parts) {
            if (union.isEmpty(remaining)) {
                break;
            }
            let common = union.intersect(remaining, part.polys);
            // The subset that the current item and the existing part have in
            // common must be associated with the current item too
            if (!union.isEmpty(common)) {
                let notCommon = union.remove(part.polys, common);
                // If all of the part's set is associated with the current
                // item, extend the association of the part, else split the set
                // into a subset that is still exclusively associated with the
                // part and a subset that is also associated with the current
                // item (a new part)
                if (union.isEmpty(notCommon)) {
                    part.items.push(item);
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
        parts.push(...newParts);
    }
    return parts;
}


/* Linear Stochastic System */

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

    decompose(predicates: Halfspace[], predicateLabels?: string[]): AbstractedLSS {
        return new AbstractedLSS(this, predicates, predicateLabels);
    }

    get extent(): [number, number][] {
        let ext1 = union.extent(this.post(this.stateSpace, this.controlSpace));
        let ext2 = this.stateSpace.extent;
        return arr.zip2map((a, b) => [Math.min(a[0], b[0]), Math.max(a[1], b[1])], ext1, ext2);
    }

    eval(x: Vector, u: Vector, w: Vector): Vector {
        return linalg.add(linalg.add(linalg.apply(this.A, x), linalg.apply(this.B, u)), w);
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
        return union.disjunctify(posts);
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
        return union.disjunctify(pres);
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
        return union.disjunctify(prers);
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


/* LSS with state space abstraction */

// State status coded as integer:
export type StateKind = -10 | -1 | 0 | 1;
// < 0: non-satisfying
// = 0: undecided
// > 0: satisfying
const OUTSIDE = -10;
const NONSATISFYING = -1;
const UNDECIDED = 0;
const SATISFYING = 1;

export type StateID = string;
export type ActionID = number;
export type SupportID = number;
export type PredicateID = string;

// Strategies
export type StrategyGenerator = () => Strategy;
type Strategy = (State) => Vector; // strategies must maintain their own memory

// Traces
export type Trace = Vector[];


export class AbstractedLSS implements GameGraph {

    +lss: LSS;
    +states: Map<StateID, State>;
    +predicates: Map<PredicateID, Halfspace>; // TODO
    labelNum: number;

    constructor(lss: LSS, predicates: Halfspace[], predicateLabels?: PredicateID[]): void {
        this.lss = lss;
        this.labelNum = 0;
        this.states = new Map();

        // Initial abstraction into states is given by decomposition and
        // partition of outside region into convex polytopes
        let outer = union.remove(this.lss.oneStepReachable, [this.lss.stateSpace]);
        for (let polytope of outer) {
            this.newState(polytope, OUTSIDE);
        }

        // Collect named predicates
        const labeledPredicates = arr.zip2map(
            (pred, label) => [label, pred],
            predicates,
            predicateLabels == null ? predicates.map(pred => "") : predicateLabels
        );
        this.predicates = new Map(labeledPredicates.filter(lp => lp[0].length > 0));
        // Split state space according to given predicates
        preciseOperatorPartition(labeledPredicates, lp => {
            return [this.lss.stateSpace.intersect(lp[1])];
        }).forEach(part => {
            if (part.polys.length > 1) throw new Error(
                "State space was not split properly by linear predicates"
            );
            this.newState(part.polys[0], UNDECIDED, part.items.map(lp => lp[0]).filter(l => l.length > 0));
        });
        // Add the part of the state space not covered by any predicate
        const leftOverPoly = this.lss.stateSpace.intersect(...predicates.map(p => p.flip()));
        if (!leftOverPoly.isEmpty) {
            this.newState(leftOverPoly, UNDECIDED, []);
        }
    }

    get extent(): [number, number][] {
        return this.lss.extent;
    }

    newState(polytope: ConvexPolytope, kind: StateKind, predicates?: Iterable<PredicateID>): State {
        const label = this.genLabel();
        const state = new State(this, label, polytope, kind, predicates);
        this.states.set(label, state);
        return state;
    }

    genLabel(): StateID {
        this.labelNum++;
        return "X" + this.labelNum.toString();
    }

    getPredicate(label: PredicateID): Halfspace {
        const pred = this.predicates.get(label);
        if (pred == null) throw new Error(
            "..." // TODO
        );
        return pred;
    }

    stateOf(x: Vector): ?State {
        for (let state of this.states.values()) {
            if (state.polytope.contains(x)) {
                return state;
            }
        }
        return null;
    }

    // Trace sampling
    sampleTrace(init: Vector, strategy: Strategy, steps: number): Trace {
        // Trace starts from given location
        const trace = [init];
        // Take requested number of steps
        while (trace.length < steps + 1) {
            const x = trace[trace.length - 1];
            // Find corresponding system state
            const state = this.stateOf(x);
            // End trajectory when it leaves the state space polytope
            if (state == null || state.isOutside) {
                break;
            }
            // Obtain the control input from the strategy
            const u = strategy(state);
            // Sample the random space polytope
            const w = this.lss.randomSpace.sample();
            // Evaluate the evolution equation to obtain the next point
            trace.push(this.lss.eval(x, u, w));
        }
        return trace;
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

    // AbstractLSSGraph Interface

    get stateLabels(): Set<StateID> {
        return new Set(this.states.keys());
    }

    predicateLabelsOf(stateLabel: StateID): Set<PredicateID> {
        const state = this.states.get(stateLabel);
        if (state == null) throw new ValueError(
            "State with label '" + stateLabel + "' not found."
        );
        return state.predicates;
    }

    actionCountOf(stateLabel: StateID): number {
        const state = this.states.get(stateLabel);
        if (state == null) throw new ValueError(
            "State with label '" + stateLabel + "' not found."
        );
        return state.actions.length;
    }

    supportCountOf(stateLabel: StateID, actionId: ActionID): number {
        const state = this.states.get(stateLabel);
        if (state == null) throw new ValueError(
            "State with label '" + stateLabel + "' not found."
        );
        return state.actions[actionId].supports.length;
    }

    targetLabelsOf(stateLabel: StateID, actionId: ActionID, supportId: SupportID): Set<string> {
        const state = this.states.get(stateLabel);
        if (state == null) throw new ValueError(
            "State with label '" + stateLabel + "' not found."
        );
        return new Set(iter.map(s => s.label, state.actions[actionId].supports[supportId].targets));
    }

    // JSON compatible representation
    snapshot(includeGeometry: boolean): Snapshot {
        // Add states
        const states = {};
        for (let state of this.states.values()) {
            states[state.label] = {
                vertices: includeGeometry ? Array.from(state.polytope.vertices) : [],
                predicates: Array.from(state.predicates),
                actions: state.actions.map(
                    action => action.supports.map(
                        support => support.targets.map(
                            target => target.label
                        )
                    )
                )
            };
        }
        return {
            predicates: {}, // TODO
            states: states
        };
    }

}


export class State {

    +system: AbstractedLSS;
    +polytope: ConvexPolytope;
    +label: StateID;
    +predicates: Set<PredicateID>;
    +actions: Action[];
    _actions: ?Action[];
    kind: StateKind;

    constructor(system: AbstractedLSS, label: StateID, polytope: ConvexPolytope, kind: StateKind,
                predicates?: Iterable<PredicateID>): void {
        this.system = system;
        this.polytope = polytope;
        this.label = label;
        this.kind = kind;
        this.predicates = new Set(predicates == null ? [] : predicates);
        this._actions = this.isOutside ? [] : null; // Outside states have no actions
    }

    // Lazy evaluation and memoization of actions
    get actions(): Action[] {
        if (this._actions != null) {
            return this._actions;
        } else {
            let reachableStates = this.oneStepReachable(this.system.lss.controlSpace);
            let op = target => this.actionPolytope(target);
            this._actions = preciseOperatorPartition(reachableStates, op).map(
                part => new Action(this, part.items, union.simplify(part.polys))
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

    oneStepReachable(us: ConvexPolytopeUnion): Set<State> {
        const post = this.post(us);
        const out = new Set();
        for (let state of this.system.states.values()) {
            if (!union.isEmpty(union.intersect(post, [state.polytope]))) out.add(state);
        }
        return out;
    }

    actionPolytope(y: State): ConvexPolytopeUnion {
        return this.system.actionPolytope(this, y);
    }

}


export class Action {

    +origin: State;
    +targets: State[]; // TODO: Set<State> (?)
    +controls: ConvexPolytopeUnion;
    +supports: ActionSupport[];
    _supports: ?ActionSupport[];

    constructor(origin: State, targets: State[], controls: ConvexPolytopeUnion): void {
        this.origin = origin;
        this.targets = targets;
        this.controls = controls;
        this._supports = null;
    }

    // Lazy evaluation and memoization of action supports
    get supports(): ActionSupport[] {
        if (this._supports != null) {
            return this._supports;
        } else {
            let op = target => this.origin.pre(this.controls, [target]);
            let prer = union.simplify(this.origin.preR(this.controls, this.targets));
            this._supports = preciseOperatorPartition(this.targets, op).map(
                part => new ActionSupport(this, part.items, union.simplify(union.intersect(part.polys, prer)))
            );
            return this.supports;
        }
    }

}


export class ActionSupport {

    +action: Action;
    +targets: State[]; // TODO: Set<State> (?)
    +origins: ConvexPolytopeUnion;

    constructor(action: Action, targets: State[], origins: ConvexPolytopeUnion): void {
        this.action = action;
        this.targets = targets;
        this.origins = origins;
    }

}



/* Snapshot */

// TODO
export type Snapshot = {
    predicates: { [string]: {} },
    states: {
        [string]: {
            vertices: Vector[],
            predicates: string[],
            actions: (string[])[]
        }
    }
};

