// @flow
"use strict";

import type { Controller } from "./controller.js";
import type { GameGraph, JSONGameGraph, AnalysisResults } from "./game.js";
import type { JSONPolytope, JSONUnion, JSONHalfspace, Region } from "./geometry.js";
import type { Matrix, Vector } from "./linalg.js";

import { Polytope, Halfspace, Union } from "./geometry.js";
import * as linalg from "./linalg.js";
import { just, iter, arr, sets } from "./tools.js";


// Partitioning that keeps track of items causing the partition. Used for
// action and support computation as well as LSS decomposition.
type ItemizedPart<T> = { region: Region, items: T[] };
// Partition the region of operator-transformed items based on the individual
// operator(items[i]) results and associate the corresponding items with each
// part (accumulating items when there is overlap).
export function itemizedOperatorPartition<T>(items: Iterable<T>, operator: (T) => Region): ItemizedPart<T>[] {
    const parts = [];
    for (let item of items) {
        // Collect new parts in a separate array so they are not visited
        // immediately when looping over the existing parts
        const newParts = [];
        // Start with the set that is related to the current item
        let remaining = operator(item);
        // Refine existing parts according to the current item
        for (let part of parts) {
            if (remaining.isEmpty) {
                break;
            }
            const common = remaining.intersect(part.region);
            // The subset that the current item and the existing part have in
            // common must be associated with the current item too
            if (!common.isEmpty) {
                const notCommon = part.region.remove(common);
                // If all of the part's set is associated with the current
                // item, extend the association of the part, else split the set
                // into a subset that is still exclusively associated with the
                // part and a subset that is also associated with the current
                // item (a new part)
                if (notCommon.isEmpty) {
                    part.items.push(item);
                } else {
                    part.region = notCommon;
                    newParts.push({ region: common, items: part.items.concat([item]) });
                }
                // Remove the just processed subset of remaining
                remaining = remaining.remove(common);
            }
        }
        // What is not common with the already existing parts is a new part
        // that is (for now) exclusively associated with the current item
        if (!remaining.isEmpty) {
            newParts.push({ region: remaining, items: [item] });
        }
        parts.push(...newParts);
    }
    return parts;
}


/* Linear Stochastic System */

export type JSONLSS = {
    A: number[][], // matrix
    B: number[][], // matrix
    stateSpace: JSONPolytope,
    randomSpace: JSONPolytope,
    controlSpace: JSONPolytope
};

export class LSS {

    +dim: number;
    +A: Matrix;
    +B: Matrix;
    +xx: Polytope;
    +xxExt: Region;
    +ww: Polytope;
    +uu: Polytope;
    +oneStepReachable: Region;

    constructor(A: Matrix, B: Matrix, stateSpace: Polytope, randomSpace: Polytope,
                controlSpace: Polytope): void {
        this.A = A;
        this.B = B;
        this.xx = stateSpace;
        this.ww = randomSpace;
        this.uu = controlSpace;
        this.dim = stateSpace.dim;
        this.oneStepReachable = this.post(stateSpace, controlSpace);
        this.xxExt = stateSpace.union(this.oneStepReachable).simplify();
    }

    static deserialize(json: JSONLSS): LSS {
        return new LSS(
            json.A,
            json.B,
            Polytope.deserialize(json.stateSpace),
            Polytope.deserialize(json.randomSpace),
            Polytope.deserialize(json.controlSpace)
        );
    }

    get extent(): [number, number][] {
        return this.xxExt.extent;
    }

    eval(x: Vector, u: Vector, w: Vector): Vector {
        return linalg.add(linalg.add(linalg.apply(this.A, x), linalg.apply(this.B, u)), w);
    }

    // Posterior: Post(x, {u0, ...})
    post(x: Polytope, us: Region): Region {
        const xvs = x.vertices;
        const wvs = this.ww.vertices;
        const posts = [];
        for (let u of us.polytopes) {
            const Bupws = linalg.minkowski.axpy(this.B, u.vertices, wvs);
            posts.push(Polytope.ofDim(this.dim).hull(linalg.minkowski.axpy(this.A, xvs, Bupws)));
        }
        return Union.from(posts, this.dim).simplify();
    }

