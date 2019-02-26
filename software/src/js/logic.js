// @flow
"use strict";

import type { Shape } from "./figure.js";
import type { ASTNode } from "./parser.js";
import type { PredicateID } from "./system.js";

import { ASTParser, ParseError } from "./parser.js";
import { obj, iter, arr, sets, hashString, replaceAll } from "./tools.js";


/* Objective specification

Associates automaton variables with propositional formulas so they can be
evaluated together and provides some convenience functionality.
*/

export type ObjectiveKind = {
    name: string,
    formula: string,
    variables: string[],
    automaton: string,
    automatonPlacement: AutomatonPlacement
};

export type JSONObjective = {
    kind: ObjectiveKind,
    terms: string[],
    coSafeInterpretation: boolean
};

export class Objective {
    
    +kind: ObjectiveKind;
    +automaton: OnePairStreettAutomaton;
    // Convenient access to all automaton states by label
    +allStates: Set<AutomatonStateLabel>;
    // Mapping of automaton transition label variables to propositions over
    // linear predicates of system
    +propositions: Map<string, Proposition>;
    // Interpret objective as co-safe (fulfillable in finite time)
    +coSafeInterpretation: boolean;

    constructor(kind: ObjectiveKind, terms: Proposition[], coSafeInterpretation?: boolean): void {
        this.kind = kind;
        if (terms.length !== kind.variables.length) throw new Error(
            "Number of terms (" + terms.length + ") does not match number of variables (" + kind.variables.length + ")"
        );
        this.propositions = new Map(arr.zip2(kind.variables, terms));
        this.automaton = OnePairStreettAutomaton.parse(kind.automaton);
        this.allStates = sets.map(_ => _.label, this.automaton.states.values());
        // Co-safe interpretation of automaton is disabled by default
        this.coSafeInterpretation = coSafeInterpretation != null && coSafeInterpretation;
        if (this.coSafeInterpretation && !this.automaton.isCoSafeCompatible) throw new Error(
            "Co-safe interpretation chosen, but automaton is not co-safe compatible"
        );
    }

    static deserialize(json: JSONObjective): Objective {
        return new Objective(json.kind, json.terms.map(parseProposition), json.coSafeInterpretation);
    }

    getState(label: AutomatonStateLabel): AutomatonState {
        const state = this.automaton.states.get(label);
        if (state == null) throw new Error(
            "automaton state " + label + " does not exist"
        );
        return state;
    }

    getProposition(symbol: string): Proposition {
        const formula = this.propositions.get(symbol);
        if (formula == null) throw new Error(
            "no formula for symbol " + symbol + " exists"
        );
        return formula;
    }

    // Take a set of predicate labels and return a valuation that can be used
    // to evaluate a propositional formula from an automaton transition
    valuationFor(predicates: Set<PredicateID>): Valuation {
        return (atom) => {
            const formula = this.getProposition(atom.symbol);
            return formula.evalWith(_ => predicates.has(_.symbol));
        };
    }

    nextState(predicates: Set<PredicateID>, label: AutomatonStateLabel): ?AutomatonStateLabel {
        const state = this.getState(label);
        const next = state.successor(this.valuationFor(predicates));
        return next == null ? null : next.label;
    }

    // Test for final (satisfying) states of co-safe objectives
    isCoSafeFinal(label: AutomatonStateLabel): boolean {
        const state = this.getState(label);
        return this.coSafeInterpretation && state.isFinal && this.automaton.acceptanceSetF.has(state);
    }

    toShapes(): AutomatonShapeCollection {
        const shapes = this.automaton.toShapes(this.kind.automatonPlacement);
        let xmin = Infinity;
        let xmax = -Infinity;
        let ymin = Infinity;
        let ymax = -Infinity;
        for (let [x, y, _] of obj.values(this.kind.automatonPlacement)) {
            if (x < xmin) xmin = x;
            if (x > xmax) xmax = x;
            if (y < ymin) ymin = y;
            if (y > ymax) ymax = y;
        }
        // Add 100 padding around each state. In a 1:1 projection to pixels,
        // this should leave enough room for labels and self-loops around
        // states. The state positioning should therefore be expressed in px,
        // considering the scale prescribed by this padding.
        shapes.extent = [[xmin - 100, xmax + 100], [ymin - 100, ymax + 100]];
        return shapes;
    }

