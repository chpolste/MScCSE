// @flow
"use strict";

const assert = require("assert");
const logic = require("../../src/js/logic.js");
const presets = require("../../src/js/presets.js");



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