    // Predecessor: Pre(x, {u0, ...}, {y0, ...})
    pre(x: Polytope, us: Region, ys: Region): Region {
        const pres = [];
        for (let u of us.polytopes) {
            const Bupws = linalg.minkowski.axpy(this.B, u.vertices, this.ww.vertices);
            for (let y of ys.polytopes) {
                const pre = Polytope.ofDim(this.dim).hull(linalg.minkowski.xmy(y.vertices, Bupws));
                pres.push(x.intersect(pre.applyRight(this.A)));
            }
        }
        return Union.from(pres, this.dim).simplify();
    }

    // Robust Predecessor: PreR(x, {u0, ...}, {y0, ...})
    preR(x: Polytope, us: Region, ys: Region): Region {
        const pontrys = ys.pontryagin(this.ww);
        if (pontrys.isEmpty) {
            return Polytope.ofDim(x.dim).empty();
        }
        const prers = [];
        for (let u of us.polytopes) {
            const Bus = u.vertices.map(uv => linalg.apply(this.B, uv));
            for (let pontry of pontrys.polytopes) {
                const poly = Polytope.ofDim(this.dim).hull(linalg.minkowski.xmy(pontry.vertices, Bus));
                prers.push(x.intersect(poly.applyRight(this.A)));
            }
        }
        return Union.from(prers, this.dim).simplify();
    }

    // Attractor: Attr(x, {u0, ...}, {y0, ...})
    attr(x: Polytope, us: Region, ys: Region): Region {
        return x.remove(this.preR(x, us, this.xxExt.remove(ys)));
    }

    // Robust Attractor: AttrR(x, {u0, ...}, {y0, ...})
    attrR(x: Polytope, us: Region, ys: Region): Region {
        return x.remove(this.pre(x, us, this.xxExt.remove(ys)));
    }

    // Action polytope
    act(x: Polytope, y: Region): Region {
        const Axpw = Polytope.ofDim(this.dim).hull(
            linalg.minkowski.axpy(this.A, x.vertices, this.ww.vertices)
        );
        return y.minkowski(Axpw.invert()).applyRight(this.B).intersect(this.uu);
    }

    // Robust action polytope
    actR(x: Polytope, y: Region): Region {
        const Axpw = Polytope.ofDim(this.dim).hull(
            linalg.minkowski.axpy(this.A, x.vertices, this.ww.vertices)
        );
        return y.pontryagin(Axpw).applyRight(this.B).intersect(this.uu);
    }

    zNonZero(xs: Region): Region {
        return xs.minkowski(this.ww.invert()).simplify();
    }

    zOne(xs: Region): Region {
        return xs.pontryagin(this.ww);
    }

    // Split state space with linear predicates to create an AbstractedLSS
    decompose(predicates: Halfspace[], predicateLabels?: PredicateID[]): AbstractedLSS {
        const system = new AbstractedLSS(this);
        // Initial abstraction into states is given by decomposition and
        // partition of outer region into convex polytopes
        const outer = this.oneStepReachable.remove(this.xx);
        for (let polytope of outer.polytopes) {
            system.newState(polytope, true);
        }
        // Collect named predicates
        predicateLabels = predicateLabels == null ? predicates.map(_ => "") : predicateLabels;
        for (let [label, predicate] of arr.zip2(predicateLabels, predicates)) {
            if (label.length > 0) system.predicates.set(label, predicate);
        }
        // Split state space according to given predicates
        const partition = itemizedOperatorPartition(
            arr.zip2(predicateLabels, predicates),
            ([label, predicate]) => this.xx.split(predicate)[0]
        );
        for (let part of partition) {
            if (part.region.polytopes.length !== 1) throw new Error(
                "State space was not split properly by linear predicates"
            );
            system.newState(part.region.polytopes[0], false, part.items.map(_ => _[0]).filter(_ => _.length > 0));
        }
        // Add the part of the state space not covered by any predicate
        let leftOverPoly = this.xx;
        for (let predicate of predicates) {
            leftOverPoly = leftOverPoly.split(predicate)[1];
        }
        if (!leftOverPoly.isEmpty) {
            system.newState(leftOverPoly, false, []);
        }
        return system;
    }

    // JSON-compatible serialization
    serialize(): JSONLSS {
        return {
            A: this.A,
            B: this.B,
            stateSpace: this.xx.serialize(),
            randomSpace: this.ww.serialize(),
            controlSpace: this.uu.serialize()
        };
    }

}


