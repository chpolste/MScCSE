// @flow
"use strict";

import type { JSONGameGraph, PredicateID } from "./system.js";
import type { Proposition, TransitionLabel } from "./logic.js";

import { sets, iter, WorkerCommunicator } from "./tools.js";
import { parseProposition, OnePairStreettAutomaton } from "./logic.js";
import { MappedJSONGameGraph, TwoPlayerProbabilisticGame } from "./game.js";


// https://github.com/facebook/flow/issues/3128
declare var self: DedicatedWorkerGlobalScope;


// The objective automaton is stored globally as it does not change between
// subsequent analyses.
let automaton: ?OnePairStreettAutomaton = null;

// The mapping of propositional formulas (over the linear predicates of the
// abstracted LSS) to automaton transition labels is also fixed and reused
// between subsequent analyses.
let alphabetMap: ?Map<TransitionLabel, Proposition> = null;


// Because https://github.com/facebook/flow/pull/6100 is not merged yet:
// $FlowFixMe
const communicator = new WorkerCommunicator(self);

communicator.onMessage(null, function (msg) {
    throw new Error("received unexpected message");
});


function checkIfReady() {
    if (automaton != null && alphabetMap != null) {
        communicator.postMessage("ready", null);
    }
}

// Request automaton
communicator.postMessage("automaton", null, function (msg) {
    if (typeof msg.data !== "string") throw new Error(
        "automaton: expected type 'string', got '" + typeof msg.data + "'"
    );
    automaton = OnePairStreettAutomaton.parse(msg.data);
    checkIfReady();
});

// Request alphabetMap
communicator.postMessage("alphabetMap", null, function (msg) {
    if (typeof msg.data !== "object") throw new Error(
        "alphabetMap: expected type 'object', got '" + typeof msg.data + "'"
    );
    const newAlphabetMap = new Map();
    for (let label in msg.data) {
        const prop = msg.data[label];
        if (typeof prop !== "string") throw new Error(
            "alphabetMap: expected type 'string', got '" + typeof prop + "'"
        );
        newAlphabetMap.set(label, parseProposition(prop));
    }
    alphabetMap = newAlphabetMap;
    checkIfReady();
});



/* Game Analysis */

// Check if the propositional formula associated with the transition label is
// fulfilled assuming that the predicates (= atomic propositions) from the
// given set are TRUE.
function predicateTest(transitionLabel: TransitionLabel, predicates: Set<PredicateID>): boolean {
    if (alphabetMap == null) throw new Error(
        "..." // TODO
    );
    const formula = alphabetMap.get(transitionLabel);
    if (formula == null) throw new Error(
        "..." // TODO
    );
    return formula.evalWith(p => predicates.has(p.symbol));
}

// Receive the transition system induced by the abstracted LSS and create and
// solve the product-game of the transition system with the objective
// automaton. Return the analysis result to the inspector.
communicator.onMessage("analysis", function (msg) {
    if (automaton == null) throw new Error(
        "cannot analyse game because automaton is not yet set"
    );
    if (alphabetMap == null) throw new Error(
        "cannot analyse game because alphabetMap is not yet set"
    );
    if (typeof msg.data !== "string") throw new Error(
        "analysis: expected type 'string', got '" + typeof msg.data + "'"
    );
    const snapshot: JSONGameGraph = JSON.parse(msg.data);
    const gameGraph = new MappedJSONGameGraph(snapshot);
    const game = TwoPlayerProbabilisticGame.fromProduct(gameGraph, automaton, predicateTest);
    const analysis = game.analyse(new Map([
        ["satisfying",      TwoPlayerProbabilisticGame.analyseSatisfying],
        ["non-satisfying",  TwoPlayerProbabilisticGame.analyseNonSatisfying]
    ]));
    msg.answer(analysis);
});

