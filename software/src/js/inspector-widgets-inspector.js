// @flow
"use strict";

import type { FigureLayer, Shape } from "./figure.js";
import type { AnalysisResults, AnalysisResult } from "./game.js";
import type { Halfspace, JSONUnion } from "./geometry.js";
import type { StateData, StateDataPlus, ActionData, SupportData, OperatorData, TraceData,
              AnalysisData, RefineRequestStep, RefineData, TakeSnapshotData,
              LoadSnapshotData, NameSnapshotData, SnapshotData, SystemSummaryData
            } from "./inspector-worker-system.js";
import type { Vector, Matrix } from "./linalg.js";
import type { AutomatonStateLabel, AutomatonShapeCollection } from "./logic.js";
import type { JSONPolygonItem } from "./plotter-2d.js";
import type { RefinerySettings, RefineryActionPick, RefineryApproximation } from "./refinement.js";
import type { AbstractedLSS, LSS, StateID, ActionID, PredicateID } from "./system.js";
import type { Plot } from "./widgets-plot.js";
import type { Input } from "./widgets-input.js";

import * as dom from "./dom.js";
import { Figure, autoProjection, Horizontal1D } from "./figure.js";
import * as linalg from "./linalg.js";
import { Objective, texifyProposition } from "./logic.js";
import { iter, arr, obj, sets, n2s, t2s, replaceAll, ObservableMixin } from "./tools.js";
import { CheckboxInput, SelectInput, SelectableNodes, ClickCycler, inputTextRotation } from "./widgets-input.js";
import { InteractivePlot, AxesPlot, ShapePlot } from "./widgets-plot.js";
import { Communicator } from "./worker.js";


// Variable names for space dimensions
export const VAR_NAMES = "xy";

// Visualization/highlight colors for areas
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