/* LSS with state space abstraction */

// Type aliases for identifier types
export type StateID = string;
export type ActionID = number;
export type SupportID = number;
export type PredicateID = string;

export type RefinementMap = Map<State, Set<State>>;

// Serialization of entire system (optionally with actions)
export type JSONAbstractedLSS = {
    lss: JSONLSS,
    predicates: { [PredicateID]: JSONHalfspace },
    states: JSONState[],
    _labelNum: number
};

// Implements GameGraph interface for product with objective automaton
export class AbstractedLSS implements GameGraph {

    // TODO: implement a verification function that can be called after
    //       construction to make sure system and LSS are not in conflict
    //       (test outer states, state space coverage, etc.)

    +lss: LSS;
    +states: Map<StateID, State>;
    +predicates: Map<PredicateID, Halfspace>;
    +_epsPolytope: Polytope;
    _labelNum: number;

    // Empty system (only for custom system construction)
    constructor(lss: LSS): void {
        this.lss = lss;
        this.states = new Map();
        this.predicates = new Map();
        // Polytopes smaller than this size will not be refined to avoid
        // numerical instability and state space explosion with very small
        // polytopes
        this._epsPolytope = lss.ww.scale(0.1);
        this._labelNum = 0;
    }

    // Recover an AbstractedLSS instance from its JSON serialization
    static deserialize(json: JSONAbstractedLSS): AbstractedLSS {
        const system = new AbstractedLSS(LSS.deserialize(json.lss));
        // labelNum
        system._labelNum = json._labelNum;
        // Add predicates
        for (let label in json.predicates) {
            system.predicates.set(label, Halfspace.deserialize(json.predicates[label]));
        }
        // Add states
        for (let jsonState of json.states) {
            // Don't restore actions, as not all states are restored yet and
            // action targets may not be found
            const state = State.deserialize(jsonState, system, false);
            system.states.set(state.label, state);
        }
        // All states have been restored, now add actions
        for (let jsonState of json.states) {
            const state = system.getState(jsonState.label);
            state._restoreActions(jsonState.actions);
        }
        return system;
    }

    // Axis-aligned extent
    get extent(): [number, number][] {
        return this.lss.extent;
    }

    // Create a new state, with an automatically generated label
    newState(polytope: Polytope, isOuter: boolean, predicates?: Iterable<PredicateID>): State {
        const label = this.genLabel();
        const state = new State(this, label, polytope, isOuter, predicates);
        this.states.set(label, state);
        return state;
    }

    // Generate a label for a new state
    genLabel(): StateID {
        this._labelNum++;
        const label = "X" + this._labelNum.toString();
        // If the label already exists for some reason, pick another one
        return this.states.has(label) ? this.genLabel() : label;
    }

    // Obtain state by label, throws an error if it does not exist
    getState(label: StateID): State {
        return just(
            this.states.get(label),
            "A state with label '" + label + "' does not exist"
        );
    }

    // Obtain predicate by label, throws an error if it does not exist
    getPredicate(label: PredicateID): Halfspace {
        return just(
            this.predicates.get(label),
            "A predicate with label '" + label + "' does not exist"
        );
    }

    // Get state which contains the point in state space
    stateOf(x: Vector): ?State {
        for (let state of this.states.values()) {
            if (state.polytope.contains(x)) {
                return state;
            }
        }
        return null;
    }

    // Refine states according to the given partitionings. Returns mapping of
    // old refined states to sets of new states that were substituted
    refine(partitions: Map<State, Region>): RefinementMap {
        const refined = new Map();
        for (let [state, partition] of partitions) {
            // To improve numerical stability, refuse refinement of small
            // states even if a parition is given
            if (state._isEpsSmall) continue;
            // Validate that partition covers state polytope
            // TODO: test disjunctness
            if (!state.polytope.isSameAs(partition)) throw new Error(
                "Partition for state " + state.label + " does not cover the entire state"
            );
            // If partition does not change state, keep it and continue
            if (partition.polytopes.length === 1) continue;
            // Create new states for partition elements with same properties as
            // original state
            const newStates = new Set();
            for (let poly of partition.polytopes) {
                newStates.add(this.newState(poly, state.isOuter, state.predicates));
            }
            refined.set(state, newStates);
            // Remove the original state
            this.states.delete(state.label);
        }
        this.resetActions(new Set(refined.keys()));
        return refined;
    }

