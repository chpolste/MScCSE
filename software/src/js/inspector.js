// @flow
"use strict";

import type { Matrix, Vector } from "./linalg.js";
import type { ConvexPolytope, Halfspace } from "./geometry.js";
import type { LayeredFigure, FigureLayer, Shape } from "./figure.js";
import type { Plot } from "./widgets-plot.js";
import type { Input } from "./widgets-input.js";

import { union } from "./geometry.js";
import { clearNode, replaceNode, appendChild, createElement } from "./domtools.js";
import { Figure, autoProjection } from "./figure.js";
import { AxesPlot } from "./widgets-plot.js";
import { SelectInput } from "./widgets-input.js";
import { EvolutionEquationInput, PolytopeInput, PredicatesInput, SystemViewSettings,
         SystemSummary, StateView, ActionView, ActionSupportView, ControlView, SystemView,
         color, toShape, evolutionEquation } from "./widgets-inspector.js";
import { LSS, AbstractedLSS, State } from "./system.js";



/* Session Management */

class SessionManager {

    +node: HTMLDivElement;
    +problemSetup: ProblemSetup;

    constructor(problemSetup: ProblemSetup): void {
        this.node = document.createElement("div");
        this.problemSetup = problemSetup;
        let presetSelect = new SelectInput({
            "[1]'s Illustrative Example": () => this.applyPreset1(),
            "[1]'s Double Integrator": () => this.applyPreset2()
        });
        let presetButton = createElement("input", {"type": "button", "value": "fill in"});
        presetButton.addEventListener("click", () => presetSelect.value());
        appendChild(this.node,
            createElement("h2", {}, ["Session Management"]),
            createElement("h3", {}, ["Load session from file"]),
            createElement("p", {}, [createElement("input", {"type": "file", "disabled": "true"})]),
            createElement("p", {}, [
                createElement("input", {"type": "button", "value": "resume session", "disabled": "true"}),
            ]),
            createElement("h3", {}, ["Start from a preset"]),
            createElement("p", {}, [
                presetSelect.node, " ", presetButton
            ])
        );
    }

    applyPreset1() {
        let ps = this.problemSetup;
        ps.ssDim.text = ps.csDim.text = "2-dimensional";
        ps.equation.A.text = ps.equation.B.text = "1\n0\n0\n1";
        ps.ss.text = "0 < x\nx < 4\n0 < y\ny < 2";
        ps.rs.text = "-0.1 < x\nx < 0.1\n-0.1 < y\ny < 0.1";
        ps.cs.text = "-1 < x\nx < 1\n-1 < y\ny < 1";
        ps.predicates.text = "x > 2";
    }

    applyPreset2() {
        let ps = this.problemSetup;
        ps.ssDim.text = "2-dimensional";
        ps.csDim.text = "1-dimensional";
        ps.equation.A.text = "1\n1\n0\n1";
        ps.equation.B.text = "0.5\n1";
        ps.ss.text = "-5 < x\nx < 5\n-3 < y\ny < 3";
        ps.rs.text = "-0.1 < x\nx < 0.1\n-0.1 < y\ny < 0.1";
        ps.cs.text = "-1 < x\nx < 1";
        ps.predicates.text = "-1 < x\nx < 1\n-1 < y\ny < 1";
    }

}



/* Problem Setup */

type ProblemCallback = (lss: LSS, predicates: Halfspace[]) => void;

class ProblemSetup {
    
    +node: HTMLFormElement;
    +ssDim: Input<number>;
    +csDim: Input<number>;
    +equation: EvolutionEquationInput;
    +ss: Input<ConvexPolytope>;
    +rs: Input<ConvexPolytope>;
    +cs: Input<ConvexPolytope>;
    +predicates: Input<Halfspace[]>;
    +preview: Plot;
    +previewLayer: FigureLayer;
    +callback: ProblemCallback;
    +system: AbstractedLSS;

