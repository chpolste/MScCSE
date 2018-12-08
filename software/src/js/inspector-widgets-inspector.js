// @flow
"use strict";

import type { FigureLayer, Shape } from "./figure.js";
import type { AnalysisResults, AnalysisResult } from "./game.js";
import type { Halfspace, JSONUnion } from "./geometry.js";
import type { StateData, StateDataPlus, ActionData, SupportData, OperatorData, TraceData,
              GameGraphData, ProcessAnalysisData, RefineData, TakeSnapshotData, LoadSnapshotData,
              NameSnapshotData, SnapshotData } from "./inspector-worker-system.js";
import type { Vector, Matrix } from "./linalg.js";
import type { AutomatonShapeCollection } from "./logic.js";
import type { JSONPolygonItem } from "./plotter-2d.js";
import type { AbstractedLSS, LSS, StateID, ActionID, PredicateID } from "./system.js";
import type { Observer } from "./tools.js";
import type { Plot } from "./widgets-plot.js";
import type { Input } from "./widgets-input.js";

import * as dom from "./dom.js";
import { Figure, autoProjection, Horizontal1D } from "./figure.js";
import * as linalg from "./linalg.js";
import { Objective, stringifyProposition, texifyProposition } from "./logic.js";
import { iter, arr, obj, sets, n2s, t2s, replaceAll, ObservableMixin } from "./tools.js";
import { CheckboxInput, SelectInput, SelectableNodes, inputTextRotation } from "./widgets-input.js";
import { InteractivePlot, AxesPlot, ShapePlot } from "./widgets-plot.js";
import { Communicator } from "./worker.js";


// Variable names for space dimensions
export const VAR_NAMES = "xy";

// Visualization/highlight colors
export const COLORS = {
    yes: "#093",
    no: "#CCC",
    maybe: "#FFF",
    unreachable: "#C99",
    selection: "#069",
    highlight: "#FC0",
    support: "#09C",
    action: "#000",
    predicate: "#000",
    split: "#C00",
    vectorField: "#333",
    trace: "#000"
};

// Arrow style of trace highlight
const MARKED_STEP_STYLE = { "stroke": "#C00", "fill": "#C00" };
// Max number of steps when sampling
export const TRACE_LENGTH = 35;

function analysisKind(q: string, analysis: ?AnalysisResult): string {
    // If no analysis results are available, everything is undecided
    if (analysis == null || analysis.maybe.has(q)) {
        return "maybe";
    } else if (analysis.yes.has(q)) {
        return "yes";
    } else if (analysis.no.has(q)) {
        return "no";
    } else {
        return "unreachable";
    }
}

// Simple coloring of states
function stateColorSimple(state: StateData): string {
    return state.isOuter ? COLORS.no : COLORS.maybe;
}

// State coloring according to analysis status
function stateColor(state: StateData, wrtQ: string): string {
    return COLORS[analysisKind(wrtQ, state.analysis)];
}

// Display text corresponding to state kind
function stateKindString(state: StateData): string {
    //if (State.isSatisfying(state)) {
    //    return "satisfying";
    //} else if (State.isOuter(state)) {
    //    return "outer";
    //} else if (State.isNonSatisfying(state)) {
    //    return "non-satisfying";
    //} else {
        return "undecided";
    //} TODO
}

function stateLabel(state: StateData, mark?: ?StateData): HTMLSpanElement {
    const out = dom.snLabel.toHTML(state.label);
    if (mark != null && mark.label === state.label) {
        out.className = "selected";
    }
    return out;
}

function automatonLabel(label: string, ana?: ?AnalysisResult): HTMLSpanElement {
    const out = dom.snLabel.toHTML(label);
    out.className = analysisKind(label, ana);
    return out;
}

function actionCount(): HTMLSpanElement {
    throw new Error();
}

// String representation of halfspace inequation
function ineq2s(h: Halfspace): string {
    const terms = [];
    for (let i = 0; i < h.dim; i++) {
        if (h.normal[i] === 0) {
            continue
        } else if (h.normal[i] < 0) {
            terms.push("-");
        } else if (terms.length > 0) {
            terms.push("+");
        }
        if (h.normal[i] !== 1 && h.normal[i] !== -1) {
            terms.push(n2s(Math.abs(h.normal[i])));
        }
        terms.push(VAR_NAMES[i]);
    }
    return  terms.join(" ") + " < " + n2s(h.offset)
}

// Predicate label with inequation as title text
function predicateLabel(label: string, halfspace: Halfspace): HTMLSpanElement {
    const out = dom.snLabel.toHTML(label);
    out.title = ineq2s(halfspace);
    return out;
}

// Matrix display with KaTeX
function matrixToTeX(m: Matrix): string {
    return "\\begin{pmatrix}" + m.map(row => row.join("&")).join("\\\\") + "\\end{pmatrix}";
}

// Graphical depiction of analysis progress
function percentageBar(ratios: { [string]: number }): HTMLDivElement {
    const bar = dom.DIV({ "class": "percentage-bar" });
    for (let name in ratios) {
        bar.appendChild(dom.DIV({
            "class": name,
            "title": (ratios[name] * 100).toFixed(1) + "% " + name,
            "style": "flex-grow:" + ratios[name]
        }));
    }
    return bar;
}



export class ProblemSummary {

    +node: HTMLDivElement;

    constructor(system: AbstractedLSS, objective: Objective): void {
        const csFig = new Figure();
        csFig.newLayer({ stroke: "#000", fill: "#EEE" }).shapes = system.lss.uus.polytopes.map(
            u => ({ kind: "polytope", vertices: u.vertices })
        );
        const rsFig = new Figure();
        rsFig.newLayer({ stroke: "#000", fill: "#EEE" }).shapes = [
            { kind: "polytope", vertices: system.lss.ww.vertices }
        ];
        const ssFig = new Figure();
        ssFig.newLayer({ stroke: "#000", fill: "#EEE" }).shapes = [
            { kind: "polytope", vertices: system.lss.xx.vertices }
        ];
        const cs = new AxesPlot([90, 90], csFig, autoProjection(1, ...system.lss.uus.extent));
        const rs = new AxesPlot([90, 90], rsFig, autoProjection(1, ...system.lss.ww.extent));
        const ss = new AxesPlot([90, 90], ssFig, autoProjection(1, ...system.lss.xx.extent));
        let formula = objective.kind.formula;
        for (let [symbol, prop] of objective.propositions) {
            formula = replaceAll(formula, symbol, "(" + texifyProposition(prop, dom.snLabel.toTeX) + ")");
        }
        this.node = dom.DIV({ "id": "problem-summary" }, [
            dom.renderTeX("x_{t+1} = " + matrixToTeX(system.lss.A) + " x_t + " + matrixToTeX(system.lss.B) + " u_t + w_t", dom.P()),
            dom.DIV({ "class": "boxes" }, [
                dom.DIV({}, [dom.H3({}, ["Control Space Polytope"]), cs.node]),
                dom.DIV({}, [dom.H3({}, ["Random Space Polytope"]), rs.node]),
                dom.DIV({}, [dom.H3({}, ["State Space Polytope"]), ss.node]),
                dom.DIV({}, [
                    dom.H3({}, ["Labeled Predicates"]),
                    ...Array.from(system.predicates.entries()).map(
                        ([label, halfspace]) => dom.renderTeX(dom.snLabel.toTeX(label) + ": " + ineq2s(halfspace), dom.P())
                    )
                ])
            ]),
            dom.DIV({}, [
                dom.H3({}, ["Objective"]),
                dom.renderTeX(formula, dom.P()),
                dom.P({}, [
                    objective.kind.name,
                    objective.coSafeInterpretation ? " (co-safe)" : ""
                ])
            ])
        ]);
    }

}



