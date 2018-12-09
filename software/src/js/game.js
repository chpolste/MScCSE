// @flow
"use strict";

import type { StateID, ActionID, SupportID, PredicateID } from "./system.js";

import * as logic from "./logic.js";
import { iter, sets, obj, hashString, UniqueCollection } from "./tools.js";


/* Game graph navigation interface

States and predicates are represented by their label. Actions and Action
Supports are represented by their position in their respective containers (gaps
are not allowed, the array must be dense!). Geometric information is not
available through this interface. The simplified representation is sufficient
to create the product of the game graph induced by the abstracted LSS with the
automaton that encodes the temporal logic specification to be met. It is easy
to obtain from a JSON-based serialization when the original Abstracted LSS is
not available (e.g. when using a Web Worker).

The game graph as specified here consists of states, which have actions, which
have actions supports, whose targets are states. These are equivalent to the
elements of a proper 2½-player game in the following way:
    state           → player 1 state
    action          → player 1 choice
    state & action  → player 2 state
    action support  → player 2 choice
    targets         → (probabilistic) state outcomes
*/

export interface GameGraph {
    +stateLabels: Set<StateID>;
    predicateLabelsOf(StateID): Set<PredicateID>;
    actionCountOf(StateID): number;
    supportCountOf(StateID, ActionID): number;
    targetLabelsOf(StateID, ActionID, SupportID): Set<StateID>;
}

// Game graph serialization for analysis
export type JSONGameGraph = {
    [string]: {
        predicates: string[],
        actions: (string[])[]
    }
};

// A wrapper around a snapshot of an abstracted LSS that supports the
// TransitionsSystemMap interface and can therefore be used to generate the
// product game of the system with an automaton.
export class MappedJSONGameGraph implements GameGraph {

    +_states: JSONGameGraph;
    +stateLabels: Set<StateID>;

    constructor(json: JSONGameGraph): void {
        this._states = json;
        this.stateLabels = new Set();
        for (let label in this._states) {
            this.stateLabels.add(label);
        }
    }

    predicateLabelsOf(label: StateID): Set<PredicateID> {
        return new Set(this._states[label].predicates);
    }

    actionCountOf(label: StateID): number {
        return this._states[label].actions.length;
    }

    supportCountOf(label: StateID, actionId: ActionID): number {
        return this._states[label].actions[actionId].length;
    }

    targetLabelsOf(label: StateID, actionId: ActionID, supportId: SupportID): Set<StateID> {
        return new Set(this._states[label].actions[actionId][supportId]);
    }

}


/* 2½-Player parity-3 game corresponding to the synchronized product of an
   abstracted LSS with a one-pair Streett automaton.

These classes are specialized for the task at hand and not a general
implementation of probabilistic games. Priorities for the parity objective are
0, 1, 2.

Any one-pair Streett objective (E, F) can be transformed to an equivalent
parity-3 acceptance condition, with:
- F     states have priority 0
- E \ F states have priority 1
- other states have priority 2
Player 1  wins (= play is accepting) iff lowest priority occurring infinitely
often is even.
*/

export type Priority = 0 | 1 | 2;
export type PState = P1State | P2State;
// Take a set of predicate labels and return a valuation that can be used to
// evaluate a propositional formula from an automaton transition.
export type ValuationFactory = (Set<PredicateID>) => logic.Valuation;

// Priority value for all newly created states. Can be changed later using the
// setPriority method of game (not set directly on states, as these are not
// bound to a specific game and the game keeps track of the priorities in
// dedicated sets of states which have to be updated if the priority of a state
// changes).
const DEFAULT_PRIORITY = 2;

// Thrown if game validation fails
export class ValidationError extends Error {}

// Each state has an object with results attached (these should be
// JSON-compatible)
export type AnalysisResults = Map<StateID, AnalysisResult>;
export type AnalysisResult = {
    // Initial automaton state
    init: string,
    // For which automaton states can the game be won by player 1 alone?
    yes: Set<string>,
    // For which automaton states can the game be won by player 2 alone?
    no: Set<string>,
    // For which automaton states is there a cooperative strategy?
    maybe: Set<string>,
    // For every automaton state: which is the next automaton state in the
    // system state after any action is taken?
    next: { [string]: string }
};

// 2½-player game
export class TwoPlayerProbabilisticGame {

    +p1States: UniqueCollection<P1State>;
    +p2States: UniqueCollection<P2State>;
    +initialStates: Set<PState>;
    +priorityStates: [Set<PState>, Set<PState>, Set<PState>];
    +coSafeInterpretation: boolean;

