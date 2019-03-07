// @flow
"use strict";

import type { AnalysisResults } from "./game.js";
import type { Polytope } from "./geometry.js";
import type { Vector } from "./linalg.js";
import type { Objective, AutomatonState, AutomatonStateID } from "./logic.js";
import type { State, StateID, Action, ActionID, AbstractedLSS } from "./system.js";

import { just, NotImplementedError } from "./tools.js";



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
    +analysis: ?AnalysisResults;

    constructor(system: AbstractedLSS, objective: Objective, analysis: ?AnalysisResults): void {
        this.system = system;
        this.objective = objective;
        this.analysis = analysis;
        this.reset();
    }

    // Initializer (overwrite in subclass)
    reset(): void {}

    // Produce control input (overwrite in subclass)
    control(origin: Vector, x: State, q: AutomatonState): Vector {
        throw new NotImplementedError("control method of Controller must be overwritten in subclass");
    }

    // Built-in controller lookup table
    static builtIns(): { [string]: Class<Controller> } {
        return {
            "random": RandomController,
            "round-robin": RoundRobinController
        };
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
        const analysis = this.analysis;
        if (analysis == null) return false;
        const result = analysis.get(x.label);
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
            if (action.targets.every((target) => this._isYes(target, qNext))) {
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