export class SystemInspector {

    +node: HTMLDivElement;
    +tabs: TabbedView;
    // ...
    +objective: Objective;
    +_system: AbstractedLSS;

    constructor(system: AbstractedLSS, objective: Objective, keys: dom.Keybindings) {
        const log = new Log();
        const model = new SystemModel(system, objective, log);
        // Main
        const systemViewCtrl = new SystemViewCtrl(model);
        const systemViewCtrlCtrl = new SystemViewCtrlCtrl(systemViewCtrl, keys);
        const randomSpaceView = new RandomSpaceView(model);
        const controlSpaceView = new ControlSpaceView(model);
        const automatonViewCtrl = new AutomatonViewCtrl(model);
        // Game
        const stateView = new StateView(model);
        const actionViewCtrl = new ActionViewCtrl(model);
        // System
        const analysisCtrl = new AnalysisCtrl(model, keys);
        const refinementCtrl = new RefinementCtrl(model, keys);
        const snapshotViewCtrl = new SnapshotViewCtrl(model);
        // Strategy
        const traceViewCtrl = new TraceViewCtrl(model, keys);

        // Debug: connectivity
        const appLinks = dom.P();
        // Link that opens polytopic calculator with basic problem setup loaded
        const calcData = {
            "A": JSON.stringify(system.lss.A),
            "B": JSON.stringify(system.lss.B),
            "X": JSON.stringify(system.lss.xx.vertices),
            "U": JSON.stringify(system.lss.uus.polytopes[0].vertices),
            "Y": "",
            "W": JSON.stringify(system.lss.ww.vertices)
        };
        dom.appendChildren(appLinks, [
            dom.A({ "href": "polytopic-calculator.html#" + window.btoa(JSON.stringify(calcData)), "target": "_blank" }, ["Polytopic Calculator"])
        ]);
        // Link that opens view in plotter-2d if dimension matches
        if (system.lss.dim === 2) {
            const plotterLink = dom.A({ "href": "plotter-2d.html", "target": "_blank" }, ["Plotter 2D"]);
            plotterLink.addEventListener("click", () => {
                plotterLink.href = "plotter-2d.html#"// TODO + lssViewCtrl.toExportURL();
            });
            dom.appendChildren(appLinks, [" :: ", plotterLink]);
        }

        this.tabs = new TabbedView({
            "Game": [
                dom.H3({}, ["Selection", dom.infoBox("info-state")]),
                stateView.node,
                dom.H3({}, ["Actions", dom.infoBox("info-actions")]),
                actionViewCtrl.node
            ],
            "System": [
                dom.H3({}, ["System Analysis", dom.infoBox("info-analysis")]),
                analysisCtrl.node,
                dom.H3({}, ["Abstraction Refinement", dom.infoBox("info-refinement")]),
                refinementCtrl.node,
                dom.H3({}, ["Snapshots", dom.infoBox("info-snapshots")]),
                snapshotViewCtrl.node
            ],
            "Objective": [
                dom.H3({}, ["Trace Sample", dom.infoBox("info-trace")]),
                traceViewCtrl.node
            ],
            "Debug": [
                dom.H3({}, ["Connectivity"]),
                appLinks,
                dom.H3({}, ["Error Message"]),
                log.node
            ]
        }, "System");

        this.node = dom.DIV({ "id": "inspector" }, [
            dom.DIV({ "class": "left" }, [
                systemViewCtrl.node,
                dom.DIV({"class": "cols"}, [
                    dom.DIV({ "class": "left" }, [
                        dom.H3({}, ["Control and Random Space", dom.infoBox("info-control")]),
                        controlSpaceView.node, randomSpaceView.node,
                        dom.H3({}, ["View Settings", dom.infoBox("info-settings")]),
                        systemViewCtrlCtrl.node
                    ]),
                    dom.DIV({ "class": "right" }, [
                        dom.H3({}, ["Objective Automaton", dom.infoBox("info-automaton")]),
                        automatonViewCtrl.node
                    ])
                ])
            ]),
            this.tabs.node
        ]);
    }

}


class Log {

    +node: HTMLDivElement;

    constructor(): void {
        this.node = dom.DIV({ "id": "log-view" }, ["-"]);
    }

    log(text: string): void {
        dom.replaceChildren(this.node, [text]);
    }

    logError(e: { name: string, message: string }): void {
        console.log(e);
        this.log(e.name + " :: " + e.message);
    }

}


type ModelChange = "state" | "action" | "support" | "trace" | "system" | "snapshot"; 
// ...
class SystemModel extends ObservableMixin<ModelChange> {

    +_comm: Communicator<Worker>;
    +log: Log;
    +objective: Objective;
    +qAll: Set<string>;
    // ...
    _system: AbstractedLSS;
    _xState: ?StateDataPlus;
    _qState: string;
    _action: ?ActionData;
    _support: ?SupportData;
    _trace: ?TraceData;

    constructor(system: AbstractedLSS, objective: Objective, log: Log): void {
        super();
        this.log = log;
        // System worker setup
        try {
            this._comm = new Communicator("ISYS");
            this._comm.onRequest("init", (data) => system.serialize());
            this._comm.onRequest("ready", (data) => {
                this.notify("snapshot");
                this.notify("system");
            });
            const worker = new Worker("./js/inspector-worker-system.js");
            worker.onerror = () => {
                this.log.logError({ name: "WorkerError", message: "unable to start system worker" });
            };
            this._comm.host = worker;
        } catch (e) {
            // TODO worker error handling as in AnalysisCtrl
            // Chrome does not allow Web Workers for local resources
            if (e.name === "SecurityError") {
                this.log.logError(e);
                return;
            }
            throw e;
        }
        // TODO
        this._system = system;
        this.objective = objective;
        this.qAll = sets.map(_ => _.label, objective.automaton.states.values());
        // ...
        this._xState = null;
        this._qState = objective.automaton.initialState.label;
        this._action = null;
        this._support = null;
        this._trace = null;
        // ...
        this.notify("system");
    }

    // ...TODO

    get state(): [?StateDataPlus, string] {
        return [this._xState, this._qState];
    }

