// @flow
"use strict";

import type { ASTNode } from "./parser.js";

import { ASTParser, ParseError } from "./parser.js";


/* Objective specification */

export type ObjectiveKind = {
    name: string,
    formula: string,
    variables: string,
    automaton: null,
    acceptance: [null, null]
};

export class Objective {

    constructor(kind: ObjectiveKind, terms: Proposition[] ): void {

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
    if (prop instanceof AtomicProposition) {
        fun(prop);
    } else {
        fun(prop);
        for (let arg of prop.args) {
            traverseProposition(fun, arg);
        }
    }
}


/* TODO: Automata */


