// @flow
"use strict";

// Widgets here take other inputs as dimension/shape args, to allow change

import type { ConvexPolytope, ConvexPolytopeUnion, Halfspace } from "./geometry.js";
import type { Decomposition, Action } from "./system.js";
import type { LayeredFigure, FigureLayer, Shape } from "./figure.js";
import type { Plot } from "./widgets-plot.js";
import type { Input } from "./widgets-input.js";

import { ObservableMixin } from "./tools.js";
import { clearNode, appendChild, createElement } from "./domtools.js";
import { HalfspaceInequation, polytopeType, union } from "./geometry.js";
import { Figure, autoProjection } from "./figure.js";
import { InteractivePlot, AxesPlot } from "./widgets-plot.js";
import { ValidationError, CheckboxInput, SelectInput, MultiLineInput, MatrixInput } from "./widgets-input.js";
import { AbstractedLSS, State, SplitWithSatisfyingPredicates } from "./system.js";


const VAR_NAMES = "xy";

export const color = {
    satisfying: "#093",
    nonSatisfying: "#CCC",
    undecided: "#FFF",
    selection: "#069",
    highlight: "#FC0",
    support: "#09C",
    action: "#F60",
    split: "#C00"
};

export function toShape(state: State): Shape {
    let fill = color.undecided;
    if (state.isSatisfying) {
        fill = color.satisfying;
    } else if (state.isNonSatisfying) {
        fill = color.nonSatisfying;
    }
    return { kind: "polytope", vertices: state.polytope.vertices, style: { fill: fill } };
}

export function toSummaryLine(state: State): Element {
    let cls = "undecided", name = "undecided";
    if (state.isSatisfying) {
        cls = name  = "satisfying"
    } else if (state.isNonSatisfying) {
        cls = name = "non-satisfying"
        if (state.isOutside) {
            name = name + "/outer";
        }
    }
    return createElement("p", { "class": cls.replace("-", "") }, [name]);
}

export function evolutionEquation(nodeA: Element, nodeB: Element): Element {
    return createElement("p", {}, [
        "x", createElement("sub", {}, ["t+1"]),
        " = ", nodeA, " x", createElement("sub", {}, ["t"]),
        " + ", nodeB, " u", createElement("sub", {}, ["t"]),
        " + w", createElement("sub", {}, ["t"])
    ]);
}


/* Problem Setup */

export class EvolutionEquationInput {

    +node: Element;
    +ssDim: Input<number>;
    +csDim: Input<number>;
    +A: MatrixInput<number>;
    +B: MatrixInput<number>;
    +isValid: boolean;

    constructor(ssDim: Input<number>, csDim: Input<number>) {
        this.ssDim = ssDim;
        this.csDim = csDim;
        this.A = new MatrixInput(EvolutionEquationInput.parseNumber, [2, 2], 2);
        this.B = new MatrixInput(EvolutionEquationInput.parseNumber, [2, 2], 2);
        this.node = createElement("div", {}, [evolutionEquation(this.A.node, this.B.node)]);
        ssDim.attach(() => {
            this.A.shape = [ssDim.value, ssDim.value];
            this.B.shape = [ssDim.value, csDim.value];
        });
        csDim.attach(() => {
            this.B.shape = [ssDim.value, csDim.value];
        });
    }

    get isValid(): boolean {
        if (this.A.isValid && this.B.isValid) {
            let shapeA = this.A.shape;
            let shapeB = this.B.shape;
            return shapeA[0] === this.ssDim.value && shapeA[0] === shapeA[1]
                && shapeB[0] === this.ssDim.value && shapeB[1] === this.csDim.value;
        }
        return false;
    }

    static parseNumber(text: string): number {
        let out = parseFloat(text);
        if (isNaN(out)) {
            throw new ValidationError("invalid number '" + text + "'");
        }
        return out;
    }

}


export class PolytopeInput extends ObservableMixin<null> implements Input<ConvexPolytope> {

    +node: HTMLDivElement;
    +preview: AxesPlot;
    +previewLayer: FigureLayer;
    +dim: Input<number>;
    +allowEmpty: boolean;
    +predicates: MultiLineInput<Halfspace>;
    variables: string;

