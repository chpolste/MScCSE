// @flow
"use strict";

import type { ASTNode } from "./parser.js";
import type { PredicateID } from "./system.js";
import type { PredicateTest } from "./game.js";

import { ASTParser, ParseError } from "./parser.js";
import { arr, hashString, UniqueCollection } from "./tools.js";


/* Objective specification */

export type ObjectiveKind = {
    name: string,
    formula: string,
    variables: string[],
    automaton: string
};

export class Objective {
    
    +kind: ObjectiveKind;
    +propositions: Map<TransitionLabel, Proposition>;
    +automaton: OnePairStreettAutomaton;

    constructor(kind: ObjectiveKind, terms: Proposition[] ): void {
        this.kind = kind;
        if (terms.length !== kind.variables.length) throw new Error(
            "Number of terms (" + terms.length + ") does not match number of variables (" + kind.variables.length + ")"
        );
        this.propositions = new Map(arr.zip2(kind.variables, terms));
        this.automaton = OnePairStreettAutomaton.parse(kind.automaton);
    }

}


/* Propositional Logic Formulas */

export type Proposition = AtomicProposition | Negation | Conjunction | Disjunction | Implication;
export type Valuation = (AtomicProposition) => boolean;

export class AtomicProposition {

    +symbol: string;

    constructor(symbol: string): void {
        // TODO: verify symbols
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


const PROP_OPS = [
    { op: "->", precedence: 20, associativity:  1, cls: Implication, tex: "\\rightarrow" },
    { op: "|" , precedence: 30, associativity: -1, cls: Disjunction, tex: "\\vee" },
    { op: "&" , precedence: 40, associativity: -1, cls: Conjunction, tex: "\\wedge" },
    { op: "!" , precedence: 50, associativity:  0, cls: Negation, tex: "\\neg" }
];

function getOpOf(prop: Proposition): * {
    for (let op of PROP_OPS) {
        if (prop instanceof op.cls) {
            return op;
        }
    }
    throw new Error("unknown operator");
}

// Accepted tokens are:
// - Parentheses
// - Operators !, &, |, ->
// - Atomic proposition labels (start with small letter, then any number of
//   numbers, letters and underscores)
const parsePropositionAST = ASTParser(/[()!&|]|->|(?:[a-z][a-z0-9]*)/, PROP_OPS);

function asProposition(node: ASTNode): Proposition {
    if (typeof node === "string") {
        return new AtomicProposition(node);
    } else {
        for (let op of PROP_OPS) {
            if (node.op === op.op) {
                return new op.cls(...node.args.map(asProposition));
            }
        }
        throw new ParseError("unknown operator '" + node.op + "'");
    }
}

export function parseProposition(text: string): Proposition {
    return asProposition(parsePropositionAST(text));
}

// Serialization
export function stringifyProposition(prop: Proposition): string {
    if (prop instanceof AtomicProposition) {
        return prop.symbol;
    }
    const op = getOpOf(prop);
    const args = prop.args.map(stringifyProposition);
    return "(" + (args.length === 1 ? op.op + args[0] : args.join(" " + op.op + " ")) + ")";
}

// TeX representation of propositional formula
export function texifyProposition(prop: Proposition, symbolTransform?: (string) => string, parentOp?: *, rightArg?: boolean): string {
    if (symbolTransform == null) {
        symbolTransform = _ => _; // Identity
    }
    if (prop instanceof AtomicProposition) {
        return symbolTransform(prop.symbol);
    }
    const op = getOpOf(prop);
    let out = "";
    let needsParentheses = false;
    // Unary operator: always use parentheses if argument is more complex than
    // atomic proposition (easier to read)
    if (op.associativity === 0) {
        const arg = prop.args[0]
        if (arg instanceof AtomicProposition) {
            out = op.tex + " " + arg.symbol;
        } else {
            out = op.tex + " (" + texifyProposition(arg, symbolTransform) + ")";
        }
    // Binary operator: if parentheses are required depends on the operator
    // precedence when compared to the parent operator or if both have equal
    // precedence, on the argument position and associativity of the operator
    } else {
        const left = texifyProposition(prop.args[0], symbolTransform, op, false);
        const right = texifyProposition(prop.args[1], symbolTransform, op, true);
        out = left + " " + op.tex + " " + right;
        // No parentheses for top-level expressions
        needsParentheses = parentOp != null && (
            // If parent has higher precedence, parentheses are always needed
            parentOp.precedence > op.precedence || (
                // If parent has same precedence, associativity and position
                // decide over need for parentheses
                parentOp.precedence === op.precedence && (
                    (rightArg && op.associativity < 0) || (!rightArg && op.associativity > 0)
                )
            )
        );
    }
    return needsParentheses ? "(" + out + ")" : out;
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


/* Deterministic ω-Automata with one-pair Streett acceptance condition (E, F)

States and transitions are identified by string labels. A default transition
(else-case) is specified by an empty label.
*/

export type TransitionLabel = string;

export class OnePairStreettAutomaton {

    +states: UniqueCollection<State>;
    +acceptanceSetE: Set<State>;
    +acceptanceSetF: Set<State>;
    _initialState: State;

    constructor(): void {
        this.states = new UniqueCollection(State.hash, State.areEqual);
        this.acceptanceSetE = new Set();
        this.acceptanceSetF = new Set();
    }

    get initialState(): State {
        return this._initialState;
    }

    takeState(label: string): State {
        return this.states.take(new State(label));
    }

    // Serialization to "1|2|3|4", where
    // 1: transitions in the form ORIGIN>LABEL>TARGET, comma-separated
    // 2: initial state
    // 3: acceptance set E of states, comma-separated
    // 4: acceptance set F of states, comma-separated
    stringify(): string {
        const transitions = [];
        const acceptE = [];
        const acceptF = [];
        for (let state of this.states) {
            for (let [prop, target] of state.transitions) {
                transitions.push(state.label + ">" + prop + ">" + target.label);
            }
            if (state.defaultTarget != null) {
                transitions.push(state.label + ">>" + state.defaultTarget.label);
            }
            if (this.acceptanceSetE.has(state)) {
                acceptE.push(state.label);
            }
            if (this.acceptanceSetF.has(state)) {
                acceptF.push(state.label);
            }
        }
        return [
            transitions.join(","),
            this.initialState.label,
            acceptE.join(","),
            acceptF.join(",")
        ].join(" | ");
    }

    // Deserialization
    static parse(s: string): OnePairStreettAutomaton {
        const automaton = new OnePairStreettAutomaton();
        const [transitions, initialState, acceptanceSetE, acceptanceSetF] = s.split("|");
        for (let transition of transitions.split(",").map(x => x.trim()).filter(x => x.length > 0)) {
            const [o, p, t] = transition.split(/\s*>\s*/);
            const origin = automaton.takeState(o);
            const target = automaton.takeState(t);
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
        for (let label of acceptanceSetE.split(",").map(x => x.trim()).filter(x => x.length > 0)) {
            automaton.acceptanceSetE.add(automaton.takeState(label));
        }
        for (let label of acceptanceSetF.split(",").map(x => x.trim()).filter(x => x.length > 0)) {
            automaton.acceptanceSetF.add(automaton.takeState(label));
        }
        automaton._initialState = automaton.takeState(initialState.trim());
        // TODO: test for unreachable states
        return automaton;
    }

}

class State {

    +label: string;
    +transitions: Map<TransitionLabel, State>;
    defaultTarget: ?State;

    constructor(label: string): void {
        this.label = label;
        this.transitions = new Map();
        this.defaultTarget = null;
    }

    successor(test: PredicateTest, predicates: Set<PredicateID>): ?State {
        for (let [label, target] of this.transitions) {
            if (test(label, predicates)) return target;
        }
        return this.defaultTarget;
    }

    static hash(x: State): number {
        return hashString(x.label);
    }

    static areEqual(x: State, y: State): boolean {
        return x.label == y.label;
    }

}

