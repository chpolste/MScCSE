// @flow
"use strict";

import * as dom from "./dom.js";
import { SessionManager, ProblemSetup } from "./inspector-widgets-setup.js"
import { ProblemSummary, SystemInspector } from "./inspector-widgets-inspector.js";
import * as presets from "./presets.js";
import { just } from "./tools.js";


document.addEventListener("DOMContentLoaded", function () {

    const contentNode = just(document.getElementById("application"));

    const keybindings = new dom.Keybindings();

    const problemSetup = new ProblemSetup((lss, predicates, predicateLabels, objective, analyseWhenReady) => {

        // Create initial abstraction of LSS by decomposing with the specified
        // predicates
        const system = lss.decompose(predicates, predicateLabels);

        // Show a summary of the problem setup and the interactive system inspector
        const problem = new ProblemSummary(system, objective);
        const inspector = new SystemInspector(system, objective, keybindings, analyseWhenReady);

        dom.replaceChildren(contentNode, [problem.node, inspector.node]);
        contentNode.scrollIntoView();

    });
    const sessionManager = new SessionManager(problemSetup);

    dom.replaceChildren(contentNode, [sessionManager.node, problemSetup.node]);
    sessionManager.loadPreset();

    // Render all math on the page
    for (let node of document.querySelectorAll(".math")) {
        dom.renderTeX(node.innerHTML.replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<"), node);
    }

});