    constructor(dim: Input<number>, allowEmpty: boolean) {
        super();
        this.allowEmpty = allowEmpty;
        this.dim = dim;
        this.dim.attach(() => {
            this.variables = VAR_NAMES.substring(0, this.dim.value);
            this.predicates.changeHandler(); // Triggers this.changeHandler
        });
        this.variables = VAR_NAMES.substring(0, this.dim.value)
        this.predicates = new MultiLineInput(
            line => HalfspaceInequation.parse(line, this.variables),
            [5, 15]
        );
        this.predicates.attach(() => this.changeHandler());
        let fig = new Figure();
        this.previewLayer = fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "none" });
        this.preview = new AxesPlot([90, 90], fig, autoProjection(4/3));
        this.node = document.createElement("div");
        this.node.className = "polytope_builder";
        appendChild(this.node, this.predicates.node, this.preview.node);
        this.changeHandler();
    }

    get value(): ConvexPolytope {
        return polytopeType(this.variables.length).noredund(this.predicates.value);
    }

    get text(): string {
        return this.predicates.text;
    }

    set text(text: string): void {
        this.predicates.text = text;
    }

    get isValid(): boolean {
        return this.predicates.isValid && this.variables.length === this.dim.value && (this.allowEmpty || !this.value.isEmpty);
    }

    changeHandler(): void {
        let proj = autoProjection(1);
        let shapes = [];
        if (this.isValid) {
            let poly = this.value;
            if (!poly.isEmpty) {
                proj = autoProjection(1, ...poly.extent);
                shapes = [{ kind: "polytope", vertices: poly.vertices }];
            }
        } else {
            if (this.predicates.isValid) {
                // Hijack form validation to display error message
                this.predicates.node.setCustomValidity("Polytope is empty or unbounded");
            }
        }
        this.preview.projection = proj;
        this.previewLayer.shapes = shapes;
        this.notify();
    }

}


export class DecompositionInput extends ObservableMixin<null> implements Input<Decomposition> {

    +node: HTMLDivElement;
    +dim: Input<number>;
    +predicates: Input<Halfspace[]>;
    variables: string;

    constructor(dim: Input<number>): void {
        super();
        this.dim = dim;
        this.dim.attach(() => { 
            this.variables = VAR_NAMES.substring(0, this.dim.value);
            this.predicates.changeHandler();
        });
        this.variables = VAR_NAMES.substring(0, this.dim.value);
        this.predicates = new MultiLineInput(
            line => HalfspaceInequation.parse(line, this.variables),
            [8, 30]
        );
        this.predicates.attach(() => this.changeHandler());
        
        this.node = document.createElement("div");
        appendChild(this.node,
            createElement("h3", {}, ["State Space Decomposition"]),
            createElement("p", {}, ["Only reachability problems are supported. Split with satisfying predicate(s):"]),
            this.predicates.node
        );
    }

    get value(): Decomposition {
        return new SplitWithSatisfyingPredicates(this.predicates.value);
    }

    get text(): string {
        return this.predicates.text;
    }

    set text(text: string): void {
        this.predicates.text = text;
    }

    get isValid(): boolean {
        return this.predicates.isValid && this.predicates.value.length > 0
            && this.variables.length === this.dim.value;
    }

    changeHandler(): void {
        // TODO validate number of predicates
        this.notify();
    }

}


/* Inspector */

type ClickOperatorWrapper = (state: State) => ConvexPolytopeUnion;
type HoverOperatorWrapper = (origin: State, target: State) => ConvexPolytopeUnion;

export class ViewSettings extends ObservableMixin<null> {

    +node: Element;
    +system: AbstractedLSS;
    +toggleKind: Input<boolean>;
    +toggleLabel: Input<boolean>;
    +highlight: Input<ClickOperatorWrapper>;
    
    constructor(): void {
        super();
        this.toggleKind = new CheckboxInput(false);
        this.toggleLabel = new CheckboxInput(false);
        this.highlight = new SelectInput({
            "None": state => [],
            "Posterior": state => state.post(state.system.controlSpace),
            "Predecessor": state => state.system.pre(state.system.stateSpace, state.system.controlSpace, [state.polytope]),
            "Robust Predecessor": state => state.system.preR(state.system.stateSpace, state.system.controlSpace, [state.polytope]),
            "Attractor": state => state.system.attr(state.system.stateSpace, state.system.controlSpace, [state.polytope]),
            "Robust Attractor": state => state.system.attrR(state.system.stateSpace, state.system.controlSpace, [state.polytope])
        }, "Posterior");

        this.node = createElement("div", { "class": "summary" }, [
            createElement("label", {}, [this.toggleKind.node, "state kind colors"]),
            createElement("label", {}, [this.toggleLabel.node, "state labels"]),
            createElement("p", { "class": "posterior" }, ["Highlight operator:"]),
            createElement("p", {}, [this.highlight.node])
        ]);
    }

}