    // Empty game
    constructor(coSafeInterpretation?: boolean): void {
        this.p1States = new UniqueCollection(P1State.hash, P1State.areEqual);
        this.p2States = new UniqueCollection(P2State.hash, P2State.areEqual);
        this.initialStates = new Set();
        this.priorityStates = [new Set(), new Set(), new Set()];
        // Co-safe interpretation of objective is off by default
        this.coSafeInterpretation = coSafeInterpretation != null && coSafeInterpretation;
    }

    // Convenient access to collection of player 1 and 2 states of the game
    get states(): Iterable<PState> {
        return iter.chain(this.p1States, this.p2States);
    }

    takeP1State(systemState: string, automatonState: string): P1State {
        return this.p1States.take(new P1State(systemState, automatonState));
    }

    takeP2State(systemState: string, systemAction: number, automatonState: string): P2State {
        return this.p2States.take(new P2State(systemState, systemAction, automatonState));
    }

    // Change the priority of a game state, maintaining consistency in the
    // priorityState sets
    setPriority(state: PState, priority: Priority): void {
        this.priorityStates[0].delete(state);
        this.priorityStates[1].delete(state);
        this.priorityStates[2].delete(state);
        this.priorityStates[priority].add(state);
    }

    // Validate the game: check that all states have a priority assigned, the
    // priorityState sets are consistent and that no dead-end states without
    // actions exist.
    validate(): void {
        // Priority
        const [p0, p1, p2] = this.priorityStates;
        // Each state must only have one priority assigned, i.e. priorityState
        // sets must be disjunct
        if (sets.doIntersect(p0, p1)) throw new ValidationError(
            "At least one state has two priorities assigned (0 and 1)"
        );
        if (sets.doIntersect(p0, p2)) throw new ValidationError(
            "At least one state has two priorities assigned (0 and 2)"
        );
        if (sets.doIntersect(p1, p2)) throw new ValidationError(
            "At least one state has two priorities assigned (1 and 2)"
        );
        // Every state must have an assigned priority
        if (p0.size + p1.size + p2.size !== iter.count(this.states)) throw new ValidationError(
            "At least one states does not have a priority assigned"
        );
        // Every state must have at least one action
        for (let state of this.states) {
            if (state instanceof P1State && state.actions.length === 0) throw new ValidationError(
                "Player 1 state (" + state.systemState + ", " + state.automatonState + ") has no actions"
            );
            if (state instanceof P2State && state.actions.length === 0) throw new ValidationError(
                "Player 2 state ((" + state.systemState + ", " + state.systemAction + "), " + state.automatonState + ") has no actions"
            );
        }
        // Initial states must be player 1 states of the game
        for (let state of this.initialStates) {
            if (state instanceof P2State) throw new ValidationError(
                "Player 2 intitial state ((" + state.systemState + ", " + state.systemAction + "), " + state.automatonState + ") is not not allowed"
            );
            if (!this.p1States.has(state)) throw new ValidationError(
                "State (" + state.systemState + ", " + state.automatonState + ") is an initial state but not part of the game"
            );
        }
    }

    // Solve the game for adversarial player 2
    solve(): Set<PState> {
        return this._solve(pre1, pre2, pre3);
    }

    // Solve the game for cooperative player 2
    solveCoop(): Set<PState> {
        return this._solve(pre1Coop, pre2Coop, pre3Coop);
    }

    // Generic game solver (works for adversarial and cooperative player 2,
    // depending on the predecessor functions). Fixed point algorithm with
    // cubic complexity. Solution is the set of states for which player 1 has
    // an almost-sure winning strategy.
    // TODO: add reference for algorithm
    // TODO: remove unneccesary set copies
    _solve(pre1: Pre1Func, pre2: Pre2Func, pre3: Pre3Func): Set<PState> {
        let oldX, oldY, oldZ;
        let newX = new Set(this.states);
        let newY = new Set();
        let newZ = new Set(this.states);
        do {
            oldX = new Set(newX);
            do {
                oldY = new Set(newY);
                do {
                    oldZ = new Set(newZ);
                    newZ = sets.union(
                        pre1(this.priorityStates[0], oldX),
                        pre2(this.priorityStates[1], oldX, oldY),
                        pre3(this.priorityStates[2], oldZ, oldX, oldY)
                    );
                } while (!sets.areEqual(oldZ, newZ));
                newY = new Set(oldZ);
                newZ = new Set(this.states);
            } while (!sets.areEqual(oldY, newY));
            newX = new Set(oldY);
            newY = new Set();
        } while (!sets.areEqual(oldX, newX));
        return oldX;
    }

