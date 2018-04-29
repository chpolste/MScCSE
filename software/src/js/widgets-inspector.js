// @flow
"use strict";

// Widgets here take other inputs as dimension/shape args, to allow change

import type { ConvexPolytope, ConvexPolytopeUnion, Halfspace } from "./geometry.js";
import type { Action, ActionSupport } from "./system.js";
import type { LayeredFigure, FigureLayer, Shape } from "./figure.js";
import type { Plot } from "./widgets-plot.js";
import type { Input } from "./widgets-input.js";

import { ObservableMixin } from "./tools.js";
import { clearNode, appendChild, createElement } from "./domtools.js";
import { HalfspaceInequation, polytopeType, union } from "./geometry.js";
import { Figure, autoProjection } from "./figure.js";
import { InteractivePlot, AxesPlot } from "./widgets-plot.js";
import { ValidationError, CheckboxInput, SelectInput, MultiLineInput, MatrixInput,
         SelectableNodes } from "./widgets-input.js";
import { LSS, AbstractedLSS, State } from "./system.js";


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
    let cls = "undecided";
    let name = "undecided";
    if (state.isSatisfying) {
        cls = name = "satisfying"
    } else if (state.isNonSatisfying) {
        cls = name = "non-satisfying"
        if (state.isOutside) {
            name = name + "/outer";
        }
    }
    return createElement("p", { "class": cls.replace("-", "") }, [name]);
}