export class SystemView extends ObservableMixin<null> {

    +system: AbstractedLSS;
    +viewSettings: ViewSettings;
    +plot: Plot;
    +kindLayer: FigureLayer;
    +highlight1Layer: FigureLayer;
    +selectionLayer: FigureLayer;
    +highlight2Layer: FigureLayer;
    +supportLayer: FigureLayer;
    +actionLayer: FigureLayer;
    +labelLayer: FigureLayer;
    +interactionLayer: FigureLayer;
    selection: ?State;

    constructor(system: AbstractedLSS, viewSettings: ViewSettings): void {
        super();
        this.system = system;
        this.selection = null;
        this.viewSettings = viewSettings;
        this.viewSettings.toggleKind.attach(() => this.drawKind());
        this.viewSettings.toggleLabel.attach(() => this.drawLabels());
        this.viewSettings.highlight.attach(() => this.drawHighlight());

        let fig = new Figure();
        this.kindLayer = fig.newLayer({ "stroke": "none" });
        this.highlight1Layer = fig.newLayer({ "stroke": color.highlight, "fill": color.highlight });
        this.selectionLayer = fig.newLayer({ "stroke": color.selection, "fill": color.selection });
        this.highlight2Layer = fig.newLayer({ "stroke": "none", "fill": color.highlight, "fill-opacity": "0.3" });
        this.supportLayer = fig.newLayer({ "stroke": color.support, "fill": color.support });
        this.actionLayer = fig.newLayer({ "stroke": color.action, "stroke-width": "2.5", "fill": color.action });
        this.labelLayer = fig.newLayer({ "font-family": "DejaVu Sans, sans-serif", "font-size": "8pt", "text-anchor": "middle" });
        this.interactionLayer = fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#FFF", "fill-opacity": "0" });
        this.plot = new InteractivePlot([600, 400], fig, autoProjection(6/4, ...system.extent));
        this.drawInteraction();
    }

    drawInteraction(): void {
        this.interactionLayer.shapes = this.system.states.map(state => ({
            kind: "polytope", vertices: state.polytope.vertices,
            events: {
                click: () => this.click(state),
            }
        }));
    }

    drawSelection(): void {
        if (this.selection != null) {
            this.selectionLayer.shapes = [{ kind: "polytope", vertices: this.selection.polytope.vertices }];
        } else {
            this.selectionLayer.shapes = [];
        }
    }

    drawHighlight(): void {
        let operator = this.viewSettings.highlight;
        if (this.selection != null && !(this.selection.isOutside && operator.text == "Posterior")) {
            let shapes = operator.value(this.selection).map(
                poly => ({ kind: "polytope", vertices: poly.vertices })
            );
            this.highlight1Layer.shapes = shapes;
            this.highlight2Layer.shapes = shapes;
        } else {
            this.highlight1Layer.shapes = [];
            this.highlight2Layer.shapes = [];
        }
    }

    drawKind(): void {
        let shapes = [];
        if (this.viewSettings.toggleKind.value) {
            shapes = this.system.states.map(toShape);
        }
        this.kindLayer.shapes = shapes;
    }

    drawLabels(): void {
        let labels = [];
        if (this.viewSettings.toggleLabel.value) {
            labels = this.system.states.map(state => ({
                kind: "text", coords: state.polytope.centroid, text: state.label, style: {dy: "3"}
            }));
        }
        this.labelLayer.shapes = labels;
    }

    drawAction(action: ?Action): void {
        if (action == null) {
            this.actionLayer.shapes = [];
        } else {
            let a = action;
            this.actionLayer.shapes = a.targets.map(
                target => ({ kind: "arrow", origin: a.origin.polytope.centroid, target: target.polytope.centroid })
            );
        }
    }

    click(state: State): void {
        if (this.selection != null && this.selection === state) {
            this.selection = null;
        } else {
            this.selection = state;
        }
        this.drawSelection();
        this.drawHighlight();
        this.notify();
    }

}


export class SystemSummary {

    +node: HTMLDivElement;
    +system: AbstractedLSS;

    constructor(system: AbstractedLSS): void {
        this.system = system;
        this.node = document.createElement("div");
        this.node.className = "summary"
        this.changeHandler();
    }

