// @flow
"use strict";

import type { Halfspace, ConvexPolytope } from "./geometry.js";
import type { Objective } from "./logic.js";
import type { Input } from "./widgets-input.js";

import * as presets from "./presets.js";
import { LSS, AbstractedLSS } from "./system.js";
import { Keybindings, clearNode, appendChild, createElement } from "./domtools.js";
import { SessionManager, ProblemSetup, ProblemSummary, SystemInspector } from "./widgets-inspector.js";


const contentNode = document.getElementById("content");
if (contentNode == null) throw new Error();

const keybindings = new Keybindings();

const problemSetup = new ProblemSetup(function (lss, predicates, predicateLabels, objective) {

    // Create initial abstraction of LSS by decomposing with the specified
    // predicates
    const system = lss.decompose(predicates, predicateLabels);

    // Show a summary of the problem setup and the interactive system inspector
    const problem = new ProblemSummary(system, objective);
    const inspector = new SystemInspector(system, keybindings);

    if (contentNode == null) throw new Error();
    clearNode(contentNode);
    appendChild(contentNode,
        createElement("h2", {}, ["Problem Summary"]),
        problem.node,
        createElement("h2", {}, ["System Inspector"]),
        createElement("p", {}, ["Explore the linear stochastic system and its abstraction interactively and control the abstraction refinement process."]),
        inspector.node
    );
    inspector.node.scrollIntoView();

});
const sessionManager = new SessionManager(problemSetup);

clearNode(contentNode);
contentNode.appendChild(sessionManager.node);
contentNode.appendChild(problemSetup.node);
// Temporarily start inspector with preset 2 immediately
problemSetup.load(presets.setups["Svorenova et al. (2017)'s Double Integrator"]);
//problemSetup.submit();