    set xState(x: ?StateDataPlus): void {
        this._xState = x;
        this.notify("state");
    }

    set qState(q: string): void {
        this._qState = q;
        this.notify("state");
    }

    get action(): ?ActionData {
        return this._action;
    }

    set action(a: ?ActionData): void {
        this._action = a;
        this.notify("action");
    }

    get support(): ?SupportData {
        return this._support;
    }

    set support(s: ?SupportData): void {
        this._support = s;
        this.notify("support");
    }

    get trace(): ?TraceData {
        return this._trace;
    }

    set trace(t: ?TraceData): void {
        this._trace = t;
        this.notify("trace");
    }

    // Static information from the system

    get lss(): LSS {
        return this._system.lss;
    }

    getPredicate(label: PredicateID): Halfspace {
        return this._system.getPredicate(label);
    }

    // Worker request interface

    getState(state: StateID): Promise<StateDataPlus> {
        return this._comm.request("getState", state);
    }

    getStates(): Promise<StateDataPlus[]> {
        return this._comm.request("getStates", null);
    }

    getActions(state: StateID): Promise<ActionData[]> {
        return this._comm.request("getActions", state);
    }

    getSupports(state: StateID, action: ActionID): Promise<SupportData[]> {
        return this._comm.request("getSupports", [state, action]);
    }

    getOperator(op: string, state: StateID, us: JSONUnion): Promise<OperatorData> {
        return this._comm.request("getOperator", [op, state, us]);
    }

    getGameGraph(): Promise<GameGraphData> {
        return this._comm.request("getGameGraph", null);
    }

    sampleTrace(state: ?StateID, controller: string, maxSteps: number): Promise<TraceData> {
        return this._comm.request("sampleTrace", [state, controller, maxSteps]);
    }

    processAnalysis(results: AnalysisResults): Promise<ProcessAnalysisData> {
        // TODO: keep current state and action selected
        return this._comm.request("processAnalysis", results).then(data => {
            // Returned is the set of states that has changed kind
            //if (data.size > 0) this.notify();
            this.notify("system");
            return data;
        });
    }

    refine(state: ?StateID, steps: string[]): Promise<RefineData> {
        // TODO: keep current state and action selected
        return this._comm.request("refine", [state, steps]).then(data => {
            if (data.size > 0) this.notify();
            return data;
        });
    }

    getSnapshots(): Promise<SnapshotData> {
        return this._comm.request("getSnapshots", null);
    }

    takeSnapshot(name: string): Promise<TakeSnapshotData> {
        return this._comm.request("takeSnapshot", name).then((data) => {
            this.notify("snapshot");
            return data;
        });
    }

    loadSnapshot(id: number): Promise<LoadSnapshotData> {
        return this._comm.request("loadSnapshot", id).then((data) => {
            this.notify("snapshot");
            this.notify("system");
            return data;
        });
    }

    nameSnapshot(id: number, name: string): Promise<NameSnapshotData> {
        return this._comm.request("nameSnapshot", [id, name]).then((data) => {
            this.notify("snapshot");
            return data;
        });
    }

}


// Left Column: Basic Views

// Main view: LSS visualization and state selection
class SystemViewCtrl {

    +_model: SystemModel;
    +_plot: InteractivePlot;
    +_layers: { [string]: FigureLayer };
    // Settings
    _showAnalysis: boolean;
    _showLabels: boolean;
    _showVectors: boolean;
    _operator: ?OperatorWrapper;
    // Data caches
    _data: ?StateDataPlus[];
    _centroid: { [string]: Vector };

    constructor(model: SystemModel): void {
        this._model = model;
        this._model.attach((mc) => this.handleChange(mc));
        // ... TODO
        this._showAnalysis = false;
        this._showLabels = false;
        this._showVectors = false;
        this._operator = null;
        // ... TODO
        const fig = new Figure();
        this._layers = {
            kind:           fig.newLayer({ "stroke": "none" }),
            highlight1:     fig.newLayer({ "stroke": COLORS.highlight, "fill": COLORS.highlight }),
            selection:      fig.newLayer({ "stroke": COLORS.selection, "fill": COLORS.selection }),
            highlight2:     fig.newLayer({ "stroke": "none", "fill": COLORS.highlight, "fill-opacity": "0.2" }),
            support:        fig.newLayer({ "stroke": COLORS.support, "fill": COLORS.support }),
            vectorField:    fig.newLayer({ "stroke": COLORS.vectorField, "stroke-width": "1", "fill": COLORS.vectorField }),
            action:         fig.newLayer({ "stroke": COLORS.action, "stroke-width": "2", "fill": COLORS.action }),
            predicate:      fig.newLayer({ "stroke": COLORS.predicate, "fill": COLORS.predicate, "fill-opacity": "0.2" }),
            trace:          fig.newLayer({ "stroke": COLORS.trace, "stroke-width": "1.5", "fill": COLORS.trace }),
            label:          fig.newLayer({ "font-family": "DejaVu Sans, sans-serif", "font-size": "8pt", "text-anchor": "middle", "transform": "translate(0 3)" }),
            interaction:    fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#FFF", "fill-opacity": "0" })
        };
        this._plot = new InteractivePlot([660, 440], fig, autoProjection(3/2, ...this._model.lss.extent));
    }

    get node(): HTMLDivElement {
        return this._plot.node;
    }

    set showAnalysis(show: boolean): void {
        this._showAnalysis = show;
        this.drawAnalysis();
    }

    set showLabels(show: boolean): void {
        this._showLabels = show;
        this.drawLabels();
    }

    set showVectors(show: boolean): void {
        this._showVectors = show;
        this.drawVectors();
    }

    set operator(op: ?OperatorWrapper): void {
        this._operator = op;
        this.drawOperator();
    }

    handleChange(mc: ?ModelChange): void {
        if (mc === "system") {
            this._model.getStates().then((data) => {
                this._data = data;
                // Centroids are cached in a direct access data structure, as they are
                // important for positioning arrows (action/support targets don't
                // contain geometry)
                this._centroid = {};
                for (let state of data) { // TODO: tools.obj?
                    this._centroid[state.label] = state.centroid;
                }
                // Redraw states
                this.drawSystem(data);
            }).catch((e) => this._model.log.logError(e));
        } else if (mc === "state") {
            this.drawState();
        } else if (mc === "action") {
            this.drawAction();
        } else if (mc === "support") {
            this.drawSupport();
        }
    }

    drawSystem(states: StateDataPlus[]): void {
        this._layers.interaction.shapes = states.map((state) => {
            const click = () => {
                const [x, _] = this._model.state;
                this._model.xState = (state === x) ? null : state;
            };
            return {
                kind: "polytope", vertices: state.polytope.vertices,
                events: { click: click }
            };
        });
        this.drawAnalysis();
        this.drawLabels();
    }

    drawState(): void {
        const [x, _] = this._model.state;
        if (x == null) {
            this._layers.selection.shapes = [];
        } else {
            this._layers.selection.shapes = [{ kind: "polytope", vertices: x.polytope.vertices }];
        }
        this.drawOperator();
    }

