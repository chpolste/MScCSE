// @flow
"use strict";

const assert = require("assert");
const parser = require("../../src/js/parser.js");


describe("parser.ASTParser", function () {

    it("parses addition correctly", function () {
        const text = "++3 + 4+6  ";
        const parse = parser.ASTParser(/[0-9\+]/, [
            { op: "+", precedence: 20, associativity: -1 },
            { op: "+", precedence: 50, associativity:  0 }
        ]);
        assert.equal(parser.printAST(parse(text)), "+(+(+(+(3)), 4), 6)");
    });

    it("handles operator precedence correctly", function () {
        const text = "5 * -3 + 2";
        const parse = parser.ASTParser(/[0-9-\+\*]/, [
            { op: "+", precedence: 20, associativity: -1 },
            { op: "*", precedence: 30, associativity: -1 },
            { op: "-", precedence: 50, associativity:  0 }
        ]);
        assert.equal(parser.printAST(parse(text)), "+(*(5, -(3)), 2)");
    });

    it("rejects problematic input", function () {
        const parse = parser.ASTParser(/[0-9-\+\*]/, [
            { op: "+", precedence: 20, associativity: -1 },
            { op: "*", precedence: 30, associativity: -1 },
            { op: "-", precedence: 50, associativity:  0 }
        ]);
        assert.throws(() => parse(""));
        assert.throws(() => parse("  "));
        assert.throws(() => parse("2*"));
        assert.throws(() => parse("2*4 + 3+"));
        assert.throws(() => parse("*2 + 3"));
        assert.throws(() => parse("2 2*"));
        assert.throws(() => parse("5 +2 3 + 3"));
        assert.throws(() => parse("5 /2"));
    });

});

