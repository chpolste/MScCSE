// @flow
"use strict";

import type { JSONObjective } from "./logic.js";
import type { JSONSnapshotTree } from "./snapshot.js";

import * as dom from "./dom.js";
import { SessionManager, ProblemSetup } from "./inspector-widgets-setup.js"
import { ProblemSummary, SystemInspector } from "./inspector-widgets-inspector.js";
import { Objective } from "./logic.js";
import * as presets from "./presets.js";
import { AbstractedLSS } from "./system.js";
import { just } from "./tools.js";


export type JSONSession = {
    objective: JSONObjective,
    snapshots: JSONSnapshotTree
};


document.addEventListener("DOMContentLoaded", function () {

    const contentNode = just(document.getElementById("application"));
    const keybindings = new dom.Keybindings();

    function startInspector(system: AbstractedLSS, objective: Objective,
                            analyseWhenReady: boolean, session: ?JSONSession) {
        // Show a summary of the problem setup and the interactive system inspector
        const problem = new ProblemSummary(system, objective);
        const inspector = new SystemInspector(system, objective, keybindings, analyseWhenReady, session);
        // Replace problem setup screen with inspector application
        dom.replaceChildren(contentNode, [problem.node, inspector.node]);
        contentNode.scrollIntoView();
    }

    const problemSetup = new ProblemSetup((lss, predicates, predicateLabels, objective, analyseWhenReady) => {
        // Create initial abstraction of LSS by decomposing with the specified
        // predicates
        const system = lss.decompose(predicates, predicateLabels);
        // Switch to inspector
        startInspector(system, objective, analyseWhenReady, null);
    });

    const sessionManager = new SessionManager(problemSetup, (session: JSONSession) => {
        // Basic session object check
        if (session.objective == null || session.snapshots == null) throw new Error(
            "Invalid session file"
        );
        // Deserialize objective for inspector initialization
        const objective = Objective.deserialize(session.objective);
        // Pick out root node from snapshot tree and use as base-system
        const root = session.snapshots.root;
        if (root == null) throw new Error(
            "Session does not contain snapshots"
        );
        const [snapshot, _] = session.snapshots.snapshots[root];
        const system = AbstractedLSS.deserialize(snapshot.system);
        // Switch to inspector
        startInspector(system, objective, false, session);
    });

    dom.replaceChildren(contentNode, [sessionManager.node, problemSetup.node]);
    sessionManager.loadPreset();

    // Render all math on the page
    for (let node of document.querySelectorAll(".math")) {
        dom.renderTeX(node.innerHTML.replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<"), node);
    }

});