    drawAction(): void {
        const action = this._model.action;
        const support = this._model.support;
        if (action == null) {
            this._layers.action.shapes = [];
        } else {
            const polys = support != null ? support.targets : action.targets;
            this._layers.action.shapes = polys.map((target) => ({
                kind: "arrow",
                origin: this._centroid[action.origin.label],
                target: this._centroid[target.label]
            }));
        }
        this.drawOperator();
    }

    drawSupport(): void {
        const support = this._model.support;
        if (support == null) {
            this._layers.support.shapes = [];
        } else {
            this._layers.support.shapes = support.origins.polytopes.map(
                (origin) => ({ kind: "polytope", vertices: origin.vertices })
            );
        }
        this.drawAction();
    }

    drawOperator(): void {
        const [x, _] = this._model.state;
        if (this._operator == null || x == null) {
            this._layers.highlight1.shapes = [];
            this._layers.highlight2.shapes = [];
        } else {
            const action = this._model.action;
            const control = (action == null) ? this._model.lss.uus.toUnion().serialize() : action.controls;
            this._operator(this._model, x, control).then((data) => {
                const shapes = data.polytopes.map(
                    (poly) => ({ kind: "polytope", vertices: poly.vertices })
                );
                this._layers.highlight1.shapes = shapes;
                this._layers.highlight2.shapes = shapes;
            }).catch(e => {
                this._model.log.logError(e);
            });
        }
    }

    drawAnalysis(): void {
        if (this._data != null) {
            const [_, q] = this._model.state;
            const color = this._showAnalysis ? (state) => stateColor(state, q) : stateColorSimple;
            this._layers.kind.shapes = this._data.map((state) => ({
                kind: "polytope",
                vertices: state.polytope.vertices,
                style: { fill: color(state) }
            }));
        }
    }

    drawLabels(): void {
        let labels = [];
        if (this._data != null && this._showLabels) {
            labels = this._data.map(
                (state) => ({ kind: "label", coords: state.centroid, text: state.label })
            );
        }
        this._layers.label.shapes = labels;
    }

    drawVectors(): void {
        const shapes = [];
        if (this._showVectors) {
            const fun = (x) => linalg.apply(this._model.lss.A, x);
            shapes.push({ kind: "vectorField", fun: fun, n: [12, 12] });
        }
        this._layers.vectorField.shapes = shapes;
    }

/* TODO TODO
    drawPredicate(): void {
        const label = this.stateView.predicates.hoverSelection;
        if (label == null) {
            this.layers.predicate.shapes = [];
        } else {
            const predicate = this.proxy.getPredicate(label);
            this.layers.predicate.shapes = [{
                kind: "halfspace",
                normal: predicate.normal,
                offset: predicate.offset
            }];
        }
    }

    drawTrace(): void {
        const marked = this.traceView.marked;
        this.layers.trace.shapes = this.traceView.trace.map((step, i) => ({
            kind: "arrow", origin: step.origin, target: step.target,
            style: (i === marked ? MARKED_STEP_STYLE : {})
        }));
    }

    toExportURL(): string {
        if (this._data == null) throw new Error("..."); // TODO
        const data: JSONPolygonItem[] = this._data.map(_ => [
            _.polytope,
            [this.viewCtrl.toggleLabel.value, _.label],
            [this.viewCtrl.toggleKind.value, stateColorSimple(_)], // TODO: analysis coloring
            [true, "#000000"]
        ]);
        return window.btoa(JSON.stringify(data));
    }
*/

}


type OperatorWrapper = (SystemModel, StateData, JSONUnion) => Promise<OperatorData>;
// Settings panel for the main view
class SystemViewCtrlCtrl {

    +node: HTMLDivElement;

    constructor(systemViewCtrl: SystemViewCtrl, keys: dom.Keybindings): void {
        // Operator highlight
        const operator = new SelectInput({
            "None": null,
            "Posterior": (model, state, us) => model.getOperator("post", state.label, us),
            "Predecessor": (model, state, us) => model.getOperator("pre", state.label, us),
            "Robust Predecessor": (model, state, us) => model.getOperator("preR", state.label, us),
            "Attractor": (model, state, us) => model.getOperator("attr", state.label, us),
            "Robust Attractor": (model, state, us) => model.getOperator("attrR", state.label, us)
        }, "None");
        operator.attach(() => {
            systemViewCtrl.operator = operator.value;
        });
        // View configuration
        const analysis = new CheckboxInput(false);
        analysis.attach(() => {
            systemViewCtrl.showAnalysis = analysis.value;
        });
        const labels = new CheckboxInput(false);
        labels.attach(() => {
            systemViewCtrl.showLabels = labels.value;
        });
        const vectors = new CheckboxInput(false);
        vectors.attach(() => {
            systemViewCtrl.showVectors = vectors.value;
        });
        // Assemble
        this.node = dom.DIV({ "id": "view-ctrl" }, [
            dom.P({ "class": "highlight" }, [
                operator.node, " ", dom.create("u", {}, ["h"]), "ighlight" 
            ]),
            dom.LABEL({}, [analysis.node, "Analysis C", dom.create("u", {}, ["o"]), "lors"]),
            dom.LABEL({}, [labels.node, "State ", dom.create("u", {}, ["L"]), "abels"]),
            dom.LABEL({}, [vectors.node, dom.create("u", {}, ["V"]), "ector Field"])
        ]);
        // Keybindings
        keys.bind("o", inputTextRotation(analysis, ["t", "f"]));
        keys.bind("l", inputTextRotation(labels, ["t", "f"]));
        keys.bind("v", inputTextRotation(vectors, ["t", "f"]));
        keys.bind("h", inputTextRotation(operator, [
            "None", "Posterior", "Predecessor", "Robust Predecessor", "Attractor", "Robust Attractor"
        ]));
    }

}


class ControlSpaceView {

    +node: HTMLDivElement;
    +_model: SystemModel;
    +_layers: { [string]: FigureLayer };

    constructor(model: SystemModel): void {
        this._model = model;
        this._model.attach((mc) => this.handleChange(mc));
        const fig = new Figure();
        this._layers = {
            poly:   fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#FFF" }),
            action: fig.newLayer({ "stroke": COLORS.action, "fill": COLORS.action }),
            trace:  fig.newLayer(MARKED_STEP_STYLE)
        };
        const uus = this._model.lss.uus;
        this._layers.poly.shapes = uus.polytopes.map((u) => ({ kind: "polytope", vertices: u.vertices }));
        const proj = autoProjection(1, ...uus.extent);
        const plot = new AxesPlot([120, 120], fig, proj);
        this.node = dom.DIV({ "id": "control-space-view" }, [plot.node]);
    }

