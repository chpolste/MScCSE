// @flow
"use strict";


export class ParseError extends Error {}

// A parsed expression is returned as an abstract syntax tree
export type ASTNode = string | { "op": string, args: ASTNode[] };

// An operator is defined by a token (op) by which it is recognized, its
// precedence and its associativity (negative = left, positive = right,
// 0 = unary operator).
export type Operator = { op: string, precedence: number, associativity: number };

// Create an all-in-one parser function that takes care of tokenization and AST
// construction.
export function ASTParser(tokenPattern: RegExp, operators: Operator[]): (string) => ASTNode {
    const pcparser = new PCParser(operators);
    return function (text) {
        const tokenStream = new TokenStream(text, tokenPattern);
        return pcparser.parse(tokenStream);
    }
}

// Print AST with m-expression-like syntax
export function printAST(node: ASTNode): string {
    return typeof node === "string" ? node : node.op + "(" + node.args.map(printAST).join(", ") + ")";
}


class TokenStream {

    +text: string;
    +pattern: RegExp;
    current: ?string;

    constructor(text: string, pattern: RegExp): void {
        this.text = text;
        // Enable whitespace removal around tokens and set global and sticky
        // flags. Global flag makes the pattern remember the last position and
        // sticky flag does not allow skipping any part of the string.
        this.pattern = RegExp("\\s*(" + pattern.source + ")\\s*", "gy");
        // Load first token (fills this.current)
        this.advance();
    }

    // Move to the next token in the stream (consume)
    advance(): void {
        if (this.pattern.lastIndex == this.text.length) {
            this.current = null;
        } else {
            const match = this.pattern.exec(this.text);
            if (match == null) throw new ParseError(
                "unable to tokenize " + this.text.slice(this.pattern.lastIndex)
            );
            this.current = match[1];
        }
    }

    // Consume remaining tokens until end and return tokens as a list
    list(): string[] {
        const tokens = [];
        while (this.current != null) {
            tokens.push(this.current);
            this.advance();
        }
        return tokens;
    }

}


/* Precedence Climbing Parser

Suited for parsing expressions with binary infix and unary prefix operators.
Precedence climbing is favoured over shunting-yard since its handling of unary
operations is more natural and it directly generates an AST instead of having
to go through reverse polish notation first.

This Implementation is based on:
 - http://www.engr.mun.ca/~theo/Misc/exp_parsing.htm
 - https://eli.thegreenplace.net/2012/08/02/parsing-expressions-by-precedence-climbing/

*/

class PCParser {

    +uProp: { [string]: number };
    +bProp: { [string]: [number, boolean] };

    constructor(operators: Operator[]): void {
        // Split operators into unary and binary for convenient lookup
        this.uProp = {};
        this.bProp = {};
        for (let operator of operators) {
            if (operator.associativity === 0) {
                this.uProp[operator.op] = operator.precedence;
            } else {
                this.bProp[operator.op] = [operator.precedence, operator.associativity < 0];
            }
        }
    }

    parse(tokens: TokenStream): ASTNode {
        const ast = this.computeExpr(tokens, 0);
        if (tokens.current != null) throw new ParseError(
            "expected end token but found token " + tokens.current
        );
        return ast;
    }

    computeExpr(tokens: TokenStream, minPrec: number): ASTNode {
        let left = this.computeAtom(tokens);
        while (true) {
            const token = tokens.current;
            // Return if next operator is not binary or the end token
            if (token == null || !this.bProp.hasOwnProperty(token)) {
                break;
            }
            const [prec, lAssoc] = this.bProp[token];
            if (prec < minPrec) {
                break;
            }
            tokens.advance();
            const right = this.computeExpr(tokens, lAssoc ? prec + 1 : prec)
            left = { op: token, args: [left, right] };
        }
        return left;
    }

    computeAtom(tokens: TokenStream): ASTNode {
        const token = tokens.current;
        if (token == null) throw new ParseError(
            "unexpected end of token stream"
        );
        tokens.advance();
        // Unary operators: start with new expression as only arg
        if (this.uProp.hasOwnProperty(token)) {
            const arg = this.computeExpr(tokens, this.uProp[token]);
            return { op: token, args: [arg] };
        // Parenthesized expressions: start new expression from precedence
        // 0, whose token consumption must end with a closing parentheses
        } else if (token === "(") {
            const inner = this.computeExpr(tokens, 0);
            if (tokens.current !== ")") throw new ParseError(
                "unexpected token " + String(tokens.current) + ", expected closing parenthesis"
            );
            tokens.advance();
            return inner;
        // Leaf tokens
        } else {
            return token;
        }
    }

}