    changeHandler() {
        clearNode(this.node);
        appendChild(this.node,
            createElement("p", {}, [this.system.states.length + " states"]),
            createElement("p", {"class": "undecided"}, [this.system.states.filter(s => s.kind == 0).length + " undecided"]),
            createElement("p", {"class": "satisfying"}, [this.system.states.filter(s => s.kind > 0).length + " satisfying"]),
            createElement("p", {"class": "nonsatisfying"}, [this.system.states.filter(s => s.kind < 0).length + " non-satisfying"]),
            createElement("p", {}, [this.system.states.map(s => s.actions.length).reduce((x, y) => x + y, 0) + " actions"])
        )
    }

}


export class StateView {

    +node: Element;
    +systemView: SystemView;
    +view: AxesPlot;
    +viewLayer: FigureLayer;
    +summary: Element;

    constructor(systemView: SystemView): void {
        this.systemView = systemView;
        this.systemView.attach(() => this.changeHandler());

        let fig = new Figure();
        this.viewLayer = fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#069" });
        this.view = new AxesPlot([90, 90], fig, autoProjection(1));
        this.summary = createElement("div", { "class": "summary" });

        this.node = createElement("div", { "class": "selection" }, [this.view.node, this.summary]);
        this.changeHandler();
    }

    changeHandler() {
        clearNode(this.summary);
        let state = this.systemView.selection;
        if (state != null) {
            this.view.projection = autoProjection(1, ...state.polytope.extent);
            this.viewLayer.shapes = [{ kind: "polytope", "vertices": state.polytope.vertices }];
            appendChild(this.summary,
                toSummaryLine(state),
                createElement("p", {}, [state.actions.length + " actions"])
            );
        } else {
            this.view.projection = autoProjection(1);
            this.viewLayer.shapes = [];
            appendChild(this.summary, createElement("p", {}, ["nothing selected"]));
        }
    }

}


export class ControlView {

    +node: Element;
    +controlSpace: ConvexPolytopeUnion;
    +actionLayer: FigureLayer;

    constructor(system: AbstractedLSS): void {
        this.controlSpace = system.controlSpace;
        let fig = new Figure();
        this.actionLayer = fig.newLayer({ "stroke": color.action, "fill": color.action });
        let layer = fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#FFF", "fill-opacity": "0" });
        layer.shapes = this.controlSpace.map(u => ({ kind: "polytope", vertices: u.vertices }));
        let view = new AxesPlot([90, 90], fig, autoProjection(1, ...union.extent(this.controlSpace)));
        this.node = createElement("div", {}, [view.node]);
    }

    drawAction(action: ?Action): void {
        if (action == null) {
            this.actionLayer.shapes = [];
        } else {
            this.actionLayer.shapes = action.controls.map(
                poly => ({ kind: "polytope", vertices: poly.vertices })
            );
        }
    }

}


export class ActionsView {

    +node: Element;
    +systemView: SystemView;
    +controlView: ControlView;

    constructor(systemView: SystemView, controlView: ControlView): void {
        this.systemView = systemView;
        this.systemView.attach(() => this.changeHandler());
        this.controlView = controlView;
        this.node = createElement("div", { "class": "actions" }, []);
    }

    changeHandler(): void {
        this.clear();
        let state = this.systemView.selection;
        if (state != null && state.actions.length > 0) {
            let nodes = state.actions.map(action => {
                let targets = [];
                for (let t of action.targets) {
                    let attrs = {};
                    if (t === state) {
                        attrs["class"] = "selected";
                    } else if (t.isSatisfying) {
                        attrs["class"] = "satisfying";
                    } else if (t.isNonSatisfying) {
                        attrs["class"] = "nonsatisfying";
                    }
                    targets.push(createElement("span", attrs, [t.label]));
                    targets.push(", ");
                }
                targets.pop();
                let node = createElement("div", {}, [
                    createElement("span", { "class": "selected" }, [action.origin.label]),
                    " → {", ...targets, "}"
                ]);
                node.addEventListener("mouseover", () => this.draw(action));
                node.addEventListener("mouseout", () => this.clear())
                return node;
            });
            clearNode(this.node);
            appendChild(this.node, ...nodes);
        } else {
            this.node.innerHTML = "none";
        }
    }

    draw(action: Action): void {
        this.systemView.drawAction(action);
        this.controlView.drawAction(action);
    }

    clear(): void {
        this.systemView.drawAction(null);
        this.controlView.drawAction(null);
    }

}

