// @flow
"use strict";

import type { PredicateID } from "./system.js";
import type { JSONGameGraph } from "./game.js";
import type { Proposition, TransitionLabel } from "./logic.js";

import { Communicator } from "./worker.js";
import { sets, iter } from "./tools.js";
import { parseProposition, OnePairStreettAutomaton } from "./logic.js";
import { MappedJSONGameGraph, TwoPlayerProbabilisticGame } from "./game.js";


// https://github.com/facebook/flow/issues/3128
declare var self: DedicatedWorkerGlobalScope;


// The objective automaton is stored globally as it does not change between
// subsequent analyses.
let $coSafeInterpretation: boolean = false;
let $automaton: ?OnePairStreettAutomaton = null;

// The mapping of propositional formulas (over the linear predicates of the
// abstracted LSS) to automaton transition labels is also fixed and reused
// between subsequent analyses.
let $alphabetMap: ?Map<TransitionLabel, Proposition> = null;


// Check if the propositional formula associated with the transition label is
// fulfilled assuming that the predicates (= atomic propositions) from the
// given set are TRUE.
function predicateTest(transitionLabel: TransitionLabel, predicates: Set<PredicateID>): boolean {
    if ($alphabetMap == null) throw new Error(
        "Mapping of transition labels to propositional formulas not initialized"
    );
    const formula = $alphabetMap.get(transitionLabel);
    if (formula == null) throw new Error(
        "No propositional formula for transition '" + transitionLabel + "' specified"
    );
    return formula.evalWith(p => predicates.has(p.symbol));
}


const communicator = new Communicator("1W");

type AnalysisRequest = JSONGameGraph;
type AnalysisData = Map<string, Set<string>>;
// Receive the transition system induced by the abstracted LSS and create and
// solve the product-game of the transition system with the objective
// automaton. Return the analysis result to the inspector.
communicator.onRequest("analysis", function (data: AnalysisRequest): AnalysisData {
    if ($automaton == null) throw new Error(
        "cannot analyse game because automaton is not yet set"
    );
    if ($alphabetMap == null) throw new Error(
        "cannot analyse game because alphabetMap is not yet set"
    );
    const gameGraph = new MappedJSONGameGraph(data);
    const game = TwoPlayerProbabilisticGame.fromProduct(
        gameGraph, $automaton, predicateTest, $coSafeInterpretation
    );
    return game.analyse(new Map([
        ["satisfying",      TwoPlayerProbabilisticGame.analyseSatisfying],
        ["non-satisfying",  TwoPlayerProbabilisticGame.analyseNonSatisfying]
    ]));
});


// Because https://github.com/facebook/flow/pull/6100 is not merged yet:
// $FlowFixMe
communicator.host = self;


// Initialize worker: obtain all data that does not change during analysis and
// store it once globally.

// Obtain automaton
communicator.request("automaton", null).then(function (data) {
    if (typeof data !== "string") throw new Error(
        "automaton: expected type 'string', got '" + typeof data + "'"
    );
    $automaton = OnePairStreettAutomaton.parse(data);
    return communicator.request("coSafeInterpretation", null);

// Obtain co-safe interpretation status (true/false)
}).then(function (data) {
    if (typeof data !== "boolean") throw new Error(
        "coSafeInterpretation: expected type 'boolean', got '" + typeof data + "'"
    );
    if ($automaton == null || data && !$automaton.isCoSafeCompatible) throw new Error(
        "co-safe interpretaton requested but automaton is not co-safe compatible"
    );
    $coSafeInterpretation = data;
    return communicator.request("alphabetMap", null);

// Obtain alphabetMap connecting transition labels and propositional formulas
}).then(function (data) {
    if (typeof data !== "object") throw new Error(
        "alphabetMap: expected type 'object', got '" + typeof data + "'"
    );
    const newAlphabetMap = new Map();
    for (let label in data) {
        const prop = data[label];
        if (typeof prop !== "string") throw new Error(
            "alphabetMap: expected type 'string', got '" + typeof prop + "'"
        );
        newAlphabetMap.set(label, parseProposition(prop));
    }
    $alphabetMap = newAlphabetMap;
    return communicator.request("ready");

// All good
}).then(function (data) {
    // pass
}).catch(function (err) {
    console.log(err); // TODO
});

