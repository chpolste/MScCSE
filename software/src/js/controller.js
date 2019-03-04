// @flow
"use strict";

import type { AnalysisResults } from "./game.js";
import type { Polytope } from "./geometry.js";
import type { Vector } from "./linalg.js";
import type { Objective, AutomatonState, AutomatonStateID } from "./logic.js";
import type { State, StateID, Action, ActionID, AbstractedLSS } from "./system.js";

import { NotImplementedError } from "./tools.js";


// TODO

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
        const xNext = this.system.stateOf(target);
        if (xNext == null) throw new Error(
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



// ...

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
        throw new NotImplementedError();
    }

    // TODO
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


// TODO
export class RoundRobinController extends Controller {

    _lastActions: Map<State, Map<AutomatonState, ActionID>>;

    reset(): void {
        this._lastActions = new Map();
    }

    control(origin: Vector, x: State, q: AutomatonState): Vector {
        throw new NotImplementedError();
    }

}