    // Call the resetActions on all states of the system
    resetActions(targets?: Set<State>): void {
        for (let state of this.states.values()) {
            state.resetActions(targets);
        }
    }

    /* Convenience wrappers for polytopic operators */

    post(x: State, us: Region): Region {
        return this.lss.post(x.polytope, us);
    }

    pre(x: State, us: Region, ys: Iterable<State>): Region {
        return this.lss.pre(x.polytope, us, Union.from(Array.from(ys, y => y.polytope), this.lss.dim));
    }

    preR(x: State, us: Region, ys: Iterable<State>): Region {
        return this.lss.preR(x.polytope, us, Union.from(Array.from(ys, y => y.polytope), this.lss.dim));
    }

    attr(x: State, us: Region, ys: Iterable<State>): Region {
        return this.lss.attr(x.polytope, us, Union.from(Array.from(ys, y => y.polytope), this.lss.dim));
    }

    attrR(x: State, us: Region, ys: Iterable<State>): Region {
        return this.lss.attrR(x.polytope, us, Union.from(Array.from(ys, y => y.polytope), this.lss.dim));
    }

    act(x: State, y: State): Region {
        return this.lss.act(x.polytope, y.polytope);
    }

    actR(x: State, y: State): Region {
        return this.lss.actR(x.polytope, y.polytope);
    }

    zNonZero(xs: Iterable<State>): Region {
        return this.lss.zNonZero(Union.from(Array.from(xs, x => x.polytope), this.lss.dim));
    }

    zOne(xs: Iterable<State>): Region {
        return this.lss.zOne(Union.from(Array.from(xs, x => x.polytope), this.lss.dim));
    }

    /* GameGraph Interface */

    get stateLabels(): Set<StateID> {
        return new Set(this.states.keys());
    }

    predicateLabelsOf(stateLabel: StateID): Set<PredicateID> {
        return just(
            this.states.get(stateLabel),
            "State with label '" + stateLabel + "' not found."
        ).predicates;
    }

    actionCountOf(stateLabel: StateID): number {
        return just(
            this.states.get(stateLabel),
            "State with label '" + stateLabel + "' not found."
        ).actions.length;
    }

    supportCountOf(stateLabel: StateID, actionId: ActionID): number {
        return just(
            this.states.get(stateLabel),
            "State with label '" + stateLabel + "' not found."
        ).actions[actionId].supports.length;
    }

    targetLabelsOf(stateLabel: StateID, actionId: ActionID, supportId: SupportID): Set<string> {
        const state = just(
            this.states.get(stateLabel),
            "State with label '" + stateLabel + "' not found."
        );
        return new Set(iter.map(s => s.label, state.actions[actionId].supports[supportId].targets));
    }

    /* Serialization */

    // JSON-compatible serialization for game analysis. If previous analysis
    // results are supplied, a simplified game graph will be constructed
    // without actions for already decided states. The same analysis results
    // must then be given to the game-automaton product construction as well or
    // the resulting product game will most likely be wrong.
    serializeGameGraph(analysis?: ?AnalysisResults): JSONGameGraph {
        const states = {};
        for (let [label, state] of this.states) {
            const result = analysis == null ? null : analysis.get(label);
            let actions = [];
            // Actions and supports only have to be evaluated if the state is
            // not fully decided yet.
            if (result == null || result.maybe.size !== 0) {
                actions = state.actions.map(
                    action => action.supports.map(
                        support => Array.from(support.targets, target => target.label)
                    )
                );
            }
            states[label] = {
                predicates: Array.from(state.predicates),
                actions: actions
            };
        }
        return states;
    }

    // JSON-compatible serialization for saving/loading
    serialize(includeGraph?: boolean): JSONAbstractedLSS {
        // Predicates
        const predicates = {};
        for (let [label, predicate] of this.predicates) {
            predicates[label] = predicate.serialize();
        }
        return {
            lss: this.lss.serialize(),
            predicates: predicates,
            states: Array.from(iter.map(_ => _.serialize(includeGraph), this.states.values())),
            _labelNum: this._labelNum
        }
    }

}


/* State of an AbstractedLSS */