export function styledStateLabel(state: State, markSelected?: ?State): Element {
    let attributes = {};
    if (markSelected != null && markSelected === state) {
        attributes["class"] = "selected";
    } else if (state.isSatisfying) {
        attributes["class"] = "satisfying";
    } else if (state.isNonSatisfying) {
        attributes["class"] = "nonsatisfying";
    }
    return createElement("span", attributes, [state.label]);
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

// Input of Matrix A and B of LSS that adapts to dimensions selection.
// Recognize non-NaN numeric entries.
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


// Input of a convex polytope in H-representation (predicates as linear
// inequations) with a preview. Validation adapts to external dimensions
// selection.
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


// Input of predicates (as linear inequations) that define the initial state
// partition. Predicates can be labeled for use in objective specification.
// Validation adapts to external dimensions selection.
export class PredicatesInput extends ObservableMixin<null> implements Input<Halfspace[]> {

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

    get value(): Halfspace[] {
        return this.predicates.value;
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

// Settings panel for the main view.
export class SystemViewSettings extends ObservableMixin<null> {

    +node: Element;
    +toggleKind: Input<boolean>;
    +toggleLabel: Input<boolean>;
    +highlight: Input<ClickOperatorWrapper>;
    
    constructor(system: AbstractedLSS): void {
        super();
        this.toggleKind = new CheckboxInput(false);
        this.toggleLabel = new CheckboxInput(false);

        const lss = system.lss;
        this.highlight = new SelectInput({
            "None": state => [],
            "Posterior": state => state.post(lss.controlSpace),
            "Predecessor": state => lss.pre(lss.stateSpace, lss.controlSpace, [state.polytope]),
            "Robust Predecessor": state => lss.preR(lss.stateSpace, lss.controlSpace, [state.polytope]),
            "Attractor": state => lss.attr(lss.stateSpace, lss.controlSpace, [state.polytope]),
            "Robust Attractor": state => lss.attrR(lss.stateSpace, lss.controlSpace, [state.polytope])
        }, "None");

        this.node = createElement("div", { "class": "summary" }, [
            createElement("label", {}, [this.toggleKind.node, "state kind colors"]),
            createElement("label", {}, [this.toggleLabel.node, "state labels"]),
            createElement("p", { "class": "posterior" }, ["Highlight operator:"]),
            createElement("p", {}, [this.highlight.node])
        ]);
    }

}

// Main view of the inspector: shows the abstracted LSS and lets user select
// states. Has layers for displaying subsets (polytopic operators, action
// supports) and state information (selection, labels, kinds). Observes:
//      SystemViewSettings  -> general display settings
//      StateView           -> currently selected state
//      ActionView          -> currently selected action
//      ActionSupportView   -> currently selected action support
// Closes the information flow loop by acting as a controller for the StateView
// (state selection).
export class SystemView {

    +system: AbstractedLSS;
    +settings: SystemViewSettings;
    +stateView: StateView;
    +actionView: ActionView;
    +actionSupportView: ActionSupportView;
    +plot: Plot;
    +layers: { [string]: FigureLayer };

    constructor(system: AbstractedLSS, settings: SystemViewSettings, stateView: StateView,
                actionView: ActionView, actionSupportView: ActionSupportView): void {
        this.system = system;

        this.settings = settings;
        this.settings.toggleKind.attach(() => this.drawKind());
        this.settings.toggleLabel.attach(() => this.drawLabels());
        this.settings.highlight.attach(() => this.drawHighlight());

        this.stateView = stateView;
        this.stateView.attach(() => {
            this.drawSelection();
            this.drawHighlight();
        });
        this.actionView = actionView;
        this.actionView.attach(() => this.drawAction());
        this.actionSupportView = actionSupportView;
        this.actionSupportView.attach(() => this.drawActionSupport());

        let fig = new Figure();
        this.layers = {
            kind:           fig.newLayer({ "stroke": "none" }),
            highlight1:     fig.newLayer({ "stroke": color.highlight, "fill": color.highlight }),
            selection:      fig.newLayer({ "stroke": color.selection, "fill": color.selection }),
            highlight2:     fig.newLayer({ "stroke": "none", "fill": color.highlight, "fill-opacity": "0.2" }),
            support:        fig.newLayer({ "stroke": color.support, "fill": color.support }),
            action:         fig.newLayer({ "stroke": color.action, "stroke-width": "2.5", "fill": color.action }),
            label:          fig.newLayer({ "font-family": "DejaVu Sans, sans-serif", "font-size": "8pt", "text-anchor": "middle" }),
            interaction:    fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#FFF", "fill-opacity": "0" })
        };
        this.plot = new InteractivePlot([630, 420], fig, autoProjection(6/4, ...system.extent));

        this.drawInteraction();
    }

    drawInteraction(): void {
        this.layers.interaction.shapes = this.system.states.map(state => ({
            kind: "polytope", vertices: state.polytope.vertices,
            events: {
                "click": () => {
                    this.stateView.selection = this.stateView.selection === state ? null : state;
                }
            }
        }));
    }

    drawHighlight(): void {
        let operator = this.settings.highlight;
        let selection = this.stateView.selection;
        if (selection != null && !(selection.isOutside && operator.text == "Posterior")) {
            let shapes = operator.value(selection).map(
                poly => ({ kind: "polytope", vertices: poly.vertices })
            );
            this.layers.highlight1.shapes = shapes;
            this.layers.highlight2.shapes = shapes;
        } else {
            this.layers.highlight1.shapes = [];
            this.layers.highlight2.shapes = [];
        }
    }

    drawKind(): void {
        let shapes = [];
        if (this.settings.toggleKind.value) {
            shapes = this.system.states.map(toShape);
        }
        this.layers.kind.shapes = shapes;
    }

    drawLabels(): void {
        let labels = [];
        if (this.settings.toggleLabel.value) {
            labels = this.system.states.map(state => ({
                kind: "text", coords: state.polytope.centroid, text: state.label, style: {dy: "3"}
            }));
        }
        this.layers.label.shapes = labels;
    }

    drawSelection(): void {
        let state = this.stateView.selection;
        if (state == null) {
            this.layers.selection.shapes = [];
        } else {
            this.layers.selection.shapes = [{ kind: "polytope", vertices: state.polytope.vertices }];
        }
    }

    drawAction(): void {
        const action = this.actionView.hoverSelection == null
                     ? this.actionView.selection
                     : this.actionView.hoverSelection;
        if (action == null) {
            this.layers.action.shapes = [];
        } else {
            this.layers.action.shapes = action.targets.map(
                target => ({
                    kind: "arrow",
                    origin: action.origin.polytope.centroid,
                    target: target.polytope.centroid
                })
            );
        }
    }

    drawActionSupport(): void {
        const support = this.actionSupportView.hoverSelection == null
                      ? this.actionSupportView.selection
                      : this.actionSupportView.hoverSelection;
        if (support == null) {
            this.layers.support.shapes = [];
            this.drawAction();
        } else {
            this.layers.action.shapes = support.targets.map(
                target => ({
                    kind: "arrow",
                    origin: support.action.origin.polytope.centroid,
                    target: target.polytope.centroid
                })
            );
            this.layers.support.shapes = support.origins.map(
                origin => ({ kind: "polytope", vertices: origin.vertices })
            );
        }
    }

}


// Textual summary of system information.
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
            createElement("p", {}, [this.system.states.length + " states:"]),
            createElement("p", {"class": "undecided"}, [this.system.states.filter(s => s.kind == 0).length + " undecided"]),
            createElement("p", {"class": "satisfying"}, [this.system.states.filter(s => s.kind > 0).length + " satisfying"]),
            createElement("p", {"class": "nonsatisfying"}, [this.system.states.filter(s => s.kind < 0).length + " non-satisfying"])
        )
    }

}


