// @flow
"use strict";

import * as presets from "./presets.js";
import * as dom from "./domtools.js";
import { SessionManager, ProblemSetup } from "./inspector-widgets-setup.js"
import { ProblemSummary, SystemInspector } from "./inspector-widgets-inspector.js";


document.addEventListener("DOMContentLoaded", function () {

    const contentNode = document.getElementById("application");
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
    // Temporarily start inspector with preset 2 immediately TODO
    problemSetup.load(presets.setups["Svorenova et al. (2017)'s Double Integrator"]);

    // Render all math on the page
    for (let node of document.querySelectorAll(".math")) {
        dom.renderTeX(node.innerHTML.replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<"), node);
    }

});