    serialize(): JSONObjective {
        return {
            kind: this.kind,
            terms: this.kind.variables.map(_ => this.getProposition(_).stringify()),
            coSafeInterpretation: this.coSafeInterpretation
        };
    }

}


/* Propositional Logic Formulas

evalWith method determines the truth value of the formula, given a valuation of
atomic propositions.
*/

export type Proposition = AtomicProposition | Top | Negation | Conjunction | Disjunction | Implication;
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

    stringify(): string {
        return this.symbol;
    }

}

export class Top {

    evalWith(valuate: Valuation): boolean {
        return true;
    }

    stringify(): string {
        return "TRUE";
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

    stringify(): string {
        return "(!" + this.args[0].stringify() + ")";
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

    stringify(): string {
        return "(" + this.args[0].stringify() + " & " + this.args[1].stringify() + ")";
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

    stringify(): string {
        return "(" + this.args[0].stringify() + " | " + this.args[1].stringify() + ")";
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

    stringify(): string {
        return "(" + this.args[0].stringify() + " -> " + this.args[1].stringify() + ")";
    }

}


/* Parsing and printing of propositional formulas */

// Definition of propositional operators for parser and printers
const PROP_OPS = [
    { op: "->", precedence: 20, associativity:  1, cls: Implication, tex: "\\rightarrow" },
    { op: "|" , precedence: 30, associativity: -1, cls: Disjunction, tex: "\\vee" },
    { op: "&" , precedence: 40, associativity: -1, cls: Conjunction, tex: "\\wedge" },
    { op: "!" , precedence: 50, associativity:  0, cls: Negation, tex: "\\neg" }
];

// Find operator definition associated with given Proposition form PROP_OPS.
// Used by formula printers.
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
// - Atomic proposition labels (start with small letter or \ (to allow
//   TeX-escaped letters, then any number of numbers, letters and underscores)
const parsePropositionAST = ASTParser(/[()!&|]|->|(?:[a-z\\][a-z0-9]*)/, PROP_OPS);

// Convert parsed ASTNode to Proposition according to PROP_OPS definitions
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

// All-in-one parser for Propostions
export function parseProposition(text: string): Proposition {
    return asProposition(parsePropositionAST(text));
}

// TeX representation of propositional formula that takes associativity and
// operator precedence into account to produce pretty formulas. Arguments
// parentOp and rightArg are for own, recursive calls and should not be set
// when calling function on a proposition otherwise.
export function texifyProposition(prop: Proposition, symbolTransform?: (string) => string, parentOp?: *, rightArg?: boolean): string {
    if (symbolTransform == null) {
        symbolTransform = _ => _; // Identity
    }
    if (prop instanceof AtomicProposition) {
        return symbolTransform(prop.symbol);
    }
    if (prop instanceof Top) {
        return symbolTransform("__TRUE__");
    }
    const op = getOpOf(prop);
    let out = "";
    let needsParentheses = false;
    // Unary operator: always use parentheses if argument is more complex than
    // atomic proposition (easier to read)
    if (op.associativity === 0) {
        const arg = prop.args[0];
        if (arg instanceof AtomicProposition) {
            out = op.tex + " " + symbolTransform(arg.symbol);
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
    if (prop instanceof AtomicProposition) {
        // stop
    } else if (prop instanceof Top) {
        // stop
    } else {
        for (let arg of prop.args) {
            traverseProposition(fun, arg);
        }
    }
}


// Translation of some TeX symbols (stuff for propositional formulas)
export function unicodeifyTransitionLabel(text: string): string {
    obj.forEach((k, v) => {
        text = replaceAll(text, k, v)
    }, {
        "\\varphi": "φ", "\\theta": "θ", "\\mu": "μ",
        "\\pi": "π", "\\rho": "ρ", "\\vee": "∨",
        "\\wedge": "∧", "\\neg": "¬", "\\rightarrow": "→",
        " ": ""
    });
    return text;
}

/* Deterministic ω-Automaton with one-pair Streett acceptance condition (E, F)

Used to represent an LTL formula. State-based acceptance. States are identified
by labels (strings). Transitions are identified by their target and associated
with a propositional formula.
*/

export type AutomatonPlacement = { [string]: [number, number, number] }; // x, y, loop angle

export type AutomatonShapeCollection = {
    states: Map<string, [Shape, Shape]>, // symbol, label
    transitions: Map<string, Map<string, [Shape, Shape]>>, // arrow, label
    extent?: [number, number][]
};

export class OnePairStreettAutomaton {

    +states: Map<AutomatonStateLabel, AutomatonState>;
    +acceptanceSetE: Set<AutomatonState>;
    +acceptanceSetF: Set<AutomatonState>;
    initialState: AutomatonState;

    // Initialize empty automaton
    constructor(): void {
        this.states = new Map();
        this.acceptanceSetE = new Set();
        this.acceptanceSetF = new Set();
    }

    // Hack for specifications that can be fulfilled in finite time: interpret
    // acceptance set F as set of final states. Once a final state is reached,
    // the run is accepting no matter what happens afterwards.
    get isCoSafeCompatible(): boolean {
        const E = this.acceptanceSetE;
        const F = this.acceptanceSetF;
        return (
            // At least one state in F
            F.size > 0
            // E and F must be disjunct
            && !sets.doIntersect(E, F)
            // E and F must together contain all states
            && sets.difference(this.states.values(), sets.union(E, F)).size === 0
            // All states in F can only have a self-loop without transition label
            && iter.every(iter.map(_ => _.isFinal, F))
        );
    }

    takeState(label: AutomatonStateLabel): AutomatonState {
        let state = this.states.get(label);
        if (state == null) {
            state = new AutomatonState(label);
            this.states.set(label, state);
        }
        return state;
    }

    // Return an organized collection with shapes for states, transitions and
    // their labels. The organization enables finding specific transitions
    // andstates later so they can be highlighted.
    toShapes(placement: AutomatonPlacement, propositions?: null): AutomatonShapeCollection {
        // States and state labels
        const ss = new Map();
        // Transitions and transition labels
        const tss = new Map();
        // Convert each state and its transition to shapes
        for (let origin of this.states.values()) {
            // State with acceptance set membership and its label
            const [x, y, loopAngle] = placement[origin.label];
            const member = (this.acceptanceSetE.has(origin) ? "E" : "") + (this.acceptanceSetF.has(origin) ? "F" : "");
            ss.set(origin.label, [
                { kind: "state", coords: [x, y], member: member },
                { kind: "label", coords: [x, y], text: origin.label }
            ]);
            // Transitions are indexed by the target state label
            const ts = new Map();
            // Transitions with associated propositional formulas
            for (let [target, proposition] of origin.transitions) {
                // loopLabel and transitionLabel crudely understand TeX
                const text = unicodeifyTransitionLabel(texifyProposition(proposition));
                // Self-loop
                if (origin.label === target.label) {
                    ts.set(origin.label, [
                        { kind: "loop", coords: [x, y], angle: loopAngle },
                        { kind: "loopLabel", text: text, coords: [x, y], angle: loopAngle }
                    ]);
                // Other target
                } else {
                    const [xx, yy, _] = placement[target.label];
                    ts.set(target.label, [
                        { kind: "transition", origin: [x, y], target: [xx, yy] },
                        { kind: "transitionLabel", text: text, origin: [x, y], target: [xx, yy] }
                    ]);
                }
            }
            // Default transition: print asterisk symbol as label
            if (origin.defaultTarget != null) {
                // Self-loop
                if (origin.label === origin.defaultTarget.label) {
                    ts.set(origin.label, [
                        { kind: "loop", coords: [x, y], angle: loopAngle },
                        { kind: "loopLabel", text: "∗", coords: [x, y], angle: loopAngle }
                    ]);
                // Other target
                } else {
                    const [xx, yy, _] = placement[origin.defaultTarget.label];
                    ts.set(origin.defaultTarget.label, [
                        { kind: "transition", origin: [x, y], target: [xx, yy] },
                        { kind: "transitionLabel", text: "∗", origin: [x, y], target: [xx, yy] }
                    ]);
                }
            }
            // Add collected transitions to state
            tss.set(origin.label, ts);
        }
        return { states: ss, transitions: tss };
    }

    // Serialization to form "1|2|3|4", where
    // 1: transitions in the form ORIGIN>(PROPOSITION)>TARGET, comma-separated
    // 2: initial state
    // 3: acceptance set E of states, comma-separated
    // 4: acceptance set F of states, comma-separated
    stringify(): string {
        const transitions = [];
        const acceptE = [];
        const acceptF = [];
        for (let state of this.states.values()) {
            for (let [target, formula] of state.transitions) {
                // Proposition.stringify adds outer parentheses for anything
                // more complex than an atomic proposition
                transitions.push(state.label + ">" + formula.stringify() + ">" + target.label);
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
            // origin > (propositional formula) > target
            const opIdx = transition.indexOf(">");
            const ptIdx = transition.lastIndexOf(">");
            if (opIdx < 0 || ptIdx < 0 || opIdx == ptIdx) throw new Error(
                "Invalid transition '" + transition + "'"
            );
            // Origin
            const o = transition.substring(0, opIdx).trim();
            const origin = automaton.takeState(o);
            // Target
            const t = transition.substring(ptIdx + 1).trim();
            const target = automaton.takeState(t);
            // Transition condition: propositional formula or none
            const p = transition.substring(opIdx + 1, ptIdx).trim();
            if (p === "") {
                if (origin.defaultTarget != null) throw new Error(
                    "Default target set twice for state '" + o + "'"
                );
                if (origin.transitions.has(target)) throw new Error(
                    "Two transitions to target '" + t + "' set for state '" + o + "'"
                );
                origin.defaultTarget = target;
            } else {
                const formula = parseProposition(p);
                // Map keeps track of insertion order so order of definition
                // governs in which order transition conditions are tested.
                if (origin.transitions.has(target) || origin.defaultTarget === target) throw new Error(
                    "Two transitions to target '" + t + "' set for state '" + o + "'"
                );
                origin.transitions.set(target, formula);
            }
        }
        for (let label of acceptanceSetE.split(",").map(x => x.trim()).filter(x => x.length > 0)) {
            automaton.acceptanceSetE.add(automaton.takeState(label));
        }
        for (let label of acceptanceSetF.split(",").map(x => x.trim()).filter(x => x.length > 0)) {
            automaton.acceptanceSetF.add(automaton.takeState(label));
        }
        automaton.initialState = automaton.takeState(initialState.trim());
        // TODO: test for unreachable states
        return automaton;
    }

}

export type AutomatonStateLabel = string;

class AutomatonState {

    // TODO? reference to automaton
    +label: AutomatonStateLabel;
    +transitions: Map<AutomatonState, Proposition>;
    defaultTarget: ?AutomatonState;

    constructor(label: AutomatonStateLabel): void {
        if (label.startsWith("__")) throw new Error(
            "automaton state labels starting with '__' are reserved"
        );
        this.label = label;
        this.transitions = new Map();
        this.defaultTarget = null;
    }

    get isFinal(): boolean {
        return this.transitions.size === 0 && this.defaultTarget === this;
    }

    successor(valuation: Valuation): ?AutomatonState {
        for (let [target, formula] of this.transitions) {
            // First match is returned
            if (formula.evalWith(valuation)) return target;
        }
        return this.defaultTarget;
    }

    proposition(successor: AutomatonState): ?Proposition {
        const prop = this.transitions.get(successor);
        if (prop != null) {
            return prop;
        } else if (successor === this.defaultTarget) {
            if (this.transitions.size === 0) {
                return new Top();
            } else {
                const props = Array.from(this.transitions.values());
                return new Negation(props.reduce((r, s) => new Disjunction(r, s)));
            }
        } else {
            return null;
        }
    }

}

