// @flow
"use strict";

import type { ASTNode } from "./parser.js";

import { ASTParser, ParseError } from "./parser.js";
import { zip2, hashString, UniqueCollection } from "./tools.js";


/* Objective specification */

export type ObjectiveKind = {
    name: string,
    formula: string,
    variables: string[],
    automaton: string
};

export class Objective {
    
    +kind: ObjectiveKind;
    +propositions: Map<string, Proposition>;
    +automaton: OnePairStreettAutomaton;

    constructor(kind: ObjectiveKind, terms: Proposition[] ): void {
        this.kind = kind;
        if (terms.length !== kind.variables.length) throw new Error(
            "" // TODO
        );
        this.propositions = new Map(zip2(kind.variables, terms));
        this.automaton = OnePairStreettAutomaton.parse(kind.automaton);
    }

}


/* Propositional Logic Formulas */

export type Proposition = AtomicProposition | Negation | Conjunction | Disjunction | Implication;
export type Valuation = (AtomicProposition) => boolean;

export class AtomicProposition {

    +symbol: string;

    constructor(symbol: string): void {
        this.symbol = symbol;
    }

    evalWith(valuate: Valuation): boolean {
        return valuate(this);
    }

    toString(): string {
        return this.symbol;
    }

}

export class Negation {
    
    +args: Proposition[];
    
    constructor(arg: Proposition): void {
        this.args = [arg];
    }

    evalWith(valuate: Valuation): boolean {
        return !this.args[0].evalWith(valuate);
    }

}

export class Conjunction {

    +args: Proposition[];

    constructor(larg: Proposition, rarg: Proposition): void {
        this.args = [larg, rarg];
    }

    evalWith(valuate: Valuation): boolean {
        return this.args[0].evalWith(valuate) && this.args[1].evalWith(valuate);
    }

}

export class Disjunction {

    +args: Proposition[];

    constructor(larg: Proposition, rarg: Proposition): void {
        this.args = [larg, rarg];
    }

    evalWith(valuate: Valuation): boolean {
        return this.args[0].evalWith(valuate) || this.args[1].evalWith(valuate);
    }

}

export class Implication {

    +args: Proposition[];

    constructor(larg: Proposition, rarg: Proposition): void {
        this.args = [larg, rarg];
    }

    evalWith(valuate: Valuation): boolean {
        return !this.args[0].evalWith(valuate) || this.args[1].evalWith(valuate);
    }

}

const parsePropositionAST = ASTParser(/[()!&|]|->|(?:[a-z][a-z0-9]*)/, [
    { op: "->", precedence: 20, associativity:  1 },
    { op: "|" , precedence: 30, associativity: -1 },
    { op: "&" , precedence: 40, associativity: -1 },
    { op: "!" , precedence: 50, associativity:  0 }
]);

function asProposition(node: ASTNode): Proposition {
    if (typeof node === "string") {
        return new AtomicProposition(node);
    } else if (node.op === "!") {
        return new Negation(...node.args.map(asProposition));
    } else if (node.op === "&") {
        return new Conjunction(...node.args.map(asProposition));
    } else if (node.op === "|") {
        return new Disjunction(...node.args.map(asProposition));
    } else if (node.op === "->") {
        return new Implication(...node.args.map(asProposition));
    } else {
        throw new ParseError();
    }
}

export function parseProposition(text: string): Proposition {
    return asProposition(parsePropositionAST(text));
}

// Call a function for every node of the expression tree
export function traverseProposition(fun: (Proposition) => void, prop: Proposition): void {
    fun(prop);
    if (!(prop instanceof AtomicProposition)) {
        for (let arg of prop.args) {
            traverseProposition(fun, arg);
        }
    }
}


/* Deterministic ω-Automata with one-pair Streett acceptance condition

States and transitions are identified by string labels. A default transition
(else-case) is specified by an empty label.
*/

export class OnePairStreettAutomaton {

    +states: UniqueCollection<State>;
    +acceptanceSet1: Set<State>;
    +acceptanceSet2: Set<State>;
    _initialState: State;

    constructor(): void {
        this.states = new UniqueCollection(State.hash, State.areEqual);
        this.acceptanceSet1 = new Set();
        this.acceptanceSet2 = new Set();
    }

    get initialState(): State {
        return this._initialState;
    }

    takeStateByLabel(label: string): State {
        return this.states.take(new State(label));
    }

    // Serialization to "A|B|C|D", where
    // A: transitions in the form ORIGIN>LABEL>TARGET, comma-separated
    // B: initial state
    // C: acceptance set 1 of states, comma-separated
    // D: acceptance set 2 of states, comma-separated
    stringify(): string {
        const transitions = [];
        const accept1 = [];
        const accept2 = [];
        for (let state of this.states) {
            for (let [prop, target] of state.transitions) {
                transitions.push(state.label + ">" + prop + ">" + target.label);
            }
            if (state.defaultTarget != null) {
                transitions.push(state.label + ">>" + state.defaultTarget.label);
            }
            if (this.acceptanceSet1.has(state)) {
                accept1.push(state.label);
            }
            if (this.acceptanceSet2.has(state)) {
                accept2.push(state.label);
            }
        }
        return [
            transitions.join(","),
            this.initialState.label,
            accept1.join(","),
            accept2.join(",")
        ].join(" | ");
    }

    // Deserialization
    static parse(s: string): OnePairStreettAutomaton {
        const automaton = new OnePairStreettAutomaton();
        const [transitions, initialState, acceptanceSet1, acceptanceSet2] = s.split("|");
        for (let transition of transitions.split(",").map(x => x.trim()).filter(x => x.length > 0)) {
            const [o, p, t] = transition.split(/\s*>\s*/);
            const origin = automaton.takeStateByLabel(o);
            const target = automaton.takeStateByLabel(t);
            if (p === "") {
                if (origin.defaultTarget != null) throw new Error(
                    "Default target set twice for state '" + o + "'"
                );
                origin.defaultTarget = target;
            } else {
                if (origin.transitions.has(p)) throw new Error(
                    "Transition with label '" + o + "' specified twice for state '" + o + "'"
                );
                origin.transitions.set(p, target);
            }
        }
        for (let label of acceptanceSet1.split(",").map(x => x.trim()).filter(x => x.length > 0)) {
            automaton.acceptanceSet1.add(automaton.takeStateByLabel(label));
        }
        for (let label of acceptanceSet2.split(",").map(x => x.trim()).filter(x => x.length > 0)) {
            automaton.acceptanceSet2.add(automaton.takeStateByLabel(label));
        }
        automaton._initialState = automaton.takeStateByLabel(initialState.trim());
        // TODO: test for unreachable states
        return automaton;
    }

}

class State {

    +label: string;
    +transitions: Map<string, State>;
    defaultTarget: ?State;

    constructor(label: string): void {
        this.label = label;
        this.transitions = new Map();
        this.defaultTarget = null;
    }

    static hash(x: State): number {
        return hashString(x.label);
    }

    static areEqual(x: State, y: State): boolean {
        return x.label == y.label;
    }

}