    constructor(callback: ProblemCallback) {
        this.callback = callback;

        this.node = document.createElement("form");
        this.ssDim = new SelectInput({"1-dimensional": 1, "2-dimensional": 2}, "2-dimensional");
        this.csDim = new SelectInput({"1-dimensional": 1, "2-dimensional": 2}, "2-dimensional");
        this.equation = new EvolutionEquationInput(this.ssDim, this.csDim);
        this.ss = new PolytopeInput(this.ssDim, false);
        this.rs = new PolytopeInput(this.ssDim, false);
        this.cs = new PolytopeInput(this.csDim, false);
        this.predicates = new PredicatesInput(this.ssDim);

        let fig = new Figure();
        this.preview = new AxesPlot([600, 400], fig, autoProjection(6/4));
        this.previewLayer = fig.newLayer({ "stroke": "#000", "stroke-width": "1" });
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
            createElement("div", {"class": "cols"}, [
                createElement("div", {}, [
                    createElement("h3", {}, ["System Preview"]), this.preview.node,
                    this.predicates.node
                ]),
                createElement("div", {}, [
                    createElement("h3", {}, ["State Space Predicates"]), this.ss.node,
                    createElement("h3", {}, ["Random Space Predicates"]), this.rs.node,
                    createElement("h3", {}, ["Control Space Predicates"]), this.cs.node
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
        return this.lss.decompose(this.predicates.value);
    }

    submit(): void {
        this.callback(this.lss, this.predicates.value);
    }

    draw(): void {
        if (this.systemIsValid) {
            let system = this.system;
            this.preview.projection = autoProjection(3/2, ...system.extent);
            this.previewLayer.shapes = system.states.map(toShape);
        } else if (this.lssIsValid) {
            let lss = this.lss;
            this.preview.projection = autoProjection(3/2, ...lss.extent);
            this.previewLayer.shapes = [
                { kind: "polytope", vertices: lss.stateSpace.vertices, style: { fill: color.undecided } },
                ...union.remove(lss.oneStepReachable, [lss.stateSpace]).map(
                    poly => ({ kind: "polytope", vertices: poly.vertices, style: { fill: color.nonSatisfying } })
                )
            ];
        } else {
            this.preview.projection = autoProjection(3/2);
        }
    }

}



/* Inspector */

function tableify(m: Matrix): Element {
    return createElement("table", { "class": "matrix" },
        m.map(row => createElement("tr", {},
            row.map(x => createElement("td", {}, [
                createElement("span", {}, [String(x)])
            ]))
        ))
    );
}

class Inspector {

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

    constructor(lss: LSS, predicates: Halfspace[]) {
        this.lss = lss;
        this.system = this.lss.decompose(predicates);

        this.systemSummary = new SystemSummary(this.system);

        this.stateView = new StateView();
        this.actionView = new ActionView(this.stateView);
        this.controlView = new ControlView(this.lss.controlSpace, this.actionView);
        this.actionSupportView = new ActionSupportView(this.actionView);
        this.actionView.node.className = "actions";
        this.actionSupportView.node.className = "supports";

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
            createElement("div", {"class": "cols"}, [
                createElement("div", {}, [
                    this.systemView.plot.node,
                    createElement("h3", {}, ["Abstraction refinement"]),
                    "TODO: split selected state, control algoritm, ..."
                ]),
                createElement("div", { "class": "hsep" }, [
                    createElement("div", {"class": "cols vsep"}, [
                        createElement("div", { "class": "sidebar1" }, [
                            createElement("h3", {}, ["View Settings"]), this.systemViewSettings.node,
                            createElement("h3", {}, ["System Information"]), this.systemSummary.node
                        ]),
                        createElement("div", { "class": "sidebar2" }, [
                            createElement("h3", {}, ["Control Space"]), this.controlView.node,
                            createElement("h3", {}, ["Selected State"]), this.stateView.node
                        ])
                    ]),
                    createElement("div", {}, [
                        createElement("h3", {}, ["Actions"]), this.actionView.node,
                        createElement("h3", {}, ["Action Supports"]), this.actionSupportView.node
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

let problemSetup = new ProblemSetup(function (lss: LSS, predicates: Halfspace[]) {
    let inspector = new Inspector(lss, predicates);
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
let sessionManager = new SessionManager(problemSetup);

clearNode(contentNode);
contentNode.appendChild(sessionManager.node);
contentNode.appendChild(problemSetup.node);
// Temporarily start inspector with preset 2 immediately
sessionManager.applyPreset2();
//problemSetup.submit();

