// @flow
"use strict";

import type { Halfspace, ConvexPolytope } from "./geometry.js";
import type { Objective } from "./logic.js";
import type { Input } from "./widgets-input.js";

import * as presets from "./presets.js";
import * as dom from "./domtools.js";
import { LSS, AbstractedLSS } from "./system.js";
import { SessionManager, ProblemSetup, ProblemSummary, SystemInspector } from "./inspector-widgets.js";


const contentNode = document.getElementById("inspector");
if (contentNode == null) throw new Error();

const keybindings = new dom.Keybindings();

const problemSetup = new ProblemSetup(function (lss, predicates, predicateLabels, objective) {

    // Create initial abstraction of LSS by decomposing with the specified
    // predicates
    const system = lss.decompose(predicates, predicateLabels);

    // Show a summary of the problem setup and the interactive system inspector
    const problem = new ProblemSummary(system, objective);
    const inspector = new SystemInspector(system, objective, keybindings);

    if (contentNode == null) throw new Error();
    dom.replaceChildren(contentNode, [problem.node, inspector.node]);
    contentNode.scrollIntoView();

});
const sessionManager = new SessionManager(problemSetup);

dom.replaceChildren(contentNode, [sessionManager.node, problemSetup.node]);
// Temporarily start inspector with preset 2 immediately
problemSetup.load(presets.setups["Svorenova et al. (2017)'s Double Integrator"]);
//problemSetup.submit();