    handleChange(mc: ?ModelChange): void {
        if (mc === "action") {
            const action = this._model.action;
            if (action == null) {
                this._layers.action.shapes = [];
            } else {
                this._layers.action.shapes = action.controls.polytopes.map(
                    poly => ({ kind: "polytope", vertices: poly.vertices })
                );
            }
        }
        // TODO
        /*const marked = this.traceView.marked;
        const trace = this.traceView.trace;
        if (marked >= 0 && marked < trace.length) {
            this.ctrlLayers.trace.shapes = [{ kind: "marker", size: 3, coords: trace[marked].control }];
        } else {
            this.ctrlLayers.trace.shapes = [];
        }*/
    }

}


class RandomSpaceView {

    +node: HTMLDivElement;
    +_model: SystemModel;
    +_layers: { [string]: FigureLayer };

    constructor(model: SystemModel): void {
        this._model = model;
        this._model.attach((mc) => this.handleChange(mc));
        const fig = new Figure();
        this._layers = {
            poly:   fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#FFF" }),
            trace:  fig.newLayer(MARKED_STEP_STYLE)
        };
        const ww = this._model.lss.ww;
        this._layers.poly.shapes = [{ kind: "polytope", vertices: ww.vertices }];
        const proj = autoProjection(1, ...ww.extent);
        const plot = new AxesPlot([120, 120], fig, proj);
        this.node = dom.DIV({ "id": "random-space-view" }, [plot.node]);
    }

    handleChange(mc: ?ModelChange): void {
        // TODO
        /*const marked = this.traceView.marked;
        const trace = this.traceView.trace;
        if (marked >= 0 && marked < trace.length) {
            this.randLayers.trace.shapes = [{ kind: "marker", size: 3, coords: trace[marked].random }];
        } else {
            this.randLayers.trace.shapes = [];
        }*/
    }

}


class AutomatonViewCtrl {

    +node: HTMLDivElement;

    constructor(model: SystemModel): void {
        this.node = dom.DIV();
    }

    // TODO

}


// Right Column: Tabs

type Tabs = { [string]: TabContent[] };
type TabContent = Element | { +node: Element };
class TabbedView {

    +tabs: Tabs;
    +content: HTMLDivElement;
    +titles: { [string]: HTMLDivElement };
    _selection: ?string;
    +node: HTMLDivElement;

    constructor(tabs: Tabs, init: string): void {
        this.tabs = tabs;
        this.content = dom.DIV();
        this.titles = obj.map((key, _) => {
            const link = dom.DIV({}, [key]);
            link.addEventListener("click", () => this.select(key));
            return link;
        }, tabs);
        this.node = dom.DIV({ "class": "tabs" }, [
            dom.DIV({ "class": "bar" }, [...obj.values(this.titles)]), this.content
        ]);
        this._selection = null;
        this.select(init);
    }

    select(tab: string): void {
        const sel = this._selection;
        if (sel != null) {
            this.titles[sel].className = "";
        }
        const nodes = this.tabs[tab];
        dom.replaceChildren(this.content, nodes.map(
            (_) => (_ instanceof Element ? _ : _.node)
        ));
        this.titles[tab].className = "selection";
        this._selection = tab;
    }

    highlight(tab: string): void {
        if (this._selection == null || this._selection != tab) {
            this.titles[tab].className = "highlight";
        }
    }

}


// Tab: Game
// - StateView
// - ActionView
// - SupportView

// TODO
class StateView {

    +node: HTMLDivElement;
    +_model: SystemModel;
    +_lines: HTMLDivElement[];
    +_predicates: SelectableNodes<string>;

    constructor(model: SystemModel): void {
        this._model = model;
        this._model.attach((mc) => this.handleChange(mc));
        // ... TODO
        this._lines = [dom.DIV(), dom.DIV(), dom.DIV()];
        this._predicates = new SelectableNodes(
            _ => predicateLabel(_, this._model.getPredicate(_)), "-", ", "
        );
        this._predicates.node.className = "predicates";
        this.node = dom.DIV({ "id": "state-view" }, [
            dom.DIV({}, [dom.DIV({ "class": "label" }, ["State:"]), this._lines[0]]),
            dom.DIV({}, [dom.DIV({ "class": "label" }, ["Actions:"]), this._lines[1]]),
            dom.DIV({}, [dom.DIV({ "class": "label" }, ["Analysis:"]), this._lines[2]]),
            dom.DIV({}, [dom.DIV({ "class": "label" }, ["Predicates:"]), this._predicates.node]),
        ]);
    }

    handleChange(mc: ?ModelChange): void {
        if (mc !== "state" && mc !== "system") return; // TODO
        const [x, q] = this._model.state;
        if (x != null) {
            const analysis = x.analysis;
            // Line 1: system and automaton labels
            dom.replaceChildren(this._lines[0], [
                stateLabel(x, x), ", ", automatonLabel(q, analysis)
            ]);
            // Line 2: action and automaton transition
            if (x.isOuter) {
                dom.replaceChildren(this._lines[1], ["0 (outer state)"]);
            } else if (analysisKind(q, analysis) === "unreachable") {
                dom.replaceChildren(this._lines[1], ["0 (state is unreachable)"]);
            } else if (analysis != null) {
                const next = analysis.next[q];
                if (next == null) throw new Error(
                    "no next automaton state found for reachable state " + x.label // TODO: recover
                );
                dom.replaceChildren(this._lines[1], [
                    x.numberOfActions.toString(), " (transition to ",
                    automatonLabel(next, null), ")"
                ]);
            } else {
                dom.replaceChildren(this._lines[1], [x.numberOfActions.toString()]);
            }
            // Line 3: analysis kinds
            if (analysis == null) {
                dom.replaceChildren(this._lines[2], ["?"]);
            } else {
                dom.replaceChildren(this._lines[2], arr.intersperse(
                    ", ", iter.map(_ => automatonLabel(_, analysis), this._model.qAll)
                ));
            };
            // Line 4: linear predicates
            this._predicates.items = Array.from(x.predicates);
        } else {
            for (let line of this._lines) dom.replaceChildren(line, ["-"]);
            this._predicates.items = [];
        }
    }

    /*
    set selection(state: ?StateDataPlus): void {
        const selection = this._selection;
        if (selection != null && state != null && state.label === selection.label) {
            this._selection = null;
        } else {
            this._selection = state;
        }
        this.handleChange();
    }
    
    refreshSelection(): void {
        const state = this._selection;
        if (state != null) {
            this.proxy.getState(state.label).then(data => {
                this._selection = data;
                this.handleChange();
            }).catch(e => {
                this._selection = null;
                this.handleChange();
            });
        }
    }

    handleChange() {
        const state = this._selection;
    }
    */

}


// Lists actions available for the selected state and contains the currently
// selected action. Observes StateView for the currently selected state.
class ActionViewCtrl {

    +node: HTMLDivElement;
    +_model: SystemModel;
    // Actions
    _action: ?ActionData;
    _actions: ActionData[];
    _actionNodes: Map<ActionData, HTMLDivElement>;
    // Supports
    _supports: SupportData[];
    _supportNode: HTMLDivElement;

