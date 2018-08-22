// @flow
"use strict";

import type { Halfspace, ConvexPolytope } from "./geometry.js";
import type { Objective } from "./logic.js";
import type { Input } from "./widgets-input.js";

import * as presets from "./presets.js";
import { LSS, AbstractedLSS } from "./system.js";
import { Keybindings, clearNode, appendChild, createElement } from "./domtools.js";
import { SessionManager, ProblemSetup, ProblemSummary, SystemInspector } from "./inspector-widgets.js";


const contentNode = document.getElementById("inspector");
if (contentNode == null) throw new Error();

const keybindings = new Keybindings();

const problemSetup = new ProblemSetup(function (lss, predicates, predicateLabels, objective) {

    // Create initial abstraction of LSS by decomposing with the specified
    // predicates
    const system = lss.decompose(predicates, predicateLabels);

    // Show a summary of the problem setup and the interactive system inspector
    const problem = new ProblemSummary(system, objective);
    const inspector = new SystemInspector(system, objective, keybindings);

    if (contentNode == null) throw new Error();
    clearNode(contentNode);
    appendChild(contentNode,
        problem.node,
        inspector.node
    );
    contentNode.scrollIntoView();

});
const sessionManager = new SessionManager(problemSetup);

clearNode(contentNode);
appendChild(contentNode,
    sessionManager.node,
    problemSetup.node
);
// Temporarily start inspector with preset 2 immediately
problemSetup.load(presets.setups["Svorenova et al. (2017)'s Double Integrator"]);
//problemSetup.submit();

