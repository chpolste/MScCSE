// @flow
"use strict";

import type { PredicateID } from "./system.js";
import type { JSONGameGraph, AnalysisResults } from "./game.js";
import type { JSONObjective } from "./logic.js";

import { Communicator } from "./worker.js";
import { sets, iter } from "./tools.js";
import { Objective } from "./logic.js";
import { MappedJSONGameGraph, TwoPlayerProbabilisticGame } from "./game.js";


// https://github.com/facebook/flow/issues/3128
declare var self: DedicatedWorkerGlobalScope;


// The objective is stored once globally at startup as it does not change
// between subsequent analyses
let $objective: ?Objective = null;


const communicator = new Communicator("1W");

type AnalysisRequest = JSONGameGraph;
type AnalysisData = AnalysisResults;
// Receive the transition system induced by the abstracted LSS and create and
// solve the product-game of the transition system with the objective
// automaton. Return the analysis result to the inspector.
communicator.onRequest("analyse", function (data: AnalysisRequest): AnalysisData {
    if ($objective == null) throw new Error(
        "cannot analyse game because objective is not set"
    );
    const gameGraph = new MappedJSONGameGraph(data);
    const game = TwoPlayerProbabilisticGame.fromProduct(gameGraph, $objective);
    return game.analyse();
});


// Because https://github.com/facebook/flow/pull/6100 is not merged yet:
// $FlowFixMe
communicator.host = self;


// Initialize worker: obtain all data that does not change during analysis and
// store it once globally.

// Obtain automaton
communicator.request("objective", null).then(function (data: JSONObjective) {
    $objective = Objective.deserialize(data);
    return communicator.request("ready");
}).then(function (data) {
    // all good
}).catch((e) => console.log(e)); // TODO