    constructor(model: SystemModel): void {
        this._model = model;
        this._model.attach((mc) => this.handleChange(mc));
        this._action = null;
        this._actions = [];
        this._actionNodes = new Map();
        this._supports = [];
        this._supportNode = dom.DIV({ "id": "supports" });
        this.node = dom.DIV({ "id": "action-view" });
    }

    handleChange(mc: ?ModelChange): void {
        if (mc !== "state") return;
        const [x, _] = this._model.state;
        if (x != null) {
            this._model.getActions(x.label).then((actions) => {
                this._actionNodes = new Map(actions.map(_ => [_, this.actionToNode(_)]));
                dom.replaceChildren(this.node, this._actionNodes.values());
            }).catch((e) => this._model.log.logError(e));
        } else {
            dom.removeChildren(this.node);
        }
        // TODO keep action selected if x did not change
        this._action = null;
        this._model.action = null;
        this._model.support = null;
    }

    clickAction(action: ActionData): void {
        const oldAction = this._action;
        if (oldAction != null) {
            const oldNode = this._actionNodes.get(oldAction);
            if (oldNode != null) oldNode.className = "action";
        }
        if (action === oldAction) {
            this._action = null;
            this.node.removeChild(this._supportNode);
        } else {
            this._action = action;
            const newNode = this._actionNodes.get(action);
            if (newNode != null) {
                newNode.className = "selection";
                this._model.getSupports(action.origin.label, action.id).then(supports => {
                    dom.replaceChildren(this._supportNode, supports.map((_) => this.supportToNode(_)));
                    dom.appendAfter(this.node, newNode, this._supportNode);
                }).catch(e => this._model.log.logError(e));
            }
        }
        this._model.action = this._action;
    }

    actionToNode(action: ActionData): HTMLDivElement {
        const node = dom.DIV({ "class": "action" }, [
            stateLabel(action.origin, action.origin), " → {",
            ...arr.intersperse(", ", action.targets.map(
                target => stateLabel(target, action.origin)
            )),
            "}"
        ]);
        node.addEventListener("click", () => this.clickAction(action));
        node.addEventListener("mouseover", () => {
            this._model.action = action;
        });
        node.addEventListener("mouseout", () => {
            this._model.action = this._action;
        });
        return node;
    }

    supportToNode(support: SupportData): HTMLDivElement {
        const node = dom.DIV({}, [
            "{", ...arr.intersperse(", ", support.targets.map(
                (target) => stateLabel(target, support.origin)
            )), "}"
        ]);
        node.addEventListener("mouseover", () => {
            this._model.support = support;
        });
        node.addEventListener("mouseout", () => {
            this._model.support = null;
        });
        return node;
    }

}



// Tab: System
// - AnalysisCtrl
// - RefinementCtrl
// - SnapshotCtrl

class AnalysisCtrl {

    +node: HTMLDivElement;
    +_model: SystemModel;
    +_button: HTMLButtonElement;
    +_info: HTMLSpanElement;
    _comm: ?Communicator<Worker>;
    _ready: boolean;

    constructor(model: SystemModel, keys: dom.Keybindings): void {
        this._model = model;
        // Control elements, information display, keybindings
        this._button = dom.BUTTON({}, [dom.create("u", {}, ["a"]), "nalyse"]);
        this._button.addEventListener("click", () => this.analyse());
        this._info = dom.SPAN();
        this.node = dom.DIV({ "id": "analysis-ctrl"}, [
            dom.P({}, [this._button, " ", this._info])
        ]);
        keys.bind("a", () => this.analyse());
        // Create and setup the worker (separate worker for analysis, so system
        // exploration stays responsive)
        this.ready = false;
        this.infoText = "initializing...";
        try {
            // Associcate a communicator for message exchange
            const comm = new Communicator("IANA");
            // Worker will request objective automaton
            comm.onRequest("automaton", data => {
                return this.objective.automaton.stringify();
            });
            // Worker will request co-safe interpretation of objective
            comm.onRequest("coSafeInterpretation", data => {
                return this.objective.coSafeInterpretation;
            });
            // Worker will request alphabetMap (connects the automaton transition
            // labels with the linear predicates of the system)
            comm.onRequest("alphabetMap", data => {
                const alphabetMap = {};
                for (let [label, prop] of this.objective.propositions.entries()) {
                    alphabetMap[label] = stringifyProposition(prop);
                }
                return alphabetMap;
            });
            // Worker will tell when ready
            comm.onRequest("ready", (msg) => {
                this._comm = comm;
                this.infoText = "Web Worker ready.";
                this.ready = true;
            });
            const worker = new Worker("./js/inspector-worker-analysis.js");
            worker.onerror = () => {
                this.infoText = "startup error"
                this._model.log.logError({ name: "WorkerError", message: "unable to start analysis web worker" });
            };
            // Start communicator
            comm.host = worker;
        } catch (e) {
            // Chrome does not allow Web Workers for local resources
            if (e.name === "SecurityError") {
                this.infoText = "error: unable to start web worker for analysis"
                return;
            }
            throw e;
        }
    }

    get objective(): Objective {
        return this._model.objective;
    }

    get ready(): boolean {
        return this._ready;
    }

    set ready(ready: boolean): void {
        this._ready = ready;
        this._button.disabled = !ready;
    }

    set infoText(text: string): void {
        dom.replaceChildren(this._info, [text]);
    }

    analyse(): void {
        if (!this.ready) {
            return;
        }
        this.ready = false;
        this.infoText = "constructing game abstraction...";
        let startTime = performance.now();
        // Redirect game graph to analysis worker and wait for results
        this._model.getGameGraph().then((gameGraph) => {
            this.infoText = "analysing...";
            if (this._comm == null) throw new Error(
                "worker not available, game analysis not possible"
             );
            return this._comm.request("analysis", gameGraph);
        // Hand over analysis results to system worker (triggers update of
        // system state kinds)
        }).then((results) => {
            this.infoText = "processing results...";
            return this._model.processAnalysis(results);
        // Show information message
        }).then((updated) => {
            const s = updated.size;
            const elapsed = performance.now() - startTime;
            this.infoText = "Updated " + s + (s === 1 ? " state" : " states") + " after " + t2s(elapsed) + ".";
            this.ready = true;
        }).catch(err => {
            this.infoText = "analysis error";
            this._model.log.logError(err);
            // Even though it is probably not a good idea to continue once an
            // analysis error has occured, the user could still resume from
            // a previous snapshot
            this.ready = true;
        });
    }

}


type RefinementStep = {
    +node: HTMLDivElement,
    +toggle: HTMLInputElement,
    +text: string,
    +name: string
};
// Refinement controls. Observes analysis widget to block operations while
// analysis is carried out.
class RefinementCtrl {

    +node: HTMLDivElement;
    +_model: SystemModel;
    +_info: HTMLSpanElement;
    +_buttons: { [string]: HTMLButtonElement };
    +_steps: RefinementStep[];
    +_stepBox: HTMLDivElement;
    
