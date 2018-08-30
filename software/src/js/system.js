// @flow
"use strict";

import type { Matrix, Vector } from "./linalg.js";
import type { ConvexPolytope, ConvexPolytopeUnion, Halfspace } from "./geometry.js";
import type { GameGraph } from "./game.js";

import { iter, arr, sets, ValueError } from "./tools.js";
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
        const ext1 = union.extent(this.post(this.stateSpace, this.controlSpace));
        const ext2 = this.stateSpace.extent;
        return arr.zip2map((a, b) => [Math.min(a[0], b[0]), Math.max(a[1], b[1])], ext1, ext2);
    }

    eval(x: Vector, u: Vector, w: Vector): Vector {
        return linalg.add(linalg.add(linalg.apply(this.A, x), linalg.apply(this.B, u)), w);
    }

    // Posterior: Post(x, {u0, ...})
    post(x: ConvexPolytope, us: ConvexPolytopeUnion): ConvexPolytopeUnion {
        const xvs = x.vertices;
        const wvs = this.randomSpace.vertices;
        const posts = [];
        for (let u of us) {
            const uvs = u.vertices;
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
        const pres = [];
        for (let u of us) {
            // Minkowski sum: hull of translated vertices (union of translated polygons)
            const Bupws = linalg.minkowski.axpy(this.B, u.vertices, this.randomSpace.vertices);
            for (let y of ys) {
                const pre = polytopeType(this.dim).hull(linalg.minkowski.xmy(y.vertices, Bupws));
                pres.push(x.intersect(pre.applyRight(this.A)));
            }
        }
        return union.disjunctify(pres);
    }

    // Robust Predecessor: PreR(x, {u0, ...}, {y0, ...})
    preR(x: ConvexPolytope, us: ConvexPolytopeUnion, ys: ConvexPolytopeUnion): ConvexPolytopeUnion {
        const pontrys = union.pontryagin(ys, this.randomSpace);
        const prers = [];
        for (let u of us) {
            const Bus = u.vertices.map(uv => linalg.apply(this.B, uv));
            for (let pontry of pontrys) {
                const poly = polytopeType(this.dim).hull(linalg.minkowski.xmy(pontry.vertices, Bus));
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
        const Axpws = linalg.minkowski.axpy(this.A, x.vertices, this.randomSpace.vertices);
        const poly = polytopeType(this.dim).hull(linalg.minkowski.xmy(y.vertices, Axpws));
        return union.intersect([poly.applyRight(this.B)], this.controlSpace);
    }

}


/* LSS with state space abstraction */

// State status coded as integer:
export type StateKind = -10 | -1 | 0 | 1;
// < 0: non-satisfying
// = 0: undecided
// > 0: satisfying
const OUTER = -10;
const NONSATISFYING = -1;
const UNDECIDED = 0;
const SATISFYING = 1;

export type StateID = string;
export type ActionID = number;
export type SupportID = number;
export type PredicateID = string;

// Strategies
export type StrategyGenerator = () => Strategy;
type Strategy = (AbstractedLSS, Vector) => Vector; // strategies must maintain their own memory

// Traces
export type Trace = TraceStep[];
type TraceStep = {
    origin: Vector;
    target: Vector;
    control: Vector;
    random: Vector;
};

// Snapshots
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
        // partition of outer region into convex polytopes
        const outer = union.remove(this.lss.oneStepReachable, [this.lss.stateSpace]);
        for (let polytope of outer) {
            this.newState(polytope, OUTER);
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

    // Analysis and refinement

    // Update the states according to the result of a game analysis. Returns
    // those states whose kind was changed.
    updateKinds(satisfying: Set<StateID>, nonSatisfying: Set<StateID>): Set<State> {
        const updated = new Set();
        for (let [label, state] of this.states.entries()) {
            let wasUpdated = false;
            if (satisfying.has(label)) {
                if (state.isNonSatisfying) throw new Error(
                    "nonsat state now sat, which should not happen..." // TODO
                );
                wasUpdated = !state.isSatisfying;
                state.kind = SATISFYING;
            } else if (nonSatisfying.has(label)) {
                if (state.isSatisfying) throw new Error(
                    "sat state now nonsat, which should not happen..." // TODO
                );
                wasUpdated = state.isUndecided;
                state.kind = state.isOuter ? OUTER : NONSATISFYING;
            } else {
                if (!state.isUndecided) throw new Error(
                    "sat/nonsat state has become undecided, which should not happen..." // TODO
                );
            }
            if (wasUpdated) {
                updated.add(state);
            }
        }
        return updated;
    }

    refine(partitions: Map<State, ConvexPolytopeUnion>): Set<State> {
        const refined = new Set();
        for (let [state, partition] of partitions.entries()) {
            // Validate that partition covers state polytope
            if (!union.isSameAs([state.polytope], partition)) throw new Error(
                "Faulty partition" // TODO
            );
            // If partition does not change state, keep it and continue
            if (partition.length === 1) continue;
            // Create new states for partition elements with same properties as
            // original state
            for (let poly of partition) {
                this.newState(poly, state.kind, state.predicates);
            }
            // Remove the original state
            this.states.delete(state.label);
            refined.add(state);
        }
        this.resetActions(refined);
        return refined;
    }

    resetActions(targets?: Set<State>): void {
        for (let state of this.states.values()) {
            state.resetActions(targets);
        }
    }

    // Trace sampling

    stateOf(x: Vector): ?State {
        for (let state of this.states.values()) {
            if (state.polytope.contains(x)) {
                return state;
            }
        }
        return null;
    }

    sampleTrace(init: Vector, strategy: Strategy, steps: number): Trace {
        // Trace starts from given location
        let x = init;
        // Take requested number of steps or end trace when it has left the
        // state space polytope
        const trace = [];
        while (trace.length < steps && this.lss.stateSpace.contains(x)) {
            // Obtain the control input from the strategy
            const u = strategy(this, x);
            // Sample the random space polytope
            const w = this.lss.randomSpace.sample();
            // Evaluate the evolution equation to obtain the next point
            const xx = this.lss.eval(x, u, w);
            trace.push({ origin: x, target: xx, control: u, random: w });
            x = xx;
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
    _reachable: Set<State>;

    constructor(system: AbstractedLSS, label: StateID, polytope: ConvexPolytope, kind: StateKind,
                predicates?: Iterable<PredicateID>): void {
        this.system = system;
        this.polytope = polytope;
        this.label = label;
        this.kind = kind;
        this.predicates = new Set(predicates == null ? [] : predicates);
        this.resetActions(); // initializes _actions and _reachable
        this._reachable = new Set();
    }

    // Lazy evaluation and memoization of actions
    get actions(): Action[] {
        if (this._actions != null) {
            return this._actions;
        } else {
            const op = target => this.actionPolytope(target);
            this._reachable = this.oneStepReachable(this.system.lss.controlSpace);
            this._actions = preciseOperatorPartition(this._reachable, op).map(
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

    get isOuter(): boolean {
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

    // Always use this function, never use _reachable. It exists only for
    // resetActions and is generally NOT the current one-step reachable set.
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

    resetActions(targets?: Set<State>): void {
        // _reachable contains the last known set of action targets, if any
        // invalidated target is in there, the actions have to be reset.
        // The set _reachable will then be recomputed on demand in the actions
        // getter. It is ok for _reachable to be empty is no actions have been
        // computed yet as there is nothing to reset in that case anyway.
        if (this._actions == null || targets == null || sets.doIntersect(this._reachable, targets)) {
            this._actions = this.isOuter ? [] : null; // Outer states have no actions
            this._reachable = new Set();
        }
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
            const op = target => this.origin.pre(this.controls, [target]);
            const prer = union.simplify(this.origin.preR(this.controls, this.targets));
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