    analyse(): AnalysisResults {
        // Solve game and check result for plausibility
        const win = this.solve();
        const winCoop = this.solveCoop();
        if (!sets.isSubset(win, winCoop)) throw new Error(
            "states " + Array.from(sets.difference(win, winCoop)).join(", ")
            + " have a winning stategy but cannot be won cooperatively (contradiction)"
        );
        // Post-processing when co-safe objective is chosen: make all states in
        // final automaton states (objective fulfilled, priority 0) satisfying.
        // They would be classed as unreachable otherwise since the __SAT__
        // state captures all plays once the objective is reached.
        const qSat = new Set();
        if (this.coSafeInterpretation) {
            for (let state of this.priorityStates[0]) {
                if (state.automatonState !== "__SAT__") qSat.add(state.automatonState);
            }
        }
        const results = new Map();
        // Initial states cover all system states
        for (let state of this.initialStates) {
            // Set self-loop transitions for co-safe satifying states
            const next = {};
            for (let q of qSat) next[q] = q;
            // Initial result status: empty results except for co-safe
            // post-processing
            results.set(state.systemState, {
                init: state.automatonState,
                yes: new Set(qSat),
                no: new Set(),
                maybe: new Set(),
                next: next
            });
        }
        for (let state of this.p1States) {
            // Ignore dead-end states
            if (state.systemState === "") continue;
            const result = results.get(state.systemState);
            if (result == null) throw new Error(
                "result mismatch for state (" + state.systemState + ", " + state.automatonState + ")"
            );
            // Player 1 cannot win
            let category = result.no;
            // Player 1 can win with a cooperative player 2
            if (winCoop.has(state)) category = result.maybe;
            // Player 1 can win even if player 2 plays as an adversary
            if (win.has(state)) category = result.yes;
            category.add(state.automatonState);
            // Next automaton state is unique
            // TODO: this could use some more safety tests
            const q = state.automatonState;
            const action = state.actions[0];
            const qNext = Array.from(action.values())[0].automatonState;
            if (qNext !== "__END__" && qNext !== "__SAT__" && result.next[q] == null) {
                result.next[q] = qNext;
            }
        }
        return results;
    }