// Contains and provides Information on and preview of the currently selected
// state.
export class StateView extends ObservableMixin<null> {

    +node: Element;
    +view: AxesPlot;
    +viewLayer: FigureLayer;
    +summary: Element;
    _selection: ?State;

    constructor(): void {
        super();

        let fig = new Figure();
        this.viewLayer = fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#069" });
        this.view = new AxesPlot([90, 90], fig, autoProjection(1));
        this.summary = createElement("div", { "class": "summary" });

        this.node = createElement("div", { "class": "selection" }, [this.view.node, this.summary]);
        this.changeHandler();
    }

    get selection(): ?State {
        return this._selection;
    }

    set selection(state: ?State): void {
        this._selection = state;
        this.changeHandler();
    }

    changeHandler() {
        clearNode(this.summary);
        let state = this._selection;
        if (state != null) {
            this.view.projection = autoProjection(1, ...state.polytope.extent);
            this.viewLayer.shapes = [{ kind: "polytope", "vertices": state.polytope.vertices }];
            appendChild(this.summary,
                createElement("p", {}, [state.label]),
                toSummaryLine(state),
                createElement("p", {}, [state.actions.length + " actions"])
            );
        } else {
            this.view.projection = autoProjection(1);
            this.viewLayer.shapes = [];
            appendChild(this.summary, createElement("p", {}, ["no state selected"]));
        }
        this.notify();
    }

}


// Lists actions available for the selected state and contains the currently
// selected action. Observes StateView for the currently selected state.
export class ActionView extends SelectableNodes<Action> {

    +stateView: StateView;

    constructor(stateView: StateView): void {
        super(action => ActionView.toNode(action), "none");

        this.stateView = stateView;
        this.stateView.attach(() => this.changeHandler());
    }

    changeHandler(): void {
        const state = this.stateView.selection;
        this.items = state == null ? [] : state.actions;
    }

    static toNode(action: Action): Element {
        let labels = [styledStateLabel(action.origin, action.origin), " → {"];
        for (let target of action.targets) {
            labels.push(styledStateLabel(target, action.origin));
            labels.push(", ");
        }
        labels[labels.length - 1] = "}";
        return createElement("div", {}, labels);
    }

}


// Lists actions supports available for the selected action and contains the
// currently selected action support. Observes ActionView for the currently
// selected action.
export class ActionSupportView extends SelectableNodes<ActionSupport> {
    
    +actionView: ActionView;

    constructor(actionView: ActionView): void {
        super(support => ActionSupportView.toNode(support), "none");
        this.actionView = actionView;
        this.actionView.attach(wasClick => {
            if (wasClick) this.changeHandler();
        });
    }

    changeHandler(): void {
        const action = this.actionView.selection;
        this.items = action == null ? [] : action.supports;
    }

    static toNode(support: ActionSupport): Element {
        let labels = ["{"];
        for (let target of support.targets) {
            labels.push(styledStateLabel(target, support.action.origin));
            labels.push(", ");
        }
        labels[labels.length - 1] = "}";
        return createElement("div", {}, labels);
    }

}


// Information on and preview of the control space. Observes ActionView to
// display the control subset of the currently selected action.
export class ControlView {

    +node: Element;
    +controlSpace: ConvexPolytopeUnion;
    +actionView: ActionView;
    +actionLayer: FigureLayer;

    constructor(controlSpace: ConvexPolytopeUnion, actionView: ActionView): void {
        this.controlSpace = controlSpace;
        this.actionView = actionView;
        this.actionView.attach(() => this.drawAction());

        let fig = new Figure();
        this.actionLayer = fig.newLayer({ "stroke": color.action, "fill": color.action });
        let layer = fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#FFF", "fill-opacity": "0" });
        layer.shapes = this.controlSpace.map(u => ({ kind: "polytope", vertices: u.vertices }));
        let view = new AxesPlot([90, 90], fig, autoProjection(1, ...union.extent(this.controlSpace)));

        this.node = createElement("div", {}, [view.node]);
    }

    drawAction(): void {
        let action = this.actionView.selection;
        if (action == null) {
            this.actionLayer.shapes = [];
        } else {
            this.actionLayer.shapes = action.controls.map(
                poly => ({ kind: "polytope", vertices: poly.vertices })
            );
        }
    }

}

