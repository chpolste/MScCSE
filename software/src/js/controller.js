// @flow
"use strict";

import type { AnalysisResults } from "./game.js";
import type { Region, Polytope } from "./geometry.js";
import type { Vector } from "./linalg.js";
import type { Objective, AutomatonState, AutomatonStateID } from "./logic.js";
import type { State, StateID, Action, ActionID, AbstractedLSS } from "./system.js";

import { Union } from "./geometry.js";
import { just, iter, NotImplementedError } from "./tools.js";



export type TraceStep = {
    xOrigin: [Vector, State, AutomatonState],
    xTarget: [Vector, State, AutomatonState],
    u: Vector,
    w: Vector
};

export type JSONTrace = JSONTraceStep[];
export type JSONTraceStep = {
    xOrigin: [Vector, StateID, AutomatonStateID],
    xTarget: [Vector, StateID, AutomatonStateID],
    u: Vector,
    w: Vector
};

export class Trace {

    +steps: TraceStep[];
    +system: AbstractedLSS;
    +objective: Objective;

    constructor(system: AbstractedLSS, objective: Objective): void {
        this.steps = [];
        this.system = system;
        this.objective = objective;
    }

    serialize(): JSONTrace {
        return this.steps.map(_ => ({
            xOrigin: [_.xOrigin[0], _.xOrigin[1].label, _.xOrigin[2].label],
            xTarget: [_.xTarget[0], _.xTarget[1].label, _.xTarget[2].label],
            u: _.u,
            w: _.w
        }));
    }

    step(controller: Controller, origin: Vector, x: ?State, q: ?AutomatonState): ?TraceStep {
        // Origin-containing state is not given, find it. If the origin lies
        // outside the system, the trace is not continued.
        if (x == null) {
            x = this.system.stateOf(origin);
            if (x == null) return null;
        // Verify that origin and given state are compatible
        } else if (!x.polytope.contains(origin)) {
            throw new Error("The origin [" + origin.join(", ") + "] is not consistent with the given state " + x.label);
        }
        // Traces terminate in outer states
        if (x.isOuter) return null;
        // If no automaton state is given, use the initial state
        if (q == null) q = this.objective.automaton.initialState;
        // If co-safe final state is reached, terminate the trace
        if (this.objective.isCoSafeFinal(q.label)) return null;
        // Determine automaton successor state based on origin predicates. If
        // no valid automaton transition exists, the trace has terminated
        const qNext = q.successor(this.objective.valuationFor(x.predicates));
        if (qNext == null) return null;
        // Obtain the control input from the controller, a random perturbation
        // vector and evaluate the LSS's evolution equation
        const u = controller.control(origin, x, q);
        const w = this.system.lss.ww.sample();
        const target = this.system.lss.eval(origin, u, w);
        // Determine the state to which the target belongs. Every inner state
        // must lead to another valid state.
        const xNext = just(
            this.system.stateOf(target),
            "Non-outer state " + x.label + " has successor outside of system"
        );
        // Step is valid, add to the end of the trace and return it
        const step =  {
            xOrigin: [origin, x, q],
            xTarget: [target, xNext, qNext],
            u: u,
            w: w
        };
        this.steps.push(step);
        return step;
    }

    stepFor(n: number, controller: Controller, origin: Vector, x: ?State, q: ?AutomatonState): void {
        let xOrigin = [origin, x, q];
        for (let i = 0; i < n; i++) {
            const step = this.step(controller, ...xOrigin);
            if (step == null) return;
            xOrigin = step.xTarget;
        }
    }

}



// Base class for all controllers
export class Controller {

    +system: AbstractedLSS;
    +objective: Objective;
    +results: ?AnalysisResults;

    constructor(system: AbstractedLSS, objective: Objective, results: ?AnalysisResults): void {
        this.system = system;
        this.objective = objective;
        this.results = results;
        this.reset();
    }

    // Initializer (overwrite in subclass)
    reset(): void {}

    // Produce control input (overwrite in subclass)
    control(origin: Vector, x: State, q: AutomatonState): Vector {
        throw new NotImplementedError("control method of Controller must be overwritten in subclass");
    }

}


// Always apply a random control input
export class RandomController extends Controller {

    control(origin: Vector, x: State, q: AutomatonState): Vector {
        return this.system.lss.uu.sample();
    }
    
}


// Cycle through actions that lead exclusively to yes-states
export class RoundRobinController extends Controller {

    // Memory of last actions picked:
    _lastActions: Map<State, Map<AutomatonState, ActionID>>;

    reset(): void {
        this._lastActions = new Map();
    }

    // Return the last-used action ID for the (x, q) combination or -1 if the
    // combination has never been visited before. Because .control starts
    // searching after the last-used, -1 translates to 0 which is the ID of the
    // first action of the state.
    _getActionID(x: State, q: AutomatonState): ActionID {
        const qMap = this._lastActions.get(x);
        if (qMap == null) return -1;
        const i = qMap.get(q);
        return i == null ? -1 : i;
    }

    _setActionID(x: State, q: AutomatonState, i: ActionID): void {
        const qMap = this._lastActions.get(x);
        if (qMap == null) {
            this._lastActions.set(x, new Map([[q, i]]));
        } else {
            qMap.set(q, i);
        }
    }