// JSON-compatible serialization
type JSONState = {
    label: StateID,
    polytope: JSONPolytope,
    isOuter: boolean,
    predicates: PredicateID[],
    actions: JSONAction[] | null;
};

export class State {

    +system: AbstractedLSS;
    +label: StateID;
    +polytope: Polytope;
    +isOuter: boolean;
    +predicates: Set<PredicateID>;
    +actions: Action[];
    _actions: ?Action[];
    _reachable: Set<State>;
    +_isEpsSmall: boolean;

    constructor(system: AbstractedLSS, label: StateID, polytope: Polytope, isOuter: boolean, predicates?: Iterable<PredicateID>): void {
        this.system = system;
        this.label = label;
        this.polytope = polytope;
        this.isOuter = isOuter;
        this.predicates = new Set(predicates == null ? [] : predicates);
        this._actions = null;
        this.resetActions(); // initializes _actions and _reachable
        this._isEpsSmall = polytope.pontryagin(system._epsPolytope).isEmpty;
    }

    static deserialize(json: JSONState, system: AbstractedLSS, restoreActions?: boolean): State {
        const polytope = Polytope.deserialize(json.polytope);
        const state = new State(system, json.label, polytope, json.isOuter, json.predicates);
        // If they are part of the backup and restoration is desired, restore
        // actions. This will fail if the target states are not available in
        // the system (yet). The deserialization of AbstractedLSS therefore
        // omits this step and calls _restoreActions separately later.
        if (restoreActions == null || restoreActions) {
            state._restoreActions(json.actions);
        }
        return state;
    }

    _restoreActions(json: null|JSONAction[]): void {
        if (json == null) return;
        this._actions = json.map(_ => Action.deserialize(_, this));
        // Restore the internal _reachable set
        const reachable = new Set();
        for (let action of this._actions) {
            for (let target of action.targets) {
                reachable.add(target);
            }
        }
        this._reachable = reachable;
    }

    // Lazy evaluation and memoization of actions
    get actions(): Action[] {
        if (this._actions != null) {
            return this._actions;
        } else {
            const op = target => this.act(target);
            this._reachable = this.oneStepReachable(this.system.lss.uu);
            this._actions = itemizedOperatorPartition(this._reachable, op).map(
                part => new Action(this, part.items, part.region.simplify())
            );
            return this.actions;
        }
    }

    /* Convenience wrappers for polytopic operators */

    post(us: Region): Region {
        return this.system.post(this, us);
    }

    pre(us: Region, ys: Iterable<State>): Region {
        return this.system.pre(this, us, ys);
    }
    
    preR(us: Region, ys: Iterable<State>): Region {
        return this.system.preR(this, us, ys);
    } 
    
    attr(us: Region, ys: Iterable<State>): Region {
        return this.system.attr(this, us, ys);
    }
    
    attrR(us: Region, ys: Iterable<State>): Region {
        return this.system.attrR(this, us, ys);
    }

    // Always use this function, never use _reachable. It exists only for
    // resetActions and is generally NOT the current one-step reachable set.
    oneStepReachable(us: Region): Set<State> {
        const post = this.post(us);
        const out = new Set();
        for (let state of this.system.states.values()) {
            if (!post.intersect(state.polytope).isEmpty) out.add(state);
        }
        return out;
    }

    act(y: State): Region {
        return this.system.act(this, y);
    }

    actR(y: State): Region {
        return this.system.actR(this, y);
    }

    zNonZero(): Region {
        return this.system.zNonZero([this]);
    }
    
    zOne(): Region {
        return this.system.zOne([this]);
    }

    // Shortcut for single-state refinement
    refine(partition: Region): RefinementMap {
        return this.system.refine(new Map([[this, partition]]));
    }

    // Clear action cache if a state in the given set is reachable from this
    // state.
    resetActions(targets?: Set<State>): void {
        // _reachable contains the last known set of action targets, if any
        // invalidated target is in there, the actions have to be reset.
        // The set _reachable will then be recomputed on demand in the actions
        // getter. It is ok for _reachable to be empty if no actions have been
        // computed yet as there is nothing to reset in that case anyway.
        if (this._actions == null || targets == null || sets.doIntersect(this._reachable, targets)) {
            this._actions = this.isOuter ? [] : null; // Outer states have no actions
            this._reachable = new Set();
        }
    }