    constructor(model: SystemModel, keys: dom.Keybindings): void {
        this._model = model;
        this._model.attach((mc) => this.handleChange(mc));
        // Information display
        this._info = dom.SPAN();
        // Refinement step configurator
        this._steps = [
            this._newStep("Negative Attractor", "NegativeAttr"),
            this._newStep("Positive Robust Predecessor", "PositivePreR"),
            this._newStep("Positive Robust Attractors (TODO)", "PositiveAttrR")
        ];
        this._stepBox = dom.DIV({ "id": "refinement-ctrl" }, [
            dom.P({}, ["The following refinement steps are applied in order:"]),
            ...this._steps.map(_ => _.node)
        ]);
        // Interface
        this._buttons = {
            refineAll: dom.BUTTON({}, [dom.create("u", {}, ["r"]), "efine all"]),
            refineOne: dom.BUTTON({}, ["r", dom.create("u", {}, ["e"]), "fine selection"])
        };
        this._buttons.refineAll.addEventListener("click", () => this.refineAll());
        this._buttons.refineOne.addEventListener("click", () => this.refineOne());
        this.node = dom.DIV({}, [
            dom.P({}, [this._buttons.refineAll, " ", this._buttons.refineOne, " ", this._info]),
            this._stepBox
        ]);
        // Keyboard Shortcuts
        keys.bind("r", () => this.refineAll());
        keys.bind("e", () => this.refineOne());
    }

    get steps(): string[] {
        return this._steps.filter(_ => _.toggle.checked).map(_ => _.name);
    }

    set infoText(text: string): void {
        dom.replaceChildren(this._info, [text]);
    }

    refine(which: ?StateData): void {
        const state = which == null ? null : which.label;
        this._model.refine(state, this.steps).then((data) => {
            this.infoText = "Refined " + data.size + (data.size === 1 ? " state." : " states.");
        }).catch(e => {
            // TODO catch analysis busy error
            this._model.log.logError(e);
        });
    }

    refineAll(): void {
        this.refine(null);
    }

    refineOne(): void {
        const [x, _] = this._model.state;
        if (x != null) {
            this.refine(x);
        }
    }

    handleChange(mc: ?ModelChange): void {
        if (mc !== "state") return;
        const [x, _] = this._model.state;
        this._buttons["refineOne"].disabled = (x == null);
    }

    _newStep(text: string, name: string): RefinementStep {
        const toggle = dom.INPUT({ "type": "checkbox" });
        const up = dom.BUTTON({}, ["▲"]);
        up.addEventListener("click", () => {
            const i = this._steps.indexOf(step);
            if (i > 0) {
                const other = this._steps[i - 1];
                this._stepBox.insertBefore(step.node, other.node);
                this._steps[i - 1] = step;
                this._steps[i] = other;
            }
        });
        const down = dom.BUTTON({}, ["▼"]);
        down.addEventListener("click", () => {
            const i = this._steps.indexOf(step);
            if (i < this._steps.length - 1) {
                const other = this._steps[i + 1];
                this._stepBox.insertBefore(other.node, step.node);
                this._steps[i + 1] = step;
                this._steps[i] = other;
            }
        });
        const step = {
            node: dom.DIV({}, [
                dom.DIV({ "class": "step-toggle" }, [toggle]),
                dom.DIV({ "class": "step-text" }, [text]),
                dom.DIV({ "class": "step-move" }, [up, down])
            ]),
            toggle: toggle,
            text: text,
            name: name
        };
        return step;
    }

}


class SnapshotViewCtrl {

    +node: HTMLDivElement;
    +_model: SystemModel;
    +_forms: { [string]: HTMLButtonElement|HTMLInputElement };
    +_treeView: HTMLDivElement;
    // Internal state
    _data: ?SnapshotData;
    _selection: ?number;

    constructor(model: SystemModel): void {
        this._model = model;
        this._model.attach((mc) => this.handleChange(mc));
        // Widget: menu bar with tree-structure view below
        this._forms = {
            take:   dom.BUTTON({}, ["new"]),
            load:   dom.BUTTON({}, ["load"]),
            rename: dom.BUTTON({}, ["rename"]),
            name:   dom.INPUT({ "type": "text", "placeholder": "Snapshot", "size": "25" })
        };
        this._forms.take.addEventListener("click", () => this.takeSnapshot());
        this._forms.load.addEventListener("click", () => this.loadSnapshot());
        this._forms.rename.addEventListener("click", () => this.renameSnapshot());
        this._treeView = dom.DIV({ "class": "tree" });
        this.node = dom.DIV({ "id": "snapshot-ctrl"}, [
            dom.P({}, [
                this._forms.take, " ", this._forms.name,
                dom.DIV({ "class": "right" }, [this._forms.rename, " ", this._forms.load])
            ]),
            this._treeView
        ]);
        // Ready-message from worker in proxy triggers first handleChange call
        // and initializes the state variables
        this._data = null;
        this._selection = null;
        // Disable taking snapshots at first, will be enabled with the first
        // handleChange call
        this._forms.take.disabled = true;
    }

    takeSnapshot(): void {
        const name = this._forms.name.value.trim();
        this._forms.name.value = "";
        this._model.takeSnapshot(name.length === 0 ? "Snapshot" : name);
    }

    loadSnapshot(): void {
        const selection = this._selection;
        if (selection != null) {
            this._model.loadSnapshot(selection).catch((e) => this._model.log.logError(e));
        }
    }

    renameSnapshot(): void {
        const selection = this._selection;
        const name = this._forms.name.value.trim();
        if (selection != null && name.length > 0) {
            this._model.nameSnapshot(selection, name).catch(e => this._model.log.logError(e));
        }
    }

    handleChange(mc: ?ModelChange): void {
        if (mc !== "snapshot") return;
        this._forms.take.disabled = false;
        this._model.getSnapshots().then((data) => {
            this._data = data;
            this.redraw();
        }).catch(e => {
            this._model.log.logError(e);
        });
    }

    // Refresh the contents of the snapshot tree-view
    redraw(): void {
        if (this._data != null) {
            dom.replaceChildren(this._treeView, this._renderTree(this._data));
        } else {
            dom.removeChildren(this._treeView);
        }
    }

    // Click handler
    _select(which: number): void {
        this._selection = this._selection === which ? null : which;
        this._forms.load.disabled = this._selection == null;
        this._forms.rename.disabled = this._selection == null;
        this.redraw();
    }

    // Recursive-descent drawing of snapshot tree
    _renderTree(snapshot: SnapshotData): HTMLDivElement[] {
        const nodes = [];
        const cls = "snap" + (snapshot.isCurrent ? " current" : "")
                           + (snapshot.id === this._selection ? " selection" : "");
        const node = dom.DIV({ "class": cls }, [
            snapshot.name,
            dom.SPAN({}, [snapshot.states + " states", percentageBar(snapshot.ratios)])
        ]);
        node.addEventListener("click", () => this._select(snapshot.id));
        nodes.push(node);
        if (snapshot.children.size > 0) {
            const indented = dom.DIV({ "class": "indented" });
            for (let child of snapshot.children) {
                dom.appendChildren(indented, this._renderTree(child));
            }
            nodes.push(indented);
        }
        return nodes;
    }

}