    // Construct synchronous product game from system abstraction-induced game
    // graph and one-pair Streett automaton. valuationFor connects the
    // propositional formulas behind automaton transitions with satisfying
    // system states.
    // Dead-end states of the game graph and game graph transitions without
    // matching automaton transitions are connected to dead-end states,
    // depending on the coSafeInterpretation setting.
    static fromProduct(sys: GameGraph, automaton: logic.OnePairStreettAutomaton,
            valuationFor: ValuationFactory, coSafeInterpretation?: boolean): TwoPlayerProbabilisticGame {
        // Cache sets of labels priority 0 and 1 states (used for co-safe
        // interpretation and priority assignment)
        const priority1 = new Set(iter.map(s => s.label, automaton.acceptanceSetE));
        const priority0 = new Set(iter.map(s => s.label, automaton.acceptanceSetF));
        // Output game
        const game = new TwoPlayerProbabilisticGame(coSafeInterpretation);
        // Game graph exploration queue
        const queue = [];
        // Keep track of player 1 states that have been enqueued already
        const enqueued = new Set();
        // For every state g of the abstracted system, create a player 1 game
        // state (g, q0), where q0 is the initial state of the automaton. These
        // states initialize the exploration queue and are also the initial
        // states of the game product.
        const q0 = automaton.initialState;
        for (let label of sys.stateLabels) {
            const state = game.takeP1State(label, q0.label);
            queue.push(state);
            enqueued.add(state);
            game.initialStates.add(state);
        }

        // Dead-end state for non-existing automata transitions and system
        // states without actions.
        const deadEndP1 = game.takeP1State("", "__END__");
        const deadEndP2 = game.takeP2State("", 0, "__END__");
        // Connect state only to itself
        deadEndP1.actions.push(new Set([deadEndP2]));
        deadEndP2.actions.push(new Set([deadEndP1]));

        // For co-safe interpretation add a priority 0 state that cannot be
        // left, therefore a win for player 1 is guaranteed. This state will be
        // put as only successor after all priority 0 states from the automaton
        // (so even if the trace leaves the state space afterwards, the game is
        // still won by player 1). The co-safe compatibility test of the
        // automaton ensures that leads to the desired game. This state is not
        // used for the regular interpretation of the automaton (infinite
        // plays, traces must not leave the state space).
        let satEndP1 = null;
        let satEndP2 = null;
        if (game.coSafeInterpretation) {
            if (!automaton.isCoSafeCompatible) throw new Error(
                "Co-safe interpretation selected, but the automaton is not co-safe compatible"
            );
            satEndP1 = game.takeP1State("", "__SAT__");
            satEndP2 = game.takeP2State("", 0, "__SAT__");
            satEndP1.actions.push(new Set([satEndP2]));
            satEndP2.actions.push(new Set([satEndP1]));
        }

        // Explore reachable states from initial states and create their
        // associated actions.
        while (queue.length > 0) {
            // Dequeue state
            const state = queue.shift();
            // Corresponding system state (label)
            const xi = state.systemState;
            // Corresponding automaton state (label)
            const qi = state.automatonState;
            // For every player 1 state (Xi, q), create actions to player
            // 2 states ((Xi, Uij), q') if automaton transitions from q to q'
            // under the predicates of Xi
            if (state instanceof P1State) {
                // Set of linear predicates that are fulfiled by system state (labels)
                const pis = sys.predicateLabelsOf(xi);
                // Automaton transition that matches linear predicates
                const qNext = automaton.takeState(qi).successor(valuationFor(pis));
                // No legal automaton transition: don't add any actions, so
                // state is connected to dead end later
                if (qNext == null) {
                    // ...
                // If a priority 0 state would be reached in the co-safe
                // interpretation, ensure that player 1 wins.
                } else if (game.coSafeInterpretation && satEndP1 != null && priority0.has(qNext.label)) {
                    // Side note: It would also be possible to transition
                    // directly to satEndP2, but this way the next field of the
                    // analysis results can be filled with less hassle
                    const action = game.takeP2State(xi, 0, qNext.label);
                    state.actions.push(new Set([action]));
                    // Don't put the new player 2 state on queue but directly
                    // connect to the __SAT__ player 1 state.
                    action.actions.push(new Set([satEndP1]));
                // Automaton transition exists, create game transition for
                // every system action
                } else {
                    for (let ui = 0; ui < sys.actionCountOf(xi); ui++) {
                        const action = game.takeP2State(xi, ui, qNext.label);
                        state.actions.push(new Set([action]))
                        queue.push(action);
                    }
                }
                // No action or qNext == null: connect via player 2 action to
                // common dead-end state
                if (state.actions.length === 0) {
                    const action = game.takeP2State(xi, 0, "");
                    action.actions.push(new Set([deadEndP1]));
                    state.actions.push(new Set([action]));
                }
            // For every player 2 state ((Xi, Uij), q), create actions to
            // player 1 states (Xj, q) for every system action support set
            } else {
                // Corresponding system action (id)
                const ui = state.systemAction;
                for (let si = 0; si < sys.supportCountOf(xi, ui); si++) {
                    const xjs = sys.targetLabelsOf(xi, ui, si);
                    const targets = new Set();
                    for (let xj of xjs) {
                        const target = game.takeP1State(xj, qi);
                        // Enqueue target state only if it was not enqueued before
                        if (!enqueued.has(target)) {
                            enqueued.add(target);
                            queue.push(target);
                        }
                        targets.add(target);
                    }
                    state.actions.push(targets);
                }
            }
        }
        // Assign state priorities
        for (let state of game.states) {
            // Default state priority is 2
            game.setPriority(state, 2);
            // States from difference of automaton acceptance sets E \ F have
            // priority 0. Dead end states also have priority 1 so only player
            // 2 can win in there
            if (priority1.has(state.automatonState) || state === deadEndP1 || state === deadEndP2) {
                game.setPriority(state, 1);
            }
            // States from automaton acceptance set F have priority 0. The
            // dedicated __SAT__ states also have priority 0 to ensure that
            // player 1 wins.
            if (priority0.has(state.automatonState) || state === satEndP1 || state === satEndP2) {
                game.setPriority(state, 0);
            }
        }
        // Verify game integrity
        game.validate();
        return game;
    }

}


// Game actions of player 1 correspond to actions of the abstracted LSS
// (identified by their id). The target probability distribution of the
// game actions can be neglected, as they are not required for the game
// analysis. In contrast to player 2 states, actions have a unique player
// 2 state target. Nevertheless this target is stored in a Set for each
// action to unify the type interfaces.
class P1State {

    +systemState: StateID;
    +automatonState: string;
    +actions: Set<PState>[];