    // JSON-compatible serialization
    serialize(includeGraph?: boolean): JSONState {
        let actions = null;
        // Only include actions if they have been evaluated already
        if (includeGraph != null && includeGraph && this._actions != null) {
            actions = this._actions.map(_ => _.serialize(includeGraph));
        }
        return {
            label: this.label,
            polytope: this.polytope.serialize(),
            isOuter: this.isOuter,
            predicates: Array.from(this.predicates),
            actions: actions
        };
    }

}


/* Action of a state of an AbstractedLSS */

// JSON-compatible serialization
type JSONAction = {
    targets: StateID[],
    controls: JSONUnion,
    supports: JSONActionSupport[] | null
};

export class Action {

    +origin: State;
    +targets: Set<State>;
    +controls: Region;
    +supports: ActionSupport[];
    _supports: ?ActionSupport[];

    constructor(origin: State, targets: Iterable<State>, controls: Region): void {
        this.origin = origin;
        this.targets = new Set(targets);
        this.controls = controls;
        this._supports = null;
    }

    static deserialize(json: JSONAction, origin: State): Action {
        const targets = json.targets.map(_ => origin.system.getState(_));
        const action = new Action(origin, targets, Union.deserialize(json.controls));
        if (json.supports != null) {
            action._supports = json.supports.map(_ => ActionSupport.deserialize(_, action));
        }
        return action;
    }

    // Lazy evaluation and memoization of action supports
    get supports(): ActionSupport[] {
        if (this._supports != null) {
            return this._supports;
        } else {
            const lss = this.origin.system.lss;
            const zNonZeros = itemizedOperatorPartition(this.targets, _ => _.zNonZero());
            const zOnes = lss.zOne(Union.from(Array.from(this.targets, _ => _.polytope)));
            this._supports = zNonZeros.map(part => {
                // Remove outer zNonZeros
                const zs = part.region.intersect(zOnes).polytopes;
                const prePs = [];
                for (let u of this.controls.polytopes) {
                    const Bus = u.vertices.map(_ => linalg.apply(lss.B, _));
                    for (let z of zs) {
                        // Subtract Bu with Minkowski
                        const preP = Polytope.ofDim(lss.dim).hull(linalg.minkowski.xmy(z.vertices, Bus));
                        // Apply A from right
                        prePs.push(preP.applyRight(lss.A));
                    }
                }
                const preP = prePs.length === 0 ? Polytope.ofDim(lss.dim).empty() : Union.from(prePs);
                return new ActionSupport(
                    this, part.items, preP.intersect(this.origin.polytope).simplify()
                );
            }).filter(_ => !_.origins.isEmpty);
            // TODO there are still extreme cases with very small states where
            // this comes out empty due to numerical instability in the
            // geometry library. The problems are caught during game
            // construction (a player 2 state with no actions) but this
            // generally does not speak for the trustworthiness of the geometry
            // algorithms in some extreme cases :/
            return this.supports;
        }
    }

    // JSON-compatible serialization
    serialize(includeGraph?: boolean): JSONAction {
        let supports = null;
        // Only include supports if they have been evaluated already
        if (includeGraph != null && includeGraph && this._supports != null) {
            supports = this._supports.map(_ => _.serialize());
        }
        return {
            targets: Array.from(this.targets, _ => _.label),
            controls: this.controls.toUnion().serialize(),
            supports: supports
        };
    }

}


/* ActionSupport of an action of a state of an AbstractedLSS */

// JSON-compatible serialization
type JSONActionSupport = {
    targets: StateID[],
    origins: JSONUnion
};

export class ActionSupport {

    +action: Action;
    +targets: Set<State>;
    +origins: Region;

    constructor(action: Action, targets: Iterable<State>, origins: Region): void {
        this.action = action;
        this.targets = new Set(targets);
        this.origins = origins;
    }

    static deserialize(json: JSONActionSupport, action: Action): ActionSupport {
        const targets = json.targets.map(x => action.origin.system.getState(x));
        return new ActionSupport(action, targets, Union.deserialize(json.origins));
    }

    // JSON-compatible serialization
    serialize(): JSONActionSupport {
        return {
            targets: Array.from(this.targets, x => x.label),
            origins: this.origins.toUnion().serialize()
        };
    }

}