// Tab: Control
// - TraceView

class TraceViewCtrl {

    +node: HTMLDivElement;
    +_model: SystemModel;
    +_controller: Input<string>;
    +_layers: { [string]: FigureLayer };

    constructor(model: SystemModel, keys: dom.Keybindings): void {
        this._model = model;

        const fig = new Figure();
        this._layers = {
            arrows: fig.newLayer({ "stroke": COLORS.trace, "stroke-width": "1.5", "fill": COLORS.trace }),
            interaction: fig.newLayer({ "stroke": "none", "fill": "#FFF", "fill-opacity": "0" })
        };
        const proj = new Horizontal1D([-1, 0.01], [0, 1]);
        const plot = new ShapePlot([480, 20], fig, proj, false);

        this._controller = new SelectInput({
            "Random": "Random"
        }, "Random");
        const sampleButton = dom.BUTTON({
            "title": "sample a new trace with the selected controller"
        }, [dom.create("u", {}, ["s"]), "ample trace"]);
        sampleButton.addEventListener("click", () => this.sample());
        const clearButton = dom.BUTTON({ "title": "clear the current trace" }, [
            dom.create("u", {}, ["d"]), "elete"
        ]);
        clearButton.addEventListener("click", () => this.clear());

        this.node = dom.DIV({ "id": "trace-ctrl" }, [
            dom.P({}, [
                sampleButton, " ", clearButton,
                dom.DIV({ "class": "right" }, [
                    dom.create("u", {}, ["C"]), "ontroller ",
                    this._controller.node
                ])
            ]),
            plot.node
        ]);

        keys.bind("s", () => this.sample());
        keys.bind("c", inputTextRotation(this._controller, ["Random"]));
        keys.bind("d", () => this.clear());

        this.drawTraceArrows();
    }

    sample(): void {
        // If a system state is selected, sample from its polytope, otherwise
        // from the entire state space polytope
        const [x, y] = this._model.state;
        const initPoly = x == null ? null : x.label;
        const controller = this._controller.value;
        this._model.sampleTrace(initPoly, controller, TRACE_LENGTH).then((data) => {
            // Reversing results in nicer plots (tips aren't covered by next line)
            this._model.trace = data.reverse();
            this.drawTraceSelectors();
            this.drawTraceArrows();
        }).catch(e => this._model.log.logError(e));
    }

    clear(): void {
        this._model.trace = [];
        this.drawTraceSelectors();
        this.drawTraceArrows();
    }

    mark(stepNo: number): void {
        //this._marked = stepNo;
        this.drawTraceArrows();
    }

    // TODO: draw when _model notifies
    drawTraceSelectors(): void {
        const trace = this._model.trace;
        if (trace != null) {
            const n = trace.length;
            // TODO
            this._layers.interaction.shapes = trace.map((step, i) => ({
                kind: "polytope", vertices: [[-(i+1)/n], [-i/n]],
                events: {
                    "mouseover": () => this.mark(i),
                    "mouseout": () => this.mark(-1)
                }
            }));
        }
    }

    drawTraceArrows(): void {
        const trace = this._model.trace;
        if (trace != null) {
            const n = trace.length;
            //const marked = this._marked;
            const marked = false; // TODO
            if (n === 0) {
                this._layers.arrows.shapes = [];
            } else {
                this._layers.arrows.shapes = trace.map((step, i) => ({
                    kind: "arrow", origin: [-(i+1)/n], target: [-i/n],
                    style: (i === marked ? MARKED_STEP_STYLE : {})
                }));
            }
        }
    }

}



// Left column
// - AutomatonView
// - ViewCtrl
// - SpaceView
// - SystemView

class AutomatonView extends ObservableMixin<null> {

    +node: HTMLDivElement;
    +shapes: AutomatonShapeCollection;
    +layers: { [string]: FigureLayer };
    +allStates: Set<string>;
    _selection: string; // Automaton state label

    constructor(proxy: SystemInspector, keybindings: dom.Keybindings): void {
        super();
        const objective = proxy.objective;
        const init = objective.automaton.initialState.label;
        this.allStates = sets.map(_ => _.label, objective.automaton.states.values());
        // Automaton visualization
        const fig = new Figure();
        this.shapes = objective.toShapes();
        this.layers = {
            // State and transition labels are offset by 4px to achieve
            // vertical centering
            transitionLabels: fig.newLayer({
                "font-family": "serif", "font-size": "10pt", "transform": "translate(0 4)"
            }),
            stateLabels: fig.newLayer({
                "font-family": "DejaVu Sans, sans-serif", "font-size": "10pt",
                "text-anchor": "middle", "transform": "translate(0 4)"
            }),
            transitions: fig.newLayer({
                "fill": "#000", "stroke": "#000", "stroke-width": "2"
            }),
            states: fig.newLayer({
                "fill": "#FFF", "fill-opacity": "0", "stroke": "#000", "stroke-width": "1.5"
            })
        };
        // Select initial state at first
        this._selection = init;
        this.drawStates();
        this.drawTransitions();
        // Setup plot area
        const extent = this.shapes.extent;
        if (extent == null) throw new Error("No automaton plot extent given by objective");
        const proj = autoProjection(3/2, ...extent);
        const plot = new ShapePlot([330, 220], fig, proj, false);
        // Additional textual information about automaton
        const info = dom.P({}, [dom.create("u", {}, ["I"]), "nitial state: ", dom.snLabel.toHTML(init)]);

        this.node = dom.DIV({}, [info, plot.node]);
        keybindings.bind("i", () => { this.selection = init; });
    }

    get selection(): string {
        return this._selection;
    }

    set selection(q: string): void {
        this._selection = q;
        this.drawStates();
        this.notify();
    }

    drawStates(): void {
        const ss = [];
        const ls = [];
        for (let [state, [s, l]] of this.shapes.states) {
            s = obj.clone(s);
            s.events = { "click": () => { this.selection = state; } };
            if (state === this._selection) {
                s.style = { "stroke": COLORS.selection };
                l = obj.clone(l);
                l.style = { "fill": COLORS.selection };
            }
            ss.push(s);
            ls.push(l);
        }
        this.layers.states.shapes = ss;
        this.layers.stateLabels.shapes = ls;
    }

    drawTransitions(): void {
        const ts = [];
        const ls = [];
        for (let [origin, transitions] of this.shapes.transitions) {
            for (let [target, [t, l]] of transitions) {
                ts.push(t);
                ls.push(l);
            }
        }
        this.layers.transitions.shapes = ts;
        this.layers.transitionLabels.shapes = ls;
    }

}

