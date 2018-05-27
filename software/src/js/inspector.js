// @flow
"use strict";

import type { Halfspace, ConvexPolytope } from "./geometry.js";
import type { Objective } from "./logic.js";
import type { Input } from "./widgets-input.js";

import * as presets from "./presets.js";
import { LSS, AbstractedLSS } from "./system.js";
import { clearNode, appendChild, createElement } from "./domtools.js";
import { SelectInput } from "./widgets-input.js";
import { color, evolutionEquation, tableify,
         ProblemSetupPreview, EvolutionEquationInput, PolytopeInput, PredicatesInput, ObjectiveInput,
         SystemViewSettings, SystemSummary, StateView, ControlView, SystemView, ActionView,
         ActionSupportView } from "./widgets-inspector.js";


/* Inline Information display */

function infoBox(contentID: string): Element {
    let node = document.createElement("div");
    node.className = "info_button";
    node.innerHTML = "?";
    node.addEventListener("mouseover", (e: MouseEvent) => {
        let content = document.getElementById(contentID);
        if (content != null) {
            content.style.display = "block";
            content.style.top = String(node.offsetTop) + "px";
            content.style.left = String(node.offsetLeft - content.offsetWidth - 5) + "px";
        }
    });
    node.addEventListener("mouseout", (e: MouseEvent) => {
        let content = document.getElementById(contentID);
        if (content != null) {
            content.style.display = "none";
        }
    });
    return node;
}


/* Session Management */

type SystemSetup = {
    dimension: {
        stateSpace: string,
        controlSpace: string
    },
    equation: {
        A: string,
        B: string,
    },
    polytope: {
        controlSpace: string,
        randomSpace: string,
        stateSpace: string
    },
    predicates: string,
    objective: string
};


// Load and resume sessions from files and provide presets for problem setup
class SessionManagerWidget {

    +node: HTMLDivElement;
    +problemSetup: ProblemSetupWidget;

    constructor(problemSetup: ProblemSetupWidget): void {
        this.node = document.createElement("div");
        this.problemSetup = problemSetup;
        let presetSelect = new SelectInput(presets.setups);
        let presetButton = createElement("input", {"type": "button", "value": "fill in"});
        presetButton.addEventListener("click", () => this.problemSetup.load(presetSelect.value));
        appendChild(this.node,
            createElement("h2", {}, ["Session Management"]),
            createElement("h3", {}, ["Load session from file"]),
            createElement("p", {}, [createElement("input", {"type": "file", "disabled": "true"})]),
            createElement("p", {}, [
                createElement("input", {"type": "button", "value": "resume session", "disabled": "true"}), " ",
                createElement("input", {"type": "button", "value": "fill in setup only", "disabled": "true"}),
            ]),
            createElement("h3", {}, ["Start from a preset"]),
            createElement("p", {}, [presetSelect.node, " ", presetButton])
        );
    }

}



/* Problem Setup */

type ProblemCallback = (LSS, Halfspace[], string[], Objective) => void;

class ProblemSetupWidget {
    
    +node: HTMLFormElement;
    +ssDim: Input<number>;
    +csDim: Input<number>;
    +equation: EvolutionEquationInput;
    +preview: ProblemSetupPreview;
    +ss: Input<ConvexPolytope>;
    +rs: Input<ConvexPolytope>;
    +cs: Input<ConvexPolytope>;
    +predicates: Input<[Halfspace[], string[]]>;
    +objective: Input<Objective>;
    +callback: ProblemCallback;
    +system: AbstractedLSS;

    constructor(callback: ProblemCallback) {
        this.callback = callback;

        this.node = document.createElement("form");
        this.ssDim = new SelectInput({"1-dimensional": 1, "2-dimensional": 2}, "2-dimensional");
        this.csDim = new SelectInput({"1-dimensional": 1, "2-dimensional": 2}, "2-dimensional");
        this.equation = new EvolutionEquationInput(this.ssDim, this.csDim);
        this.preview = new ProblemSetupPreview();
        this.ss = new PolytopeInput(this.ssDim, false);
        this.rs = new PolytopeInput(this.ssDim, false);
        this.cs = new PolytopeInput(this.csDim, false);
        this.predicates = new PredicatesInput(this.ssDim);
        this.objective = new ObjectiveInput(this.predicates);

        let submit = createElement("input", {"type": "submit", "value": "run inspector"});
        submit.addEventListener("click", (e: Event) => {
            if (this.node.checkValidity()) {
                e.preventDefault();
                this.submit();
            }
        });

        appendChild(this.node,
            createElement("h2", {}, ["Problem Setup"]),
            createElement("h3", {}, ["Dimensions"]),
            createElement("p", {}, [this.ssDim.node, " state space"]),
            createElement("p", {}, [this.csDim.node, " control space"]),
            createElement("h3", {}, ["Evolution Equation"]), this.equation.node,
            createElement("div", { "class": "inspector", "style": "margin:0;" }, [
                createElement("div", { "class": "left" }, [
                    createElement("h3", {}, ["System Preview"]), this.preview.node,
                    createElement("h3", {}, ["Objective Property"]), this.objective.node
                ]),
                createElement("div", { "class": "right" }, [
                    createElement("h3", {}, ["Control Space Polytope"]),
                    this.cs.node,
                    createElement("h3", {}, ["Random Space Polytope"]),
                    this.rs.node,
                    createElement("h3", {}, ["State Space Polytope"]),
                    this.ss.node,
                    createElement("h3", {}, ["Initial State Space Decomposition"]),
                    this.predicates.node
                ])
            ]),
            createElement("h3", {}, ["Continue"]),
            createElement("p", {}, [submit])
        );

        this.equation.A.attach(() => this.draw());
        this.equation.B.attach(() => this.draw());
        this.ss.attach(() => this.draw());
        this.rs.attach(() => this.draw());
        this.cs.attach(() => this.draw());
        this.predicates.attach(() => this.draw());
    }