type _AnalysisKind = "maybe" | "yes" | "no" | "unreachable";
function analysisKind(q: AutomatonStateLabel, analysis: ?AnalysisResult): _AnalysisKind {
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

// State coloring according to analysis status
function stateColor(state: StateData, wrtQ: AutomatonStateLabel): string {
    return COLORS[analysisKind(wrtQ, state.analysis)];
}

function stateLabel(state: StateData, wrtQ: ?AutomatonStateLabel): HTMLSpanElement {
    const out = dom.snLabel.toHTML(state.label);
    if (wrtQ != null) out.className = analysisKind(wrtQ, state.analysis);
    return out;
}

function automatonLabel(label: AutomatonStateLabel, ana?: ?AnalysisResult): HTMLSpanElement {
    const out = dom.snLabel.toHTML(label);
    out.className = analysisKind(label, ana);
    return out;
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
function predicateLabel(label: PredicateID, halfspace: Halfspace): HTMLSpanElement {
    const out = dom.snLabel.toHTML(label);
    out.title = ineq2s(halfspace);
    return out;
}

// Matrix display with KaTeX
function matrixToTeX(m: Matrix): string {
    return "\\begin{pmatrix}" + m.map(row => row.join("&")).join("\\\\") + "\\end{pmatrix}";
}

// Graphical depiction of analysis progress
function percentageBar(xs: { [string]: number }, omit?: string[]): HTMLDivElement {
    const total = iter.sum(obj.map2Array((_, x) => x, xs));
    const bar = dom.DIV({ "class": "percentage-bar" });
    for (let key in xs) {
        const ratio = xs[key] / total;
        bar.appendChild(dom.DIV({
            "class": key,
            "title": (ratio * 100).toFixed(1) + "% " + key,
            "style": "flex-grow:" + ratio
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
    // ...
    +objective: Objective;
    +_system: AbstractedLSS;

    constructor(system: AbstractedLSS, objective: Objective, keys: dom.Keybindings, analyseWhenReady: boolean) {
        const log = new Logger();
        const model = new SystemModel(system, objective, log, analyseWhenReady);
        // TODO: handle analyseWhenReady by attaching to model?
        // Main
        const systemViewCtrl = new SystemViewCtrl(model);
        const systemViewCtrlCtrl = new SystemViewCtrlCtrl(systemViewCtrl, keys);
        const randomSpaceView = new RandomSpaceView(model);
        const controlSpaceView = new ControlSpaceView(model);
        const automatonViewCtrl = new AutomatonViewCtrl(model, keys);
        // Game
        const stateView = new StateView(model);
        const actionViewCtrl = new ActionViewCtrl(model);
        // System
        const analysisViewCtrl = new AnalysisViewCtrl(model, keys);
        const refinementCtrl = new RefinementCtrl(model, keys);
        const snapshotViewCtrl = new SnapshotViewCtrl(model);
        // Strategy
        const traceViewCtrl = new TraceViewCtrl(model, keys);

        // Debug: connectivity
        const appLinks = dom.P(); // TODO
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

        const tabs = new TabbedView();
        const gameTab = tabs.newTab("Game", [
            stateView,
            actionViewCtrl
        ]);
        const systemTab = tabs.newTab("System", [
            analysisViewCtrl,
            refinementCtrl,
            snapshotViewCtrl
        ]);
        //const controlTab = tabs.newTab("Control", [
            // TODO traceViewCtrl
        //]);
        const infoTab = tabs.newTab("Info", [
            log
        ]);
        tabs.select("System");
        log.attach((kind) => {
            if (kind === "error") tabs.highlight("Info");
        });

        this.node = dom.DIV({ "id": "inspector" }, [
            dom.DIV({ "class": "left" }, [
                systemViewCtrl.node,
                dom.DIV({"class": "cols"}, [
                    dom.DIV({ "class": "left" }, [
                        dom.H3({}, [
                            "Control and Random Space",
                            dom.DIV({ "class": "icons" }, [dom.infoBox("info-control")])
                        ]),
                        controlSpaceView.node, randomSpaceView.node,
                        dom.H3({}, [
                            "View Settings",
                            dom.DIV({ "class": "icons" }, [dom.infoBox("info-settings")])
                        ]),
                        systemViewCtrlCtrl.node
                    ]),
                    dom.DIV({ "class": "right" }, [
                        dom.H3({}, [
                            "Objective Automaton",
                            dom.DIV({ "class": "icons" }, [dom.infoBox("info-automaton")])
                        ]),
                        automatonViewCtrl.node
                    ])
                ])
            ]),
            tabs.node
        ]);
    }

}


type ModelChange = "state" | "action" | "support" | "trace" | "system" | "snapshot"; 
// System access, centralized selection storage and change notifications
class SystemModel extends ObservableMixin<ModelChange> {

    +_comm: Communicator<Worker>;
    +log: Logger;
    +objective: Objective;
    // Selections
    _system: AbstractedLSS;
    _xState: ?StateDataPlus;
    _qState: AutomatonStateLabel;
    _action: ?ActionData;
    _support: ?SupportData;
    _trace: ?TraceData;

    constructor(system: AbstractedLSS, objective: Objective, log: Logger, analyseWhenReady: boolean): void {
        super();
        this.log = log;
        // System initialization
        this._system = system;
        // Setup dedicated worker for system tasks
        try {
            this._comm = new Communicator("ISYS");
            this._comm.onRequest("init", (data) => [system.serialize(), objective.serialize()]);
            // The worker signals "ready" when everything is set up
            this._comm.onRequest("ready", (data: null) => {
                this.notify("snapshot");
                this.notify("state");
                this.notify("action");
                this.notify("support");
                this.notify("trace");
                this.notify("system");
                if (analyseWhenReady) this.analyse();
            });
            const worker = new Worker("./js/inspector-worker-system.js");
            worker.onerror = () => {
                this.log.write("error", "unable to start system worker");
            };
            this._comm.host = worker;
        } catch (e) {
            // Chrome does not allow Web Workers for local resources
            if (e.name === "SecurityError") {
                this.log.writeError(e);
                return;
            }
            throw e;
        }
        // Static system information
        this.objective = objective;
        // Initialize selections
        this._xState = null;
        this._qState = objective.automaton.initialState.label;
        this._action = null;
        this._support = null;
        this._trace = null;
    }

    refreshSelection(): void {
        const [xOld, _] = this.state;
        if (xOld != null) {
            // Re-select the given state if it still exists, drop action and
            // support selection (TODO). System change needs to be propagated
            // to state, action and support selection.
            this.getState(xOld.label).then((data) => {
                this.xState = data;
                this.action = null;
                this.support = null;
            }).catch((e) => {
                this.xState = null;
                this.action = null;
                this.support = null;
            });
        }
    }

    // Getters and setters for selections

    get state(): [?StateDataPlus, AutomatonStateLabel] {
        return [this._xState, this._qState];
    }

    set xState(x: ?StateDataPlus): void {
        this._xState = x;
        this.notify("state");
    }

    set qState(q: AutomatonStateLabel): void {
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

    // System information convenience accessors

    get lss(): LSS {
        return this._system.lss;
    }

    get qAll(): Set<AutomatonStateLabel> {
        return this.objective.allStates;
    }

    getPredicate(label: PredicateID): Halfspace {
        return this._system.getPredicate(label);
    }

    transitionTo(x: StateData, q: AutomatonStateLabel): ?AutomatonStateLabel {
        return this.objective.nextState(x.predicates, q);
    }

    // Worker request interface

    getState(state: StateID): Promise<StateDataPlus> {
        return this._comm.request("getState", state).catch((e) => {
            //this.log.writeError(e); // TODO: this is only used for refreshSelection, errors are intended
            throw e;
        });
    }

    getStates(): Promise<StateDataPlus[]> {
        return this._comm.request("getStates", null).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    getActions(state: StateID): Promise<ActionData[]> {
        return this._comm.request("getActions", state).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    getSupports(state: StateID, action: ActionID): Promise<SupportData[]> {
        return this._comm.request("getSupports", [state, action]).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    getOperator(op: string, state: StateID, us: JSONUnion): Promise<OperatorData> {
        return this._comm.request("getOperator", [op, state, us]).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    sampleTrace(state: ?StateID, controller: string, maxSteps: number): Promise<TraceData> {
        return this._comm.request("sampleTrace", [state, controller, maxSteps]).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    analyse(): Promise<AnalysisData> {
        return this._comm.request("analyse", null).then((data) => {
            this.log.writeAnalysis(data);
            this.notify("system");
            this.refreshSelection();
            return data;
        }).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    refine(qs: AutomatonStateLabel[], steps: RefineRequestStep[]): Promise<RefineData> {
        return this._comm.request("refine", [qs, steps]).then((data) => {
            if (data.size > 0) {
                this.log.writeRefinement(data);
                this.notify("system");
                this.refreshSelection();
            }
            return data;
        }).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    getSystemSummary(): Promise<SystemSummaryData> {
        return this._comm.request("getSystemSummary", null).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    getSnapshots(): Promise<SnapshotData> {
        return this._comm.request("getSnapshots", null).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    takeSnapshot(name: string): Promise<TakeSnapshotData> {
        return this._comm.request("takeSnapshot", name).then((data) => {
            this.notify("snapshot");
            return data;
        }).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    loadSnapshot(id: number): Promise<LoadSnapshotData> {
        return this._comm.request("loadSnapshot", id).then((data) => {
            this.notify("snapshot");
            this.notify("system");
            this.refreshSelection();
            return data;
        }).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    nameSnapshot(id: number, name: string): Promise<NameSnapshotData> {
        return this._comm.request("nameSnapshot", [id, name]).then((data) => {
            this.notify("snapshot");
            return data;
        }).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

}


// Left Column: Basic Views

// Main view: LSS visualization and state selection
class SystemViewCtrl {

    +node: HTMLDivElement;
    +_model: SystemModel;
    +_plot: InteractivePlot;
    +_layers: { [string]: FigureLayer };
    // View settings
    _showLabels: boolean;
    _showVectors: boolean;
    _operator: ?OperatorWrapper;
    // Data caches
    _data: ?StateDataPlus[];
    _centroid: { [string]: Vector };

    constructor(model: SystemModel): void {
        this._model = model;
        this._model.attach((mc) => this.handleChange(mc));
        // View settings
        this._showLabels = false;
        this._showVectors = false;
        this._operator = null;
        // Setup view
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
        this.node = this._plot.node;
    }

    // View settings setters

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

    // Redraw elements when changes happen
    handleChange(mc: ?ModelChange): void {
        if (mc === "system") {
            this._model.getStates().then((data) => {
                this._data = data;
                // Centroids are cached in a direct access data structure, as
                // they are important for positioning arrows (action/support
                // targets don't contain geometry)
                this._centroid = {};
                for (let state of data) {
                    this._centroid[state.label] = state.centroid;
                }
                // Redraw interactive states
                this.drawSystem(data);
            });
        } else if (mc === "state") {
            this.drawState();
            this.drawAnalysis();
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
                this._model.xState = (x != null && state.label === x.label) ? null : state;
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
                // Only update if state has not changed since
                if (this._model.state[0] !== x) return;
                const shapes = data.polytopes.map(
                    (poly) => ({ kind: "polytope", vertices: poly.vertices })
                );
                this._layers.highlight1.shapes = shapes;
                this._layers.highlight2.shapes = shapes;
            });
        }
    }

    drawAnalysis(): void {
        if (this._data != null) {
            const [_, q] = this._model.state;
            this._layers.kind.shapes = this._data.map((state) => ({
                kind: "polytope",
                vertices: state.polytope.vertices,
                style: { fill: stateColor(state, q) }
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

/* TODO: reimplement this functionality

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
            dom.LABEL({}, [labels.node, "State ", dom.create("u", {}, ["L"]), "abels"]),
            dom.LABEL({}, [vectors.node, dom.create("u", {}, ["V"]), "ector Field"])
        ]);
        // Keybindings
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
    +_model: SystemModel;
    +_shapes: AutomatonShapeCollection;
    +_layers: { [string]: FigureLayer };

    constructor(model: SystemModel, keys: dom.Keybindings): void {
        this._model = model;
        this._model.attach((mc) => this.handleChange(mc));
        // ...
        const objective = this._model.objective;
        const init = objective.automaton.initialState.label;
        // ...
        const fig = new Figure();
        this._shapes = objective.toShapes();
        this._layers = {
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
                "fill": "#FFF", "fill-opacity": "0", "stroke": "#000", "stroke-width": "2"
            })
        };
        this.drawLabels();
        // Setup plot area
        const extent = this._shapes.extent;
        if (extent == null) throw new Error("No automaton plot extent given by objective");
        const proj = autoProjection(3/2, ...extent);
        const plot = new ShapePlot([330, 220], fig, proj, false);
        // Additional textual information about automaton
        const info = dom.P({}, [dom.create("u", {}, ["I"]), "nitial state: ", dom.snLabel.toHTML(init)]);
        this.node = dom.DIV({}, [info, plot.node]);
        keys.bind("i", () => { this._model.qState = init; });
    }

    handleChange(mc: ?ModelChange): void {
        if (mc === "state") {
            this.draw();
        }
    }

    draw(): void {
        const [x, q] = this._model.state;
        const next = x == null ? null : this._model.transitionTo(x, q);
        // States
        const ss = [];
        for (let [state, [s, l]] of this._shapes.states) {
            s = obj.clone(s);
            s.events = { "click": () => { this._model.qState = state; } };
            if (state === q) {
                s.style = { "stroke": COLORS.selection };
            }
            ss.push(s);
        }
        // Transitions
        const ts = [];
        for (let [origin, transitions] of this._shapes.transitions) {
            for (let [target, [t, l]] of transitions) {
                if (origin === q && target === next) {
                    t = obj.clone(t);
                    t.style = { "stroke": COLORS.selection, "fill": COLORS.selection };
                }
                ts.push(t);
            }
        }
        this._layers.states.shapes = ss;
        this._layers.transitions.shapes = ts;
    }

    drawLabels(): void {
        const ss = [];
        for (let [_, l] of this._shapes.states.values()) {
            ss.push(l);
        }
        this._layers.stateLabels.shapes = ss;
        const ts = [];
        for (let transitions of this._shapes.transitions.values()) {
            for (let [_, l] of transitions.values()) {
                ts.push(l);
            }
        }
        this._layers.transitionLabels.shapes = ts;
    }

}


// Right Column: Tabs

class TabbedView {

    +_tabs: Map<string, TabContent>;
    +_bar: HTMLDivElement;
    +_content: HTMLDivElement;
    _selection: ?TabContent;
    +node: HTMLDivElement;

    constructor(): void {
        this._tabs = new Map();
        this._bar = dom.DIV({ "class": "bar" });
        this._content = dom.DIV();
        this.node = dom.DIV({ "class": "tabs" }, [this._bar, this._content]);
        this._selection = null;
    }

    newTab(name: string, widgets: TabWidget[]): TabContent {
        const tab = new TabContent(this, name, widgets);
        this._tabs.set(name, tab);
        this._bar.appendChild(tab.title);
        return tab;
    }

    select(name: string): void {
        const oldTab = this._selection;
        if (oldTab != null) {
            oldTab.title.className = ""; // TODO
        }
        const tab = this._tabs.get(name);
        if (tab == null) throw new Error(); // TODO
        dom.replaceChildren(this._content, tab.children);
        tab.title.className = "selection";
        this._selection = tab;
    }

    highlight(name: string): void {
        const tab = this._tabs.get(name);
        if (tab == null) throw new Error(); // TODO
        if (tab !== this._selection) tab.title.className = "highlight";
    }

}


interface TabWidget {
    +node: HTMLDivElement,
    +heading: HTMLHeadingElement
};

class TabContent {

    +title: HTMLDivElement;
    +widgets: TabWidget[];

    constructor(view: TabbedView, name: string, widgets: TabWidget[]): void {
        this.title = dom.DIV({}, [name]);
        this.title.addEventListener("click", () => view.select(name));
        this.widgets = widgets;
    }

    get children(): HTMLElement[] {
        const out = [];
        for (let widget of this.widgets) {
            out.push(widget.heading);
            out.push(widget.node);
        }
        return out;
    }

}


class WidgetPlus implements TabWidget {

    // ...
    +node: HTMLDivElement;
    +heading: HTMLHeadingElement;
    +_icons: HTMLElement[];
    // ...
    _isLoading: number;

    constructor(title: string, infoBoxId?: string): void {
        this._isLoading = 0;
        this._icons = [
            dom.create("img", {
                "src": "svg/loading16.svg",
                "style": "display:none;",
                "title": "loading...",
                "alt": "loading..."
            })
        ];
        if (infoBoxId != null) this._icons.push(dom.infoBox(infoBoxId));
        this.heading = dom.H3({}, [
            title,
            dom.DIV({ "class": "icons" }, this._icons)
        ]);
    }

    get isLoading(): boolean {
        return this._isLoading > 0;
    }

    pushLoad(): void {
        this._isLoading++;
        if (this._isLoading === 1) this.handleLoadingChange();
    }
    
    popLoad(): void {
        this._isLoading--;
        if (this._isLoading === 0) this.handleLoadingChange();
    }

    handleLoadingChange(): void {
        this._icons[0].style.display = this.isLoading ? "inline-block" : "none";
    }

}


// Tab: Game
// - StateView
// - ActionViewCtrl

class StateView extends WidgetPlus {

    +node: HTMLDivElement;
    +_model: SystemModel;
    +_lines: HTMLDivElement[];
    +_predicates: SelectableNodes<PredicateID>;

    constructor(model: SystemModel): void {
        super("Selection", "info-state");
        this._model = model;
        this._model.attach((mc) => this.handleChange(mc));
        this._lines = [dom.DIV({ "class": "selection" }), dom.DIV(), dom.DIV()];
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
        if (mc !== "state") return;
        const [x, q] = this._model.state;
        if (x != null) {
            const analysis = x.analysis;
            // Line 1: system and automaton labels
            dom.replaceChildren(this._lines[0], [
               dom.snLabel.toHTML(x.label), ", ", dom.snLabel.toHTML(q)
            ]);
            // Line 2: action and automaton transition
            const qNext = this._model.transitionTo(x, q);
            if (x.isOuter) {
                dom.replaceChildren(this._lines[1], ["0 (outer state)"]);
            } else if (analysisKind(q, analysis) === "unreachable") {
                dom.replaceChildren(this._lines[1], ["0 (unreachable state)"]);
            } else if (qNext == null) {
                dom.replaceChildren(this._lines[1], ["0 (dead end state)"]);
            } else {
                dom.replaceChildren(this._lines[1], [
                    x.numberOfActions.toString(), " (transition to ", automatonLabel(qNext, null), ")"
                ]);
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

}


// Lists actions available for the selected state and contains the currently
// selected action. Observes StateView for the currently selected state.
class ActionViewCtrl extends WidgetPlus {

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
        super("Actions", "info-actions");
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
        // TODO: this should be able to handle action changes that come from
        // somewhere other than itself
        if (mc === "state") {
            const [x, q] = this._model.state;
            if (x != null && this._model.transitionTo(x, q) != null
                          && analysisKind(q, x.analysis) !== "unreachable") {
                this.pushLoad();
                this._model.getActions(x.label).then((actions) => {
                    // Only update if state has not changed since
                    if (this._model.state[0] !== x) return;
                    this._actionNodes = new Map(actions.map(_ => [_, this.actionToNode(_)]));
                    dom.replaceChildren(this.node, this._actionNodes.values());
                }).catch((e) => {
                    // ...
                }).finally(() => {
                    this.popLoad();
                });
            } else {
                dom.replaceChildren(this.node, ["-"]);
            }
            this._action = null;
            this._model.action = null;
            this._model.support = null;
        }
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
                this.pushLoad();
                this._model.getSupports(action.origin.label, action.id).then(supports => {
                    dom.replaceChildren(this._supportNode, supports.map((_) => this.supportToNode(_)));
                    dom.appendAfter(this.node, newNode, this._supportNode);
                }).catch((e) => {
                    // ...
                }).finally(() => {
                    this.popLoad();
                });
            }
        }
        this._model.action = this._action;
    }

    actionToNode(action: ActionData): HTMLDivElement {
        const [_, q] = this._model.state;
        const next = this._model.transitionTo(action.origin, q);
        const origin = stateLabel(action.origin, q);
        const targets = arr.intersperse(", ", action.targets.map((target) => stateLabel(target, next)));
        const node = dom.DIV({ "class": "action" }, [origin, " → {", ...targets, "}"]);
        node.addEventListener("click", () => this.clickAction(action));
        node.addEventListener("mouseover", (e: MouseEvent) => {
            if (dom.fromChildElement(node, e)) return;
            this._model.action = action;
        });
        node.addEventListener("mouseout", (e: MouseEvent) => {
            if (dom.fromChildElement(node, e)) return;
            this._model.action = this._action;
        });
        return node;
    }

    supportToNode(support: SupportData): HTMLDivElement {
        const [_, q] = this._model.state;
        const next = this._model.transitionTo(support.origin, q);
        const targets = arr.intersperse(", ", support.targets.map((target) => stateLabel(target, next)));
        const node = dom.DIV({}, ["{", ...targets, "}"]);
        node.addEventListener("mouseover", (e: MouseEvent) => {
            if (dom.fromChildElement(node, e)) return;
            this._model.support = support;
        });
        node.addEventListener("mouseout", (e: MouseEvent) => {
            if (dom.fromChildElement(node, e)) return;
            this._model.support = null;
        });
        return node;
    }

}



// Tab: System
// - AnalysisViewCtrl
// - RefinementCtrl
// - SnapshotViewCtrl


class AnalysisViewCtrl extends WidgetPlus{

    +_model: SystemModel;
    +_button: HTMLButtonElement;
    +_info: HTMLSpanElement;
    _bar: HTMLDivElement;
    _summary: ?SystemSummaryData;

    constructor(model: SystemModel, keys: dom.Keybindings): void {
        super("Analysis", "info-analysis");
        this._model = model;
        this._model.attach((mc) => this.handleModelChange(mc));
        // Button to start analysis
        this._button = dom.BUTTON({}, [dom.create("u", {}, ["a"]), "nalyse"]);
        this._button.addEventListener("click", () => this.analyse());
        // Text information display
        this._info = dom.SPAN({ "class": "count-stats" });
        // Progress bar
        this._bar = percentageBar({ "please wait...": 1 });
        // Widget
        this.node = dom.DIV({ "id": "analysis-view-ctrl"}, [
            dom.P({}, [this._button, this._info]),
            this._bar
        ]);
        keys.bind("a", () => this.analyse());
    }

    analyse(): void {
        if (this.isLoading) return; // TODO
        this.pushLoad();
        // Redirect game graph to analysis worker and wait for results
        this._model.analyse().then((data: AnalysisData) => {
            // ...
        }).catch((e) => {
            // ...
        }).finally(() => {
            this.popLoad();
        });
    }

    handleChange(): void {
        const [_, q] = this._model.state;
        const summary = this._summary;
        if (summary == null) return; // TODO
        const stats = summary.get(q);
        if (stats == null) return; // TODO
        const count = stats.count;
        const volume = stats.volume;
        const totalCount = count.yes + count.no + count.maybe + count.unreachable;
        const totalVolume = volume.yes + volume.no + volume.maybe + volume.unreachable;
        dom.replaceChildren(this._info, [
            automatonLabel(q), " :: ",
            dom.SPAN({ "class": "yes", "title": "yes" }, [count.yes.toString()]), " + ",
            dom.SPAN({ "class": "maybe", "title": "maybe" }, [count.maybe.toString()]), " + ",
            dom.SPAN({ "class": "no", "title": "no" }, [count.no.toString()]), " + ",
            dom.SPAN({ "class": "unreachable", "title": "unrechable" }, [count.unreachable.toString()]), " = ",
            totalCount + " states"
        ]);
        const bar = percentageBar(volume);
        this.node.replaceChild(bar, this._bar);
        this._bar = bar;
    }

    handleModelChange(mc: ?ModelChange): void {
        if (mc === "system") {
            this.pushLoad();
            this._model.getSystemSummary().then((data) => {
                this._summary = data;
                this.handleChange();
            }).catch((e) => {
                // ...
            }).finally(() => {
                this.popLoad();
            });
        } else if (mc == "state") {
            this.handleChange();
        }
    }
    
    handleLoadingChange(): void {
        super.handleLoadingChange();
        this._button.disabled = this.isLoading;
    }

}


// Refinement controls. Observes analysis widget to block operations while
// analysis is carried out.
class RefinementCtrl extends WidgetPlus {

    +_model: SystemModel;
    +_button: HTMLButtonElement;
    +_info: HTMLSpanElement;
    +_qs: Map<AutomatonStateLabel, HTMLInputElement>;
    +_steps: RefinementStep[];
    +_stepBox: HTMLDivElement;
    
    constructor(model: SystemModel, keys: dom.Keybindings): void {
        super("Abstraction Refinement", "info-refinement");
        this._model = model;
        this._model.attach((mc) => this.handleChange(mc));
        this._button = dom.BUTTON({}, [dom.create("u", {}, ["r"]), "efine"]);
        this._button.addEventListener("click", () => this.refine());
        this._qs = new Map();
        for (let q of this._model.qAll) {
            const checkbox = dom.INPUT({ "type": "checkbox" });
            checkbox.checked = true;
            this._qs.set(q, checkbox);
        }
        this._steps = [
            new RefinementStep("Negative Attractor", false),
            new RefinementStep("Positive Robust Predecessor", false),
            new RefinementStep("Positive Robust Attractor", true)
        ];
        this._stepBox = dom.DIV({}, this._steps.map(_ => _.node));
        this.node = dom.DIV({}, [
            dom.P({ "id": "refinement-ctrl" }, [this._button, " ", ...iter.map(([q, box]) => dom.LABEL({}, [box, automatonLabel(q)]), this._qs)]),
            this._stepBox
        ]);
        // Keyboard Shortcuts
        keys.bind("r", () => this.refine());
    }

    get steps(): RefineRequestStep[] {
        return this._steps.filter(_ => _.isEnabled).map(_ => [_.name, _.settings]);
    }

    get qs(): AutomatonStateLabel[] {
        const qs = [];
        for (let [q, box] of this._qs) {
            if (box.checked) qs.push(q);
        }
        return qs;
    }

    refine(): void {
        if (this.isLoading) return; // TODO
        this.pushLoad();
        this._model.refine(this.qs, this.steps).then((data) => {
            // ...
        }).catch((e) => {
            // ...
        }).finally(() => {
            this.popLoad();
        });
    }

    handleChange(mc: ?ModelChange): void {
        if (mc !== "state") return;
        const [x, _] = this._model.state;
    }

    handleLoadingChange(): void {
        super.handleLoadingChange();
        this._button.disabled = this.isLoading;
    }

}


class RefinementStep {

    +node: HTMLDivElement;
    +name: string;
    +_info: HTMLDivElement;
    +_toggle: Input<boolean>;
    +_approximation: Input<RefineryApproximation>;
    +_actionPick: Input<RefineryActionPick>;
    +_showActionPick: boolean
    _expanded: boolean;

    constructor(name: string, showActionPick: boolean): void {
        this.name = name;
        this._toggle = new CheckboxInput(false);
        this._toggle.attach(() => this.handleChange());
        this._approximation = new ClickCycler({
            "no approximation": "none",
            "approximate target": "target",
            "approximate after": "after"
        }, "no approximation");
        this._actionPick = new ClickCycler({
            "estimate best action": "best",
            "random action": "random"
        }, "estimate best action");
        this._showActionPick = showActionPick;
        this._info = dom.DIV({ "class": "info" });
        this.node = dom.DIV({ "class": "refinement-step" }, [
            dom.LABEL({ "class": "name" }, [this._toggle.node, name]), this._info
        ]);
        this.handleChange();
    }

    get isEnabled(): boolean {
        return this._toggle.value;
    }

    get settings(): RefinerySettings {
        return {
            actionPick: this._actionPick.value,
            approximation: this._approximation.value
        };
    }

    handleChange(): void {
        const nodes = [];
        if (!this._toggle.value) nodes.push("disabled");
        if (this._showActionPick) nodes.push(this._actionPick.node);
        nodes.push(this._approximation.node);
        dom.replaceChildren(this._info, arr.intersperse(" :: ", nodes));
    }

}


class SnapshotViewCtrl extends WidgetPlus {

    +_model: SystemModel;
    +_forms: { [string]: HTMLButtonElement|HTMLInputElement };
    +_treeView: HTMLDivElement;
    // Internal state
    _data: ?SnapshotData;
    _selection: ?number;

    constructor(model: SystemModel): void {
        super("Snapshots", "info-snapshots");
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
        this.handleLoadingChange();
    }

    takeSnapshot(): void {
        const name = this._forms.name.value.trim();
        this._forms.name.value = "";
        this.pushLoad();
        this._model.takeSnapshot(name.length === 0 ? "Snapshot" : name).catch((e) => {
            // ...
        }).finally(() => {
            this.popLoad();
        });
    }

    loadSnapshot(): void {
        const selection = this._selection;
        if (selection != null) {
            this.pushLoad();
            this._model.loadSnapshot(selection).catch((e) => {
                // ...
            }).finally(() => {
                this.popLoad();
            });
        }
    }

    renameSnapshot(): void {
        const selection = this._selection;
        const name = this._forms.name.value.trim();
        if (selection != null && name.length > 0) {
            this.pushLoad();
            this._model.nameSnapshot(selection, name).catch((e) => {
                // ...
            }).finally(() => {
                this.popLoad();
            });
        }
    }

    handleChange(mc: ?ModelChange): void {
        if (mc !== "snapshot") return;
        this.pushLoad();
        this._model.getSnapshots().then((data) => {
            this._data = data;
            this.redraw();
        }).catch((e) => {
            // ...
        }).finally(() => {
            this.popLoad();
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
        this.handleLoadingChange();
        this.redraw();
    }

    // Recursive-descent drawing of snapshot tree
    _renderTree(snapshot: SnapshotData): HTMLDivElement[] {
        const nodes = [];
        const cls = "snap" + (snapshot.isCurrent ? " current" : "")
                           + (snapshot.id === this._selection ? " selection" : "");
        const node = dom.DIV({ "class": cls }, [
            snapshot.name,
            dom.SPAN({}, [snapshot.states + " states"])
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

    handleLoadingChange(): void {
        super.handleLoadingChange();
        this._forms.take.disabled = this.isLoading;
        this._forms.load.disabled = this.isLoading || this._selection == null;
        this._forms.rename.disabled = this.isLoading || this._selection == null;
    }

}



// Tab: Control
// - TraceViewCtrl

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
        }).catch((e) => {
            // ...
        });
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


// Tab: Info
// - Logger

type LogKind = "analysis" | "refinement" | "error";

class Logger extends ObservableMixin<LogKind> implements TabWidget {

    +node: HTMLDivElement;
    +heading: HTMLHeadingElement;
    +_filters: { [string]: Input<boolean> };
    +_entries: HTMLDivElement;

    constructor(): void {
        super();
        this._filters = {
            analysis: new CheckboxInput(true),
            refinement: new CheckboxInput(true),
            error: new CheckboxInput(true)
        };
        obj.forEach((_, input) => input.attach(() => this.handleFilterChange()), this._filters);
        this._entries = dom.DIV()
        this.node = dom.DIV({ "id": "logger" }, [
            dom.P({ "class": "log-filter" }, [
                dom.LABEL({}, [this._filters.analysis.node, "analysis"]),
                dom.LABEL({}, [this._filters.refinement.node, "refinement"]),
                dom.LABEL({}, [this._filters.error.node, "error"])
            ]),
            this._entries
        ]);
        this.heading = dom.H3({}, ["Log Messages"]);
        this.handleFilterChange();
    }

    _write(kind: LogKind, content: HTMLDivElement): void {
        content.className = "log-content";
        const now = new Date(Date.now());
        const entry = dom.DIV({ "class": "log-" + kind }, [
            dom.DIV({ "class": "log-heading" }, [now.toLocaleTimeString(), " :: ", kind]),
            content
        ]);
        this._entries.appendChild(entry);
        this._entries.scrollTop = entry.offsetTop;
        this.notify(kind);
    }

    write(kind: LogKind, text: string): void {
        this._write(kind, dom.DIV({}, [text]));
    }

    writeError(e: Error): void {
        console.log(e);
        this.write("error", e.message);
    }

    writeAnalysis(data: AnalysisData): void {
        this._write("analysis", dom.DIV({}, [
            "game abstraction (" + t2s(data.tGame) + "), analysis (" + t2s(data.tAnalysis) + ")."
        ]));
    }

    writeRefinement(data: RefineData): void {
        this._write("refinement", dom.DIV({}, [
            "refined " + data.size + " states"
        ]));
    }
    
    handleFilterChange(): void {
        let cls = "log-entries";
        for (let kind in this._filters) {
            if (this._filters[kind].value) {
                cls += " show-" + kind;
            }
        }
        this._entries.className = cls;
    }

}