    _isYes(x: State, q: AutomatonState): boolean {
        const results = this.results;
        if (results == null) return false;
        const result = results.get(x.label);
        return result != null && result.yes.has(q.label);
    }

    control(origin: Vector, x: State, q: AutomatonState): Vector {
        const actions = x.actions;
        const n = actions.length;
        // No-action and no-automaton-transition states should have been taken
        // care of in Trace.step
        if (n === 0) throw new Error(
            "Cannot compute control for state " + x.label + " without actions"
        );
        const qNext = just(
            q.successor(this.objective.valuationFor(x.predicates)),
            "Cannot compute control for state (" + x.label + ", " + q.label + ") without a transition"
        );
        // Start searching for action after the last one that was picked for
        // this (x, q) combination
        const last = this._getActionID(x, q);
        for (let i = 1; i <= n; i++) {
            const next = (last + i) % n;
            const action = actions[next];
            // If all targets of the action are yes-states, return a control
            // vector from this action
            const allYes = iter.every(
                iter.map((target) => this._isYes(target, qNext), action.targets)
            );
            if (allYes) {
                this._setActionID(x, q, next);
                return action.controls.sample();
            }
        }
        // No action with all-yes targets was found, so just use the next
        // action
        const next = (last + 1) % n;
        this._setActionID(x, q, next);
        return actions[next].controls.sample();
    }

}


// Controller based on transition and layer decomposition
export class PreRLayeredTransitionController extends Controller {

    +_onions: Map<AutomatonStateID, Region[]>;
    +_controls: Map<State, Map<AutomatonStateID, Polytope>>;

    constructor(system: AbstractedLSS, objective: Objective, results: ?AnalysisResults,
                transitions: Map<AutomatonStateID, AutomatonStateID>): void {
        super(system, objective, results);
        const lss = system.lss;
        // Construct PreR layers wrt transition targets
        const onions = new Map();
        for (let [qOrigin, qTarget] of transitions) {
            // Determine transition target region
            const reach = this._getTransitionRegion(qOrigin, qTarget);
            // Determine unsafe region
            const avoid = this._getUnsafeRegion(qOrigin);
            // Construct layers around transition target
            const onion = [reach.remove(avoid)];
            while (true) {
                // Compute robust predecessor wrt to previous layer and remove
                // unsafe region
                const previous = onion[onion.length - 1];
                const preR = lss.preR(lss.xx, lss.uu, previous).remove(avoid);
                // If layers have converged, stop
                if (previous.covers(preR)) {
                    break;
                } else {
                    onion.push(preR);
                }
            }
            onions.set(qOrigin, onion);
        }
        this._onions = onions;
        // Cost-minimizing controls will be cached
        this._controls = new Map();
    }

    // No reset necessary, controller is memoryless

    _getUnsafeRegion(q: AutomatonStateID): Region {
        const results = just(
            this.results,
            "PreRLayeredTransitionController requires analysed system"
        );
        return Union.from(
            Array.from(
                iter.filter(
                    (x) => (!x.isOuter && just(results.get(x.label)).no.has(q)),
                    this.system.states.values()
                ),
                (x) => x.polytope
            ),
            this.system.lss.dim
        );
    }

    _getTransitionRegion(qOrigin: AutomatonStateID, qTarget: AutomatonStateID): Region {
        const qNext = (x) => this.objective.nextState(x.predicates, qOrigin);
        return Union.from(
            Array.from(
                iter.filter(
                    (x) => (!x.isOuter && qNext(x) === qTarget),
                    this.system.states.values()
                ),
                (x) => x.polytope
            ),
            this.system.lss.dim
        );
    }

    control(origin: Vector, x: State, q: AutomatonState): Vector {
        // Try to obtain control region from cache
        let controls = this._controls.get(x);
        if (controls != null) {
            const control = controls.get(q.label);
            if (control != null) {
                return control.sample();
            }
        // Create associated cache entry if it does not exist yet
        } else {
            controls = new Map();
            this._controls.set(x, controls);
        }
        // Obtain layers for current automaton state
        const onion = just(
            this._onions.get(q.label),
            "No layers are specified for " + q.label
        );
        // Find action with lowest cost
        const act = iter.argmax((action) => {
            let cost = 0;
            let post = this.system.lss.post(x.polytope, action.controls);
            const totalVolume = post.volume;
            // Accumulate costs from layers
            let i = 0;
            for (let layer of onion) {
                cost = cost + post.intersect(layer).volume * i;
                post = post.remove(layer); 
                i++;
            }
            // Assign very high cost to regions without robust reachability
            // guarantee to deter traces
            cost = cost + post.volume * 9999;
            // Volume-weighted cost and negated (so argmax can be used)
            return -cost / totalVolume;
        }, x.actions);
        // Extract control region associated with best action
        const u = just( 
            act,
            "No action found for state (" + x.label + ", " + q.label + ")"
        ).controls.polytopes[0];
        // Cache this control input and return
        controls.set(q.label, u);
        return u.sample();
    }

}