    constructor(systemState: StateID, automatonState: string): void {
        this.systemState = systemState;
        this.automatonState = automatonState;
        this.actions = [];
    }

    static hash(x: P1State): number {
        let hash = 7;
        hash = (37 * hash + hashString(x.systemState)) | 0;
        hash = (37 * hash + hashString(x.automatonState)) | 0;
        return hash;
    }

    static areEqual(x: P1State, y: P1State): boolean {
        return x.systemState === y.systemState
            && x.automatonState === y.automatonState;
    }

}


// Game actions of player 2 correspond to action supports of the abstracted
// LSS (identified by their id). The target probability distribution of the
// game actions can be neglected, as they are not required for the game
// analysis.
class P2State {

    +systemState: StateID;
    +systemAction: ActionID;
    +automatonState: string;
    +actions: Set<PState>[];

    constructor(systemState: StateID, systemAction: ActionID, automatonState: string): void {
        this.systemState = systemState;
        this.systemAction = systemAction;
        this.automatonState = automatonState;
        this.actions = [];
    }

    static hash(x: P2State): number {
        let hash = 17;
        hash = (31 * hash + hashString(x.systemState)) | 0;
        hash = (31 * hash + x.systemAction) | 0;
        hash = (31 * hash + hashString(x.automatonState)) | 0;
        return hash;
    }

    static areEqual(x: P2State, y: P2State): boolean {
        return x.systemState === y.systemState
            && x.systemAction === y.systemAction
            && x.automatonState === y.automatonState;
    }

}


/* Predicates for predecessor functions */

// C1: all successors lie in X
function cond1(successors: Set<PState>, X: Set<PState>): boolean {
    return sets.isSubset(successors, X);
}

// C2: all successors lie in X and at least one successor lies in Y
function cond2(successors: Set<PState>, X: Set<PState>, Y: Set<PState>): boolean {
    return sets.isSubset(successors, X) && sets.doIntersect(successors, Y);
}

// C3: C1(Z) or C2(X, Y)
function cond3(successors: Set<PState>, Z: Set<PState>, X: Set<PState>, Y: Set<PState>): boolean {
    return cond1(successors, Z) || cond2(successors, X, Y);
}


/* Predecessor functions: non-cooperative */

type PreCondition = (Set<PState>) => boolean;
type PreTest = (PState) => boolean;
type Pre1Func = (Set<PState>, Set<PState>) => Set<PState>
type Pre2Func = (Set<PState>, Set<PState>, Set<PState>) => Set<PState>
type Pre3Func = (Set<PState>, Set<PState>, Set<PState>, Set<PState>) => Set<PState>

// Non-cooperative variant:
// - some action must fulfil the condition for a player 1 state
// - every action must fulfil the condition for a player 2 state
function _preTest(cond: PreCondition): PreTest {
    return function (state: PState): boolean {
        return state instanceof P1State
             ? iter.or(state.actions.map(cond))
             : iter.and(state.actions.map(cond));
    }
}

function pre1(S: Set<PState>, X: Set<PState>): Set<PState> {
    return new Set(iter.filter(_preTest(s => cond1(s, X)), S));
}

function pre2(S: Set<PState>, X: Set<PState>, Y: Set<PState>): Set<PState> {
    return new Set(iter.filter(_preTest(s => cond2(s, X, Y)), S));
}

function pre3(S: Set<PState>, Z: Set<PState>, X: Set<PState>, Y: Set<PState>): Set<PState> {
    return new Set(iter.filter(_preTest(s => cond3(s, Z, X, Y)), S));
}


/* Predecessor funcitons: cooperative */

// Cooperative variant:
// Regardless if player 1 or player 2 state, some action has to fulfil the
// condition
function _preTestCoop(cond: PreCondition): PreTest {
    return function (state: PState): boolean {
        return iter.or(state.actions.map(cond));
    }
}

function pre1Coop(S: Set<PState>, X: Set<PState>): Set<PState> {
    return new Set(iter.filter(_preTestCoop(s => cond1(s, X)), S));
}

function pre2Coop(S: Set<PState>, X: Set<PState>, Y: Set<PState>): Set<PState> {
    return new Set(iter.filter(_preTestCoop(s => cond2(s, X, Y)), S));
}

function pre3Coop(S: Set<PState>, Z: Set<PState>, X: Set<PState>, Y: Set<PState>): Set<PState> {
    return new Set(iter.filter(_preTestCoop(s => cond3(s, Z, X, Y)), S));
}