    get lssIsValid(): boolean {
        return this.equation.isValid && this.ss.isValid && this.rs.isValid && this.cs.isValid;
    }

    get lss(): LSS {
        return new LSS(
            this.equation.A.value, this.equation.B.value,
            this.ss.value, this.rs.value, [this.cs.value]
        );
    }

    get systemIsValid(): boolean {
        return this.lssIsValid && this.predicates.isValid;
    }

    get system(): AbstractedLSS {
        return this.lss.decompose(...this.predicates.value);
    }

    // Fill in text fields based on a saved preset
    load(setup: SystemSetup) {
        this.ssDim.text = setup.dimension.stateSpace;
        this.csDim.text = setup.dimension.controlSpace;
        this.equation.A.text = setup.equation.A;
        this.equation.B.text = setup.equation.B;
        this.cs.text = setup.polytope.controlSpace;
        this.rs.text = setup.polytope.randomSpace;
        this.ss.text = setup.polytope.stateSpace;
        this.predicates.text = setup.predicates;
        this.objective.text = setup.objective;
    }

    submit(): void {
        this.callback(this.lss, ...this.predicates.value, this.objective.value);
    }

    draw(): void {
        if (this.systemIsValid) {
            this.preview.drawAbsLSS(this.system);
        } else if (this.lssIsValid) {
            this.preview.drawLSS(this.lss);
        } else {
            this.preview.clear();
        }
    }

}


/* Inspector */

class InspectorWidget {

    +node: Element;

    +systemSummary: SystemSummary;
    +stateView: StateView;
    +actionView: ActionView;
    +controlView: ControlView;
    +actionSupportView: ActionSupportView;
    +systemViewSettings: SystemViewSettings;
    +systemView: SystemView;

    lss: LSS;
    system: AbstractedLSS;
    objective: Objective;

    constructor(lss: LSS, predicates: Halfspace[], predicateLabels: string[], objective: Objective) {
        this.lss = lss;
        this.system = this.lss.decompose(predicates, predicateLabels);
        this.objective = objective;

        this.systemSummary = new SystemSummary(this.system);
        this.stateView = new StateView();
        this.actionView = new ActionView(this.stateView);
        this.controlView = new ControlView(this.lss.controlSpace, this.actionView);
        this.actionSupportView = new ActionSupportView(this.actionView);
        this.systemViewSettings = new SystemViewSettings(this.system);
        this.systemView = new SystemView(
            this.system,
            this.systemViewSettings,
            this.stateView,
            this.actionView,
            this.actionSupportView
        );

        this.node = createElement("div", {}, [
            createElement("h2", {}, ["System Inspector"]),
            createElement("p", {}, ["Explore the linear stochastic system and its abstraction interactively and control the abstraction refinement process."]),
            createElement("div", {"class": "inspector"}, [
                createElement("div", { "class": "left" }, [
                    this.systemView.plot.node,
                    createElement("h3", {}, ["Abstraction refinement", infoBox("info_abstraction_refinement")]),
                    "TODO: split selected state, control algorithm, ...",
                ]),
                createElement("div", { "class": "right" }, [
                    createElement("div", {"class": "cols"}, [
                        createElement("div", { "class": "left" }, [
                            createElement("h3", {}, ["View Settings", infoBox("info_view_settings")]),
                            this.systemViewSettings.node,
                            createElement("h3", {}, ["System Information"]),
                            this.systemSummary.node
                        ]),
                        createElement("div", { "class": "right" }, [
                            createElement("h3", {}, ["Control Space", infoBox("info_control_space")]),
                            this.controlView.node,
                            createElement("h3", {}, ["Selected State", infoBox("info_selected_state")]),
                            this.stateView.node
                        ])
                    ]),
                    createElement("div", { "class": "rest" }, [
                        createElement("h3", {}, ["Actions", infoBox("info_actions")]),
                        this.actionView.node,
                        createElement("h3", {}, ["Action Supports", infoBox("info_action_supports")]),
                        this.actionSupportView.node
                    ]),
                ])
            ])
        ]);
    }

}


let contentNode = document.getElementById("content");
if (contentNode == null) {
    throw new Error();
}

let problemSetup = new ProblemSetupWidget(function (lss, predicates, predicateLabels, objective) {
    let inspector = new InspectorWidget(lss, predicates, predicateLabels, objective);
    if (contentNode == null) {
        throw new Error();
    }
    clearNode(contentNode);
    appendChild(contentNode,
        createElement("h2", {}, ["Problem"]),
        createElement("h3", {}, ["Evolution Equation"]), evolutionEquation(tableify(lss.A), tableify(lss.B)),
        inspector.node
    );
    inspector.node.scrollIntoView();
});
let sessionManager = new SessionManagerWidget(problemSetup);

clearNode(contentNode);
contentNode.appendChild(sessionManager.node);
contentNode.appendChild(problemSetup.node);
// Temporarily start inspector with preset 2 immediately
problemSetup.load(presets.setups["Svorenova et al. (2017)'s Double Integrator"]);
//problemSetup.submit();

