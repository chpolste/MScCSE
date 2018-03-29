// @flow
"use strict";

// Widgets here take other inputs as dimension/shape args, to allow change

import type { ConvexPolytope, ConvexPolytopeUnion, Halfspace } from "./geometry.js";
import type { Decomposition } from "./lss.js";
import type { LayeredFigure, FigureLayer, Shape } from "./figure.js";
import type { Plot } from "./widgets-plot.js";
import type { Input } from "./widgets-input.js";

import { ObservableMixin } from "./tools.js";
import { clearNode, appendChild, createElement } from "./domtools.js";
import { HalfspaceInequation, polytopeType } from "./geometry.js";
import { Figure, autoProjection } from "./figure.js";
import { InteractivePlot, AxesPlot } from "./widgets-plot.js";
import { ValidationError, CheckboxInput, SelectInput, MultiLineInput, MatrixInput } from "./widgets-input.js";
import { LSS, State, SplitWithSatisfyingPredicates } from "./lss.js";


const VAR_NAMES = "xy";

export const color = {
    satisfying: "#093",
    nonSatisfying: "#CCC",
    undecided: "#FFF",
    selection: "#069",
    clickOperator: "#FC0",
    hoverOperator: "#09C",
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
            createElement("p", {}, ["Split with satisfying predicate(s):"]),
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

export class SystemView extends ObservableMixin<null> {

    +lss: LSS;
    +controlNode: Element;
    +toggleKind: Input<boolean>;
    +togglePost: Input<boolean>;
    +clickOperator: Input<ClickOperatorWrapper>;
    +hoverOperator: Input<HoverOperatorWrapper>
    +plot: Plot;
    +kindLayer: FigureLayer;
    +clickOperatorLayer: FigureLayer;
    +selectionLayer: FigureLayer;
    +hoverOperatorLayer: FigureLayer;
    +interactionLayer: FigureLayer;
    selection: ?State;

    constructor(lss: LSS): void {
        super();
        this.lss = lss;
        this.selection = null;

        this.toggleKind = new CheckboxInput(false);
        this.toggleKind.attach(() => this.drawKind());
        this.clickOperator = new SelectInput({
            "None": state => [],
            "Posterior": state => [state.post(this.lss.controlSpace)],
            "Predecessor": state => this.lss.pre(this.lss.stateSpace, this.lss.controlSpace, state.polytope),
            "Robust Predecessor": state => this.lss.preR(this.lss.stateSpace, this.lss.controlSpace, state.polytope),
            "Attractor": state => this.lss.attr(this.lss.stateSpace, this.lss.controlSpace, state.polytope),
            "Robust Attractor": state => this.lss.attrR(this.lss.stateSpace, this.lss.controlSpace, state.polytope)
        }, "Posterior");
        this.clickOperator.attach(() => this.drawClickOperator());
        this.hoverOperator = new SelectInput({
            "None": (origin, target) => [],
            "Predecessor": (origin, target) => origin.pre(this.lss.controlSpace, target),
            "Robust Predecessor": (origin, target) => origin.preR(this.lss.controlSpace, target), 
            "Attractor": (origin, target) => origin.attr(this.lss.controlSpace, target), 
            "Robust Attractor": (origin, target) => origin.attrR(this.lss.controlSpace, target), 
        }, "Predecessor"); // TODO: adjust default
        this.controlNode = createElement("div", { "class": "summary" }, [
            createElement("label", {}, [this.toggleKind.node, "Color state kind"]),
            createElement("p", { "class": "posterior" }, ["Highlight operator:"]),
            createElement("p", {}, [this.clickOperator.node]),
            createElement("p", { "class": "operator" }, ["Mouseover operator:"]),
            createElement("p", {}, [this.hoverOperator.node])
        ]);

        let fig = new Figure();
        this.kindLayer = fig.newLayer({ "stroke": "none" });
        this.clickOperatorLayer = fig.newLayer({ "stroke": color.clickOperator, "fill": color.clickOperator });
        this.selectionLayer = fig.newLayer({ "stroke": color.selection, "fill": color.selection });
        this.hoverOperatorLayer = fig.newLayer({ "stroke": color.hoverOperator, "fill": color.hoverOperator });
        this.interactionLayer = fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#FFF", "fill-opacity": "0" });
        this.plot = new InteractivePlot([600, 400], fig, autoProjection(6/4, ...lss.extent));
        this.drawInteraction();
    }

    drawInteraction(): void {
        this.interactionLayer.shapes = this.lss.states.map(state => ({
            kind: "polytope", vertices: state.polytope.vertices,
            events: {
                click: () => this.click(state),
                mouseout: () => this.mouseout(state),
                mouseover: () => this.mouseover(state)
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

    drawClickOperator(): void {
        if (this.selection != null && !(this.selection.isOutside && this.clickOperator.text == "Posterior")) {
            this.clickOperatorLayer.shapes = this.clickOperator.value(this.selection).map(
                poly => ({ kind: "polytope", vertices: poly.vertices })
            );
        } else {
            this.clickOperatorLayer.shapes = [];
        }
    }

    drawKind(): void {
        let shapes = [];
        if (this.toggleKind.value) {
            shapes = this.lss.states.map(toShape);
        }
        this.kindLayer.shapes = shapes;
    }

    click(state: State): void {
        if (this.selection != null && this.selection === state) {
            this.selection = null;
        } else {
            this.selection = state;
        }
        this.drawSelection();
        this.drawClickOperator();
        this.hoverOperatorLayer.shapes = [];
        this.mouseover(state);
        this.notify();
    }

    mouseover(state: State): void {
        if (this.selection != null && !this.selection.isOutside) {
            this.hoverOperatorLayer.shapes = this.hoverOperator.value(this.selection, state).map(
                poly => ({ kind: "polytope", vertices: poly.vertices })
            );
        }
    }

    mouseout(state: State): void {
        this.hoverOperatorLayer.shapes = [];
    }

}


export class SystemSummary {

    +node: HTMLDivElement;
    +lss: LSS;

    constructor(lss: LSS): void {
        this.lss = lss;
        this.node = document.createElement("div");
        this.node.className = "summary"
        this.changeHandler();
    }

    changeHandler() {
        clearNode(this.node);
        appendChild(this.node,
            createElement("p", {}, [this.lss.states.length + " states"]),
            createElement("p", {"class": "undecided"}, [this.lss.states.filter(s => s.kind == 0).length + " undecided"]),
            createElement("p", {"class": "satisfying"}, [this.lss.states.filter(s => s.kind > 0).length + " satisfying"]),
            createElement("p", {"class": "nonsatisfying"}, [this.lss.states.filter(s => s.kind < 0).length + " non-satisfying"]),
        )
    }

}




export class StateSummary {

    +node: Element;
    +view: AxesPlot;
    +viewLayer: FigureLayer;
    +summary: Element;
    _state: ?State;
    state: ?State;

    constructor(state?: State): void {
        this._state = state;

        let fig = new Figure();
        this.viewLayer = fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#069" });
        this.view = new AxesPlot([90, 90], fig, autoProjection(1));
        this.summary = createElement("div", { "class": "summary" });

        this.node = createElement("div", { "class": "selection" }, [this.view.node, this.summary]);
        this.changeHandler();
    }

    get state(): ?State {
        return this._state;
    }

    set state(state: ?State) {
        this._state = state;
        this.changeHandler();
    }

    changeHandler() {
        clearNode(this.summary);
        if (this._state != null) {
            let state = this._state;
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


export class ControlSummary {

    +node: Element;

    constructor(space: ConvexPolytope): void {
        let fig = new Figure();
        let layer = fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#FFF" });
        layer.shapes = [{ kind: "polytope", "vertices": space.vertices }];
        let view = new AxesPlot([90, 90], fig, autoProjection(1, ...space.extent));
        this.node = createElement("div", {}, [view.node]);
    }

}

