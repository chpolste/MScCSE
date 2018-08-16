// @flow
"use strict";

const assert = require("assert");
const logic = require("../../src/js/logic.js");
const presets = require("../../src/js/presets.js");



describe("logic: Propositional Logic", function () {
    
    it("parseProposition-stringifyProposition is identity", function () {
        const pro1 = logic.parseProposition("a | b & !c");
        const str1 = logic.stringifyProposition(pro1);
        const pro2 = logic.parseProposition(str1);
        const str2 = logic.stringifyProposition(pro2);
        assert.equal(str1, str2);
    });

    it("traverseProposition visits all nodes exactly once", function () {
        const prop = logic.parseProposition("a | b & !c");
        const visited = new Set();
        logic.traverseProposition(n => {
            assert(!visited.has(n));
            visited.add(n);
        }, prop);
        assert.equal(visited.size, 6);
    });

});


describe("logic.OnePairStreettAutomaton", function () {

    it("parse-stringify is identity for presets", function () {
        for (let objective in presets.objectives) {
            const aut1 = logic.OnePairStreettAutomaton.parse(presets.objectives[objective].automaton);
            const str1 = aut1.stringify();
            const aut2 = logic.OnePairStreettAutomaton.parse(str1);
            const str2 = aut2.stringify();
            assert.equal(str1, str2);
        }
    });

});

