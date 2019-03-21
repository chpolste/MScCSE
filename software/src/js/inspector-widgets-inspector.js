// @flow
"use strict";

import type { JSONTraceStep } from "./controller.js";
import type { FigureLayer, Shape } from "./figure.js";
import type { AnalysisResults, AnalysisResult } from "./game.js";
import type { Halfspace, JSONUnion } from "./geometry.js";
import type { StateData, StatesData, ActionsData, SupportData, TraceData,
              AnalysisData, RefineData, TakeSnapshotData, LoadSnapshotData, NameSnapshotData,
              SnapshotData, SystemSummaryData } from "./inspector-worker-system.js";
import type { Vector, Matrix } from "./linalg.js";
import type { Proposition, AutomatonStateID, AutomatonShapeCollection } from "./logic.js";
import type { JSONPolygonItem } from "./plotter-2d.js";
import type { StateRefinerySettings, StateRefineryApproximation, LayerRefinerySettings,
              LayerRefineryGenerator, OuterAttrRefinerySettings } from "./refinement.js";
import type { AbstractedLSS, LSS, StateID, ActionID, PredicateID } from "./system.js";
import type { Plot } from "./widgets-plot.js";
import type { Input, OptionsInput } from "./widgets-input.js";

import * as dom from "./dom.js";
import { Figure, autoProjection, Cartesian2D, Horizontal1D } from "./figure.js";
import { Polytope, Union } from "./geometry.js";
import * as linalg from "./linalg.js";
import { AtomicProposition, Objective, texifyProposition } from "./logic.js";
import { just, iter, arr, obj, sets, n2s, t2s, replaceAll, ObservableMixin } from "./tools.js";
import { CheckboxInput, DropdownInput, RadioInput, inputTextRotation } from "./widgets-input.js";
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
    stateRegion: "#F60",
    vectorField: "#333",
    trace: "#000",
    traceStep: "#C00"
};


type _AnalysisKind = "maybe" | "yes" | "no" | "unreachable";
function analysisKind(q: AutomatonStateID, analysis: ?AnalysisResult): _AnalysisKind {
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
function stateColor(state: StateData, wrtQ: AutomatonStateID): string {
    return COLORS[analysisKind(wrtQ, state.analysis)];
}

function stateLabel(state: StateData, wrtQ: ?AutomatonStateID): HTMLSpanElement {
    const out = dom.snLabel.toHTML(state.label);
    if (wrtQ != null) out.className = analysisKind(wrtQ, state.analysis);
    return out;
}

function automatonLabel(label: AutomatonStateID, ana?: ?AnalysisResult): HTMLSpanElement {
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

// Counts with the associated word in the singular/plural
function pluralize(n: number, word: string): string {
    return n + " " + word + (n === 1 ? "" : "s");
}



export class ProblemSummary {

    +node: HTMLDivElement;

    constructor(system: AbstractedLSS, objective: Objective): void {
        const csFig = new Figure();
        csFig.newLayer({ stroke: "#000", fill: "#EEE" }).shapes = system.lss.uu.polytopes.map(
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
        const cs = new AxesPlot([90, 90], csFig, autoProjection(1, ...system.lss.uu.extent));
        const rs = new AxesPlot([90, 90], rsFig, autoProjection(1, ...system.lss.ww.extent));
        const ss = new AxesPlot([90, 90], ssFig, autoProjection(1, ...system.lss.xx.extent));
        // Show formula with transition label and substituted propositions
        let formula = objective.kind.formula;
        for (let [symbol, prop] of objective.propositions) {
            formula = replaceAll(formula, symbol, "(" + texifyProposition(prop, dom.snLabel.toTeX) + ")");
        }
        formula = objective.kind.formula + " = " + formula;
        // Assemble
        this.node = dom.DIV({ "id": "problem-summary" }, [
            dom.renderTeX("x_{t+1} = " + matrixToTeX(system.lss.A) + " x_t + " + matrixToTeX(system.lss.B) + " u_t + w_t", dom.P()),
            dom.DIV({ "class": "boxes" }, [
                dom.DIV({}, [dom.H3({}, ["Control Space Polytope (", dom.renderTeX("U", dom.SPAN()), ")"]), cs.node]),
                dom.DIV({}, [dom.H3({}, ["Random Space Polytope (", dom.renderTeX("W", dom.SPAN()), ")"]), rs.node]),
                dom.DIV({}, [dom.H3({}, ["State Space Polytope (", dom.renderTeX("X", dom.SPAN()), ")"]), ss.node]),
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

    constructor(system: AbstractedLSS, objective: Objective, keys: dom.Keybindings, analyseOnStartup: boolean) {
        const log = new Logger();
        const model = new SystemModel(system, objective, log, analyseOnStartup);
        // Main views
        const systemViewCtrl = new SystemViewCtrl(model);
        const randomSpaceView = new RandomSpaceView(model);
        const controlSpaceView = new ControlSpaceView(model);
        const automatonViewCtrl = new AutomatonViewCtrl(model, systemViewCtrl, keys);
        // State tab
        const stateViewOpCtrl = new StateViewOpCtrl(model, systemViewCtrl, keys);
        const stateReachRefinementCtrl = new StateReachRefinementCtrl(model);
        const actionViewCtrl = new ActionViewCtrl(model);
        // System tab
        const analysisViewCtrl = new AnalysisViewCtrl(model, keys);
        const layerRefinementCtrl = new LayerRefinementCtrl(model, keys);
        const systemReachRefinementCtrl = new SystemReachRefinementCtrl(model);
        const snapshotViewCtrl = new SnapshotViewCtrl(model);
        // Control tab
        const traceCtrl = new TraceCtrl(model);
        const traceViewStepCtrl = new TraceViewStepCtrl(model);
        // Info tab
        const systemViewCtrlCtrl = new SystemViewCtrlCtrl(systemViewCtrl, keys);
        const connectivity = new Connectivity(model, systemViewCtrl);
        // Assemble tabs
        const tabs = new TabbedView();
        const stateTab = tabs.newTab("State", [
            stateViewOpCtrl,
            stateReachRefinementCtrl,
            actionViewCtrl
        ]);
        const systemTab = tabs.newTab("System", [
            analysisViewCtrl,
            layerRefinementCtrl,
            systemReachRefinementCtrl,
            snapshotViewCtrl
        ]);
        const controlTab = tabs.newTab("Control", [
            traceCtrl,
            traceViewStepCtrl,
        ]);
        const infoTab = tabs.newTab("Info", [
            systemViewCtrlCtrl,
            connectivity,
            log
        ]);
        tabs.select("System");

        // Highlight Info tab on error to notify user about error message
        log.attach((isError) => {
            if (isError) tabs.highlight("Info");
        });

        // Assemble inspector
        this.node = dom.DIV({ "id": "inspector" }, [
            // System and automaton views on the left
            dom.DIV({ "class": "left" }, [
                systemViewCtrl.node,
                dom.DIV({"class": "cols"}, [
                    dom.DIV({ "class": "left" }, [
                        dom.H3({}, [
                            "Control and Random Space",
                            dom.DIV({ "class": "icons" }, [dom.infoBox("info-control")])
                        ]),
                        controlSpaceView.node, randomSpaceView.node
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
            // Tabs on the right
            tabs.node
        ]);
    }

}


// The ActionData from the worker is translated to a custom ActionData type
// that links the StateIDs to the cached StateData objects
type ActionData = {
    id: ActionID,
    controls: JSONUnion,
    origin: StateData,
    targets: StateData[]
};

// SystemModel notification types
type ModelChange = "state" | "action" | "support" | "trace" | "trace-step" | "system" | "snapshot"; 

// System access, centralized selection storage and change notifications
class SystemModel extends ObservableMixin<ModelChange> {

    +_comm: Communicator<Worker>;
    +log: Logger;
    // Objective does not change
    +objective: Objective;
    // Initial system is kept for predicate and LSS access
    +_system: AbstractedLSS;
    // Caches
    states: StatesData;
    _actions: Map<StateID, ActionData[]>;
    // Automatic snapshot numbering
    _autoSnapID: number;
    // Selections (application state)
    _xState: ?StateData;
    _qState: AutomatonStateID;
    _action: ?ActionData;
    _support: ?SupportData;
    _trace: JSONTraceStep[];
    _traceStep: ?JSONTraceStep;

    constructor(system: AbstractedLSS, objective: Objective, log: Logger, analyseAtStartup: boolean): void {
        super();
        // System model handles all requests to the system worker and also
        // updates the log with analysis, refinement and error messages
        this.log = log;
        // Save the initial system for LSS and predicate accessors (static)
        this._system = system;
        // Save the objective for automaton queries (static)
        this.objective = objective;
        // Setup dedicated worker for system tasks
        try {
            this._comm = new Communicator("ISYS");
            // Worker starts its own initialization process
            this._comm.onRequest("init", (data) => [
                system.serialize(), objective.serialize(), analyseAtStartup
            ]);
            // The worker signals "ready" when everything is set up
            this._comm.onRequest("ready", (data: null) => {
                this.updateStates();
                this.notify("snapshot");
                this.notify("trace");
            });
            const worker = new Worker("./js/inspector-worker-system.js");
            worker.onerror = () => {
                this.log.write(["error"], "unable to start system worker");
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
        // Initialize data caches
        this.states = new Map();
        this._actions = new Map();
        // Start counting from 1
        this._autoSnapID = 1;
        // Initialize selections
        this._xState = null;
        this._qState = objective.automaton.initialState.label;
        this._action = null;
        this._support = null;
        this._trace = [];
        this._traceStep = null;
    }

    // Getters and setters for selections

    get state(): [?StateData, AutomatonStateID] {
        return [this._xState, this._qState];
    }

    set xState(state: ?StateID): void {
        this._xState = (state == null) ? null : just(this.states.get(state));
        this.notify("state");
    }

    set qState(state: AutomatonStateID): void {
        if (!this.objective.automaton.states.has(state)) throw new Error(
            "" // TODO
        );
        this._qState = state;
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

    get trace(): TraceData {
        return this._trace;
    }

    set trace(t: TraceData): void {
        this._trace = t;
        this.notify("trace");
    }

    get traceStep(): ?JSONTraceStep {
        return this._traceStep;
    }

    set traceStep(s: ?JSONTraceStep): void {
        this._traceStep = s;
        this.notify("trace-step");
    }

    // System information convenience accessors (static information)

    get lss(): LSS {
        return this._system.lss;
    }

    get qAll(): Set<AutomatonStateID> {
        return this.objective.allStates;
    }

    getPredicate(label: PredicateID): Halfspace {
        return this._system.getPredicate(label);
    }

    transitionTo(x: StateData, q: AutomatonStateID): ?AutomatonStateID {
        return this.objective.nextState(x.predicates, q);
    }

    // Worker request interface. Occuring errors are logged and re-thrown so
    // they can be handled by the caller too.

    updateStates(): Promise<null> {
        return this._comm.request("update-states", null).then((data: StatesData) => {
            // Update states cache
            this.states = data;
            // Clear action cache
            this._actions = new Map();
            // Re-select the current state if it still exists, drop action and
            // support selection (TODO). Change needs to be propagated to
            // state, action and support selection.
            const xOld = this._xState;
            try {
                this.xState = (xOld == null) ? null : xOld.label;
            } catch {
                this.xState = null;
            }
            this.action = null;
            this.support = null;
            this.notify("system");
            return null;
        })
    }

    getActions(state: StateID): Promise<ActionData[]> {
        const cached = this._actions.get(state);
        // Action is already in the cache
        if (cached != null) return Promise.resolve(cached);
        // Action has to be retrieved from worker
        return this._comm.request("get-actions", state).then((data: ActionsData) => {
            // Translate to own ActionData type
            const actions = data.map((action) => ({
                id: action.id,
                controls: action.controls,
                origin: just(this.states.get(action.origin)),
                targets: action.targets.map(_ => just(this.states.get(_)))
            }));
            // Cache the result
            this._actions.set(state, actions);
            return actions;
        }).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    getSupports(state: StateID, action: ActionID): Promise<SupportData[]> {
        return this._comm.request("get-supports", [state, action]).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    getTrace(controller: string): Promise<TraceData> {
        const [x, qLabel] = this.state;
        const xLabel = x == null ? null : x.label;
        return this._comm.request("get-trace", [controller, xLabel, qLabel]).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    analyse(): Promise<null> {
        return this._comm.request("analyse", null).then((data: AnalysisData) => {
            this.log.writeAnalysis(data);
            // Automatically take a snapshot after an analysis (TODO: only if there was change)
            return this.takeSnapshot("Automatic Snapshot " + (this._autoSnapID++));
        }).then((data) => {
            return this.updateStates();
        }).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    resetAnalysis(): Promise<null> {
        return this._comm.request("reset-analysis", null).then(() => {
            this.log.write(["Analysis"], "Analysis results have been reset.");
            return this.updateStates();
        }).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    refineState(state: StateID, method: string, settings: StateRefinerySettings): Promise<null> {
        return this._comm.request("refine-state", [state, method, settings]).then((data: RefineData) => {
            this.log.writeRefinement([method + " of " + state], data);
            return data.removed.length > 0 ? this.updateStates() : null;
        }).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    refineLayer(settings: LayerRefinerySettings): Promise<null> {
        return this._comm.request("refine-layer", settings).then((data: RefineData) => {
            this.log.writeRefinement([
                "Layers " + settings.range[0] +  "-" + settings.range[1] + " of "
                          + n2s(settings.scaling * 100, 0) + "% " + settings.generator,
                settings.origin + " → " + settings.target,
                pluralize(settings.iterations, "iteration")
            ], data);
            return data.removed.length > 0 ? this.updateStates() : null;
        }).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    refineOuterAttr(settings: OuterAttrRefinerySettings): Promise<null> {
        return this._comm.request("refine-outer-attr", settings).then((data: RefineData) => {
            this.log.writeRefinement([
                "Outer Attr",
                pluralize(settings.iterations, "iteration")
            ], data);
            return data.removed.length > 0 ? this.updateStates() : null;
        }).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    getSystemSummary(): Promise<SystemSummaryData> {
        return this._comm.request("get-system-summary", null).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    getSnapshots(): Promise<SnapshotData> {
        return this._comm.request("get-snapshots", null).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    takeSnapshot(name: string): Promise<TakeSnapshotData> {
        return this._comm.request("take-snapshot", name).then((data) => {
            this.notify("snapshot");
            return data;
        }).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    loadSnapshot(id: number): Promise<null> {
        return this._comm.request("load-snapshot", id).then((data) => {
            this.log.write(
                ["Snapshot"],
                "Loaded snapshot '" + data.name + "' with " + pluralize(data.states, "state") + "."
            );
            this.notify("snapshot");
            return this.updateStates();
        }).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

    nameSnapshot(id: number, name: string): Promise<NameSnapshotData> {
        return this._comm.request("name-snapshot", [id, name]).then((data) => {
            this.notify("snapshot");
            return data;
        }).catch((e) => {
            this.log.writeError(e);
            throw e;
        });
    }

}


// Left Column: Basic Views

type _StateRegionTest = (StateData) => boolean;

// Main view: LSS visualization and state selection
class SystemViewCtrl {

    +node: HTMLDivElement;
    +_model: SystemModel;
    +_plot: InteractivePlot;
    +_layers: { [string]: FigureLayer };
    // View settings and highlights
    _showLabels: boolean;
    _showVectors: boolean;
    _operator: ?string;
    _stateRegion: ?_StateRegionTest;

    constructor(model: SystemModel): void {
        this._model = model;
        this._model.attach((mc) => this.handleModelChange(mc));
        // View settings
        this._showLabels = false;
        this._showVectors = false;
        this._operator = null;
        this._stateRegion = null;
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
            stateRegion:    fig.newLayer({ "stroke": "none", "fill": COLORS.stateRegion }),
            trace:          fig.newLayer({ "stroke": COLORS.trace, "stroke-width": "1.5", "fill": COLORS.trace }),
            traceStep:      fig.newLayer({ "stroke": COLORS.traceStep, "stroke-width": "1.5", "fill": COLORS.traceStep }),
            label:          fig.newLayer({ "font-family": "DejaVu Sans, sans-serif", "font-size": "8pt", "text-anchor": "middle", "transform": "translate(0 3)" }),
            interaction:    fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#FFF", "fill-opacity": "0" })
        };
        this._plot = new InteractivePlot([660, 500], fig, autoProjection(660/500, ...this._model.lss.xx.extent));
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

    set operator(op: ?string): void {
        this._operator = op;
        this.drawOperator();
    }

    set stateRegion(stateRegion: ?_StateRegionTest): void {
        this._stateRegion = stateRegion;
        this.drawStateRegion();
    }

    // Redraw elements when changes happen
    handleModelChange(mc: ?ModelChange): void {
        if (mc === "system") {
            // Redraw interactive states
            const shapes = [];
            for (let [label, state] of this._model.states) {
                // ...
                const click = () => {
                    const [x, _] = this._model.state;
                    this._model.xState = (x != null && label === x.label) ? null : label;
                };
                shapes.push({
                    kind: "polytope", vertices: state.polytope.vertices,
                    events: { "click": click }
                });
            }
            this._layers.interaction.shapes = shapes;
            this.drawAnalysis();
            this.drawLabels();
        } else if (mc === "state") {
            this.drawState();
            this.drawAnalysis();
        } else if (mc === "action") {
            this.drawAction();
        } else if (mc === "support") {
            this.drawSupport();
        } else if (mc === "trace") {
            this.drawTrace();
        } else if (mc === "trace-step") {
            this.drawTraceStep();
        }
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
                origin: action.origin.centroid,
                target: target.centroid
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
        const op = this._operator;
        const lss = this._model.lss;
        const [x, _] = this._model.state;
        let shapes = [];
        // ...
        if (op != null && x != null) {
            const p = Polytope.deserialize(x.polytope);
            let region = Polytope.ofDim(lss.dim).empty();
            // Posterior adapts to action selection and is only drawn for inner
            // states where it makes sense
            if (op === "post") {
                if (!x.isOuter) {
                    const act = this._model.action;
                    const u = (act == null) ? lss.uu : Union.deserialize(act.controls);
                    region = lss.post(p, u);
                }
            // Other operators always use the entire control space
            } else if (op === "pre") {
                region = lss.pre(lss.xx, lss.uu, p);
            } else if (op === "preR") {
                region = lss.preR(lss.xx, lss.uu, p);
            } else if (op === "attr") {
                region = lss.attr(lss.xx, lss.uu, p);
            } else if (op === "attrR") {
                region = lss.attrR(lss.xx, lss.uu, p);
            } else {
                throw new Error("Unknown operator '" + op + "'");
            }
            shapes = region.polytopes.map(_ => ({ kind: "polytope", vertices: _.vertices }));
        }
        this._layers.highlight1.shapes = shapes;
        this._layers.highlight2.shapes = shapes;
    }

    drawAnalysis(): void {
        // Show analysis in currently selected automaton state
        const [_, q] = this._model.state;
        const shapes = [];
        for (let state of this._model.states.values()) {
             shapes.push({
                kind: "polytope",
                vertices: state.polytope.vertices,
                style: { fill: stateColor(state, q) }
            });
        }
        this._layers.kind.shapes = shapes;
    }

    drawLabels(): void {
        let shapes = [];
        if (this._showLabels) {
            for (let [label, state] of this._model.states) {
                shapes.push({
                    kind: "label",
                    coords: state.centroid,
                    text: state.label
                });
            }
        }
        this._layers.label.shapes = shapes;
    }

    drawVectors(): void {
        const shapes = [];
        if (this._showVectors) {
            shapes.push({
                kind: "vectorField",
                fun: (x) => linalg.apply(this._model.lss.A, x),
                scaling: 0.25,
                n: [12, 12]
            });
        }
        this._layers.vectorField.shapes = shapes;
    }

    drawStateRegion(): void {
        const shapes = [];
        const test = this._stateRegion;
        if (test != null) {
            for (let state of this._model.states.values()) {
                if (test(state)) shapes.push({
                    kind: "polytope",
                    vertices: state.polytope.vertices
                });
            }
        }
        this._layers.stateRegion.shapes = shapes;
    }

    drawTrace(): void {
        this._layers.trace.shapes = this._model.trace.map((step) => ({
            kind: "arrow", origin: step.xOrigin[0], target: step.xTarget[0]
        }));
    }

    drawTraceStep(): void {
        const step = this._model.traceStep;
        this._layers.traceStep.shapes = step == null ? [] : [{
            kind: "arrow", origin: step.xOrigin[0], target: step.xTarget[0]
        }];
    }

    toExportURL(): string {
        const data = [];
        for (let [label, state] of this._model.states) {
            data.push([
                state.polytope,
                [this._showLabels, label],
                [false, "#FFFFFF"],
                [true, "#000000"]
            ]);
        }
        return window.btoa(JSON.stringify(data));
        // TODO: also export operator, selection, analysis colors, ...
    }

}


class ControlSpaceView {

    +node: HTMLDivElement;
    +_model: SystemModel;
    +_layers: { [string]: FigureLayer };

    constructor(model: SystemModel): void {
        this._model = model;
        this._model.attach((mc) => this.handleModelChange(mc));
        const fig = new Figure();
        this._layers = {
            poly:   fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#FFF" }),
            action: fig.newLayer({ "stroke": COLORS.action, "fill": COLORS.action }),
            trace:  fig.newLayer({ "stroke": COLORS.traceStep, "fill": COLORS.traceStep })
        };
        const uu = this._model.lss.uu;
        this._layers.poly.shapes = uu.polytopes.map((u) => ({ kind: "polytope", vertices: u.vertices }));
        const proj = autoProjection(1, ...uu.extent);
        const plot = new AxesPlot([120, 120], fig, proj);
        this.node = dom.DIV({ "id": "control-space-view" }, [plot.node]);
    }

    handleModelChange(mc: ?ModelChange): void {
        if (mc === "action") {
            const action = this._model.action;
            if (action == null) {
                this._layers.action.shapes = [];
            } else {
                this._layers.action.shapes = action.controls.polytopes.map(
                    poly => ({ kind: "polytope", vertices: poly.vertices })
                );
            }
        } else if (mc === "trace-step") {
            const step = this._model.traceStep;
            this._layers.trace.shapes = step == null ? [] : [{
                kind: "marker", size: 3, coords: step.u
            }];
        }
    }

}


class RandomSpaceView {

    +node: HTMLDivElement;
    +_model: SystemModel;
    +_layers: { [string]: FigureLayer };

    constructor(model: SystemModel): void {
        this._model = model;
        this._model.attach((mc) => this.handleModelChange(mc));
        const fig = new Figure();
        this._layers = {
            poly:   fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#FFF" }),
            trace:  fig.newLayer({ "stroke": COLORS.traceStep, "fill": COLORS.traceStep })
        };
        const ww = this._model.lss.ww;
        this._layers.poly.shapes = [{ kind: "polytope", vertices: ww.vertices }];
        const proj = autoProjection(1, ...ww.extent);
        const plot = new AxesPlot([120, 120], fig, proj);
        this.node = dom.DIV({ "id": "random-space-view" }, [plot.node]);
    }

    handleModelChange(mc: ?ModelChange): void {
        if (mc !== "trace-step") return;
        const step = this._model.traceStep;
        this._layers.trace.shapes = step == null ? [] : [{
            kind: "marker", size: 3, coords: step.w
        }];
    }

}


class AutomatonViewCtrl {

    +node: HTMLDivElement;
    +_model: SystemModel;
    +_shapes: AutomatonShapeCollection;
    +_layers: { [string]: FigureLayer };

    constructor(model: SystemModel, systemViewCtrl: SystemViewCtrl, keys: dom.Keybindings): void {
        this._model = model;
        this._model.attach((mc) => this.handleModelChange(mc));
        const objective = this._model.objective;
        const init = objective.automaton.initialState.label;
        // Plot the objective automaton
        const fig = new Figure();
        this._shapes = objective.toShapes();
        this._layers = {
            // State and transition labels are offset by 4px to achieve
            // vertical centering
            transitionLabels: fig.newLayer({
                "font-family": "serif", "font-size": "10pt", "transform": "translate(0 4)",
                "cursor": "default", "class": "transition-labels"
            }),
            stateLabels: fig.newLayer({
                "font-family": "DejaVu Sans, sans-serif", "font-size": "10pt",
                "text-anchor": "middle", "transform": "translate(0 4)"
            }),
            transitions: fig.newLayer({
                "fill": "#000", "stroke": "#000", "stroke-width": "2"
            }),
            traceStep: fig.newLayer({
                "fill": COLORS.traceStep, "stroke": COLORS.traceStep, "stroke-width": "2"
            }),
            states: fig.newLayer({
                "fill": "#FFF", "fill-opacity": "0", "stroke": "#000", "stroke-width": "2"
            })
        };
        // Display the automaton plot
        const extent = just(this._shapes.extent, "No automaton plot extent given by objective");
        // Padding is introduced by Objective.toShapes, don't use
        // autoProjection which would add even more (relative) padding
        const proj = new Cartesian2D(...extent);
        // Width is given by layout, height scales with automaton extent
        const width = Math.abs(extent[0][1] - extent[0][0]);
        const height = Math.abs(extent[1][1] - extent[1][0]);
        const plot = new ShapePlot([330, (330 / width) * height], fig, proj, false);
        // Assemble
        this.node = dom.DIV({ "id": "automaton-view-ctrl" }, [
            plot.node,
            // Initial state information
            dom.P({}, [
                dom.create("u", {}, ["I"]), "nitial state: ", dom.snLabel.toHTML(init)
            ])
        ]);
        // Keybindings
        keys.bind("i", () => { this._model.qState = init; });
        // Draw labels once now, they never change
        this._layers.stateLabels.shapes = iter.map(_ => _[1], this._shapes.states.values());
        // Transitions have to be flattened
        const ts = [];
        for (let [q, transitions] of this._shapes.transitions) {
            const qState = this._model.objective.getState(q);
            for (let [qNext, shapes] of transitions) {
                const qNextState = this._model.objective.getState(qNext);
                const highlighter = (x: StateData) => {
                    const valuation = this._model.objective.valuationFor(x.predicates);
                    const proposition = qState.proposition(qNextState);
                    return !x.isOuter && proposition != null && proposition.evalWith(valuation);
                };
                const t = obj.clone(shapes[1]);
                t.events = {
                    "mouseover": () => { systemViewCtrl.stateRegion = highlighter },
                    "mouseout": () => { systemViewCtrl.stateRegion = null; }
                };
                ts.push(t);
            }
        }
        this._layers.transitionLabels.shapes = ts;
        // Transition arrows and state circles can be highlighted later, so
        // they have separate draw method
        this.draw();
    }

    handleModelChange(mc: ?ModelChange): void {
        if (mc === "state") {
            this.draw();
        } else if (mc === "trace-step") {
            this.drawTraceStep();
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

    drawTraceStep(): void {
        const step = this._model.traceStep;
        if (step == null) {
            this._layers.traceStep.shapes = [];
        } else {
            const transitions = just(
                this._shapes.transitions.get(step.xOrigin[2]),
                "Trace takes transition which does not exist: " + step.xOrigin[2] + " → " + step.xTarget[2]
            );
            const shapes = just(
                transitions.get(step.xTarget[2]),
                "Trace takes transition which does not exist: " + step.xOrigin[2] + " → " + step.xTarget[2]
            );
            this._layers.traceStep.shapes = [shapes[0]];
        }
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
        const tab = just(this._tabs.get(name));
        dom.replaceChildren(this._content, tab.children);
        tab.title.className = "selection";
        this._selection = tab;
    }

    highlight(name: string): void {
        const tab = just(this._tabs.get(name));
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


// Widget base class that implements common functionality:
// - Title with info box and loading icons
// - Request counter linked to the loading icon display
class WidgetPlus implements TabWidget {

    +node: HTMLDivElement;
    +heading: HTMLHeadingElement;
    +_icons: HTMLElement[];
    // Request counter
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
        this.node = dom.DIV();
    }

    get isLoading(): boolean {
        return this._isLoading > 0;
    }

    // Increment the request counter and show loading icon
    pushLoad(): void {
        this._isLoading++;
        if (this._isLoading === 1) this.handleLoadingChange();
    }
    
    // Decrease the request counter and hide loading icon if no request is left
    popLoad(): void {
        this._isLoading--;
        if (this._isLoading === 0) this.handleLoadingChange();
    }

    handleLoadingChange(): void {
        this._icons[0].style.display = this.isLoading ? "inline-block" : "none";
    }

}


// Tab: Game
// - StateViewOpCtrl
// - StateReachRefinementCtrl
// - ActionViewCtrl

class StateViewOpCtrl extends WidgetPlus {

    +_model: SystemModel;
    +_lines: HTMLDivElement[];

    constructor(model: SystemModel, systemViewCtrl: SystemViewCtrl, keys: dom.Keybindings): void {
        super("Selection", "info-state");
        this._model = model;
        this._model.attach((mc) => this.handleModelChange(mc));
        // Operator highlight
        const operator = new DropdownInput({
            "None": null,
            "Posterior": "post",
            "Predecessor": "pre",
            "Robust Predecessor": "preR",
            "Attractor": "attr",
            "Robust Attractor": "attrR"
        }, "None");
        operator.attach(() => {
            systemViewCtrl.operator = operator.value;
        });
        this._lines = [dom.DIV(), dom.DIV(), dom.DIV()];
        // Assemble
        this.node = dom.DIV({ "id": "state-view" }, [
            dom.DIV({ "class": "div-table" }, [
                dom.DIV({ "class": "rowspan" }, [dom.DIV({}, ["State:"]), this._lines[0]]),
                dom.DIV({ "class": "rowspan" }, [dom.DIV({}, ["Analysis:"]), this._lines[1]]),
                dom.DIV({}, [dom.DIV({}, ["Predicates:"]), this._lines[2]])
            ]),
            dom.P({ "class": "highlight" }, [operator.node])
        ]);
        // Keybindings
        keys.bind("o", inputTextRotation(operator, [
            "None", "Posterior", "Predecessor", "Robust Predecessor", "Attractor", "Robust Attractor"
        ]));
    }

    handleModelChange(mc: ?ModelChange): void {
        if (mc !== "state") return;
        const [x, q] = this._model.state;
        if (x != null) {
            const analysis = x.analysis;
            // Line 1: system and automaton labels, transition information
            const qNext = this._model.transitionTo(x, q);
            const text = [dom.SPAN({ "class": "selection" }, [
                dom.snLabel.toHTML(x.label), ", ", dom.snLabel.toHTML(q)
            ])];
            if (x.isOuter) {
                text.push(" (outer state)");
            } else if (analysisKind(q, analysis) === "unreachable") {
                text.push(" (unreachable state)");
            } else if (qNext == null) {
                text.push(" (dead end state)");
            } else {
                text.push(" (transition to ", automatonLabel(qNext, null), ")");
            }
            dom.replaceChildren(this._lines[0], text); 
            // Line 2: analysis kinds
            if (analysis == null) {
                dom.replaceChildren(this._lines[1], ["?"]);
            } else {
                dom.replaceChildren(this._lines[1], arr.intersperse(
                    ", ", iter.map(_ => automatonLabel(_, analysis), this._model.qAll)
                ));
            };
            // Line 3: linear predicates
            dom.replaceChildren(this._lines[2], x.predicates.size < 1 ? ["-"] : arr.intersperse(
                ", ", iter.map(_ => predicateLabel(_, this._model.getPredicate(_)), x.predicates)
            ));
        } else {
            for (let line of this._lines) dom.replaceChildren(line, ["-"]);
        }
    }

}


class StateReachRefinementCtrl extends WidgetPlus {

    +_model: SystemModel;
    +_negAttr: HTMLButtonElement;
    +_posAttrR: HTMLButtonElement;
    +_approximation: Input<StateRefineryApproximation>;

    constructor(model: SystemModel): void {
        super("Reachability Refinement", "info-state-reach-refinement");
        this._model = model;
        this._model.attach((mc) => this.handleModelChange(mc));
        this._negAttr = dom.createButton({}, ["Attr-"], () => this.refine("Attr-"));
        this._posAttrR = dom.createButton({}, ["AttrR+"], () => this.refine("AttrR+"));
        this._approximation = new DropdownInput({
            "no approximation": "none",
            "hull approximation": "hull"
        }, "no approximation");
        this.node = dom.DIV({}, [
            dom.P({}, [this._negAttr, " ", this._posAttrR, " with ", this._approximation.node])
        ]);
    }

    // Refinement is only enabled for states if they have analysis information
    // available and have not beed decided yet
    get canRefine(): boolean {
        const [x, q] = this._model.state;
        return x != null && x.analysis != null && x.analysis.maybe.has(q);
    }

    handleModelChange(mc: ?ModelChange): void {
        if (mc !== "state") return;
        const canRefine = this.canRefine;
        this._negAttr.disabled = !canRefine;
        this._posAttrR.disabled = !canRefine;
    }

    refine(method: string): void {
        if (this.isLoading || !this.canRefine) return;
        const [x, q] = this._model.state;
        if (x == null) throw new Error("canRefine is true but x is null");
        const settings = {
            q: q,
            approximation: this._approximation.value
        };
        this.pushLoad();
        this._model.refineState(x.label, method, settings).catch(() => {
            // Error logging is done in SystemModel
        }).finally(() => {
            this.popLoad();
        });
    }

}


// List actions available for the selected state and supports for the currently
// selected action.
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
        this._model.attach((mc) => this.handleModelChange(mc));
        this._action = null;
        this._actions = [];
        this._actionNodes = new Map();
        this._supports = [];
        this._supportNode = dom.DIV({ "id": "supports" });
        this.node = dom.DIV({ "id": "action-view" });
    }

    handleModelChange(mc: ?ModelChange): void {
        // TODO: this should be able to handle action changes that come from
        // somewhere other than itself
        if (mc === "state") {
            const [x, q] = this._model.state;
            if (x == null || x.isOuter
                          || this._model.transitionTo(x, q) == null
                          || analysisKind(q, x.analysis) === "unreachable") {
                dom.replaceChildren(this.node, ["-"]);
            } else {
                this.pushLoad();
                // Clear displayed actions
                dom.replaceChildren(this.node, []);
                // Load actions from model
                this._model.getActions(x.label).then((actions) => {
                    // Only update if state has not changed since
                    if (this._model.state[0] !== x) return;
                    this._actionNodes = new Map(actions.map(_ => [_, this.actionToNode(_)]));
                    dom.replaceChildren(this.node, this._actionNodes.values());
                }).catch((e) => {
                    // Error logging is done in SystemModel
                }).finally(() => {
                    this.popLoad();
                });
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
                    // Error logging is done in SystemModel
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
// - LayerRefinementCtrl
// - SnapshotViewCtrl


class AnalysisViewCtrl extends WidgetPlus{

    +_model: SystemModel;
    +_analyse: HTMLButtonElement;
    +_reset: HTMLButtonElement;
    +_info: HTMLSpanElement;
    _bar: HTMLDivElement;
    _summary: ?SystemSummaryData;

    constructor(model: SystemModel, keys: dom.Keybindings): void {
        super("Analysis", "info-analysis");
        this._model = model;
        this._model.attach((mc) => this.handleModelChange(mc));
        // Button to start analysis
        this._analyse = dom.createButton({}, [
            dom.create("u", {}, ["a"]), "nalyse"
        ], () => this.analyse());
        // Button to reset analysis results
        this._reset = dom.createButton({}, ["reset"], () => this.reset());
        // Text information display
        this._info = dom.SPAN({ "class": "count-stats" });
        // Progress bar
        this._bar = percentageBar({ "please wait...": 1 });
        // Widget
        this.node = dom.DIV({ "id": "analysis-view-ctrl"}, [
            dom.P({}, [this._analyse, " ", this._reset, this._info]),
            this._bar
        ]);
        keys.bind("a", () => this.analyse());
    }

    analyse(): void {
        if (this.isLoading) return;
        this.pushLoad();
        this._model.analyse().catch((e) => {
            // Error logging is done in SystemModel
        }).finally(() => {
            this.popLoad();
        });
    }

    reset(): void {
        if (this.isLoading) return;
        this.pushLoad();
        this._model.resetAnalysis().catch((e) => {
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
        const nodes = [];
        if (count.yes > 0) nodes.push(
            dom.SPAN({ "class": "yes", "title": "yes" }, [count.yes.toString()])
        );
        if (count.maybe > 0) nodes.push(
            dom.SPAN({ "class": "maybe", "title": "maybe" }, [count.maybe.toString()])
        );
        if (count.no > 0) nodes.push(
            dom.SPAN({ "class": "no", "title": "no" }, [count.no.toString()])
        );
        if (count.unreachable > 0) nodes.push(
            dom.SPAN({ "class": "unreachable", "title": "unreachable" }, [count.unreachable.toString()])
        );
        dom.replaceChildren(this._info, [
            automatonLabel(q), " :: ",
            ...arr.intersperse(" + ", nodes), " = ", pluralize(totalCount, "state")
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
                // Error logging is done in SystemModel
            }).finally(() => {
                this.popLoad();
            });
        } else if (mc == "state") {
            this.handleChange();
        }
    }
    
    handleLoadingChange(): void {
        super.handleLoadingChange();
        this._analyse.disabled = this.isLoading;
        this._reset.disabled = this.isLoading;
    }

}


class LayerRefinementCtrl extends WidgetPlus {

    +_model: SystemModel;
    // Form elements
    +_origin: OptionsInput<AutomatonStateID>;
    +_target: OptionsInput<AutomatonStateID>;
    +_generator: OptionsInput<LayerRefineryGenerator>;
    +_scale: OptionsInput<number>;
    +_rangeStart: OptionsInput<number>;
    +_rangeEnd: OptionsInput<number>;
    +_iterations: OptionsInput<number>;
    +_dontRefineSmall: Input<boolean>;
    +_button: HTMLButtonElement;

    constructor(model: SystemModel, keys: dom.Keybindings): void {
        super("Layer Refinement", "info-layer-refinement");
        this._model = model;
        // Origin and target automaton state selection
        const automaton = model.objective.automaton;
        const qAllObj = obj.fromMap(_ => _, model.qAll)
        this._origin = new RadioInput(qAllObj, automaton.initialState.label, automatonLabel);
        this._target = new RadioInput(qAllObj, automaton.initialState.label, automatonLabel);
        // Layer generating function
        this._generator = new DropdownInput({
            "Predecessor": "Pre",
            "Robust Predecessor": "PreR",
        }, "Robust Predecessor");
        this._scale = new DropdownInput(DropdownInput.rangeOptions(80, 125, 5), "95");
        this._rangeStart = new DropdownInput(DropdownInput.rangeOptions(1, 10, 1), "1");
        this._rangeEnd = new DropdownInput({ "9": 9 }, "9");
        this._iterations = new DropdownInput(DropdownInput.rangeOptions(0, 10, 1), "2");
        this._dontRefineSmall = new CheckboxInput(true, "don't refine small polytopes");
        // Assemble
        this._button = dom.createButton({}, ["refine"], () => this.refine())
        this.node = dom.DIV({"id": "layer-refinement-ctrl" }, [
            dom.DIV({ "class": "div-table" }, [
                dom.DIV({}, [
                    dom.DIV({}, ["Origin:"]),
                    dom.DIV({}, [this._origin.node])
                ]),
                dom.DIV({}, [
                    dom.DIV({}, ["Target:"]),
                    dom.DIV({}, [this._target.node])
                ]),
                dom.DIV({ "class": "rowspan" }, [
                    dom.DIV({}, ["Layers:"]),
                    dom.DIV({}, [this._rangeStart.node, " to ", this._rangeEnd.node, " of ", this._generator.node])
                ]),
                dom.DIV({}, [
                    dom.DIV(),
                    dom.DIV({}, ["scale generating ", dom.renderTeX("U", dom.SPAN()), " to ", this._scale.node, "%"])
                ]),
                dom.DIV({ "class": "rowspan" }, [
                    dom.DIV({}, ["Inner:"]),
                    dom.DIV({}, [this._iterations.node, " iteration(s) of AttrR+ refinement"]),
                ]),
                dom.DIV({}, [
                    dom.DIV(),
                    dom.DIV({}, [this._dontRefineSmall.node])
                ])
            ]),
            dom.P({}, [this._button])
        ]);
        // Adapt upper end of layer range to lower end
        this._rangeStart.attach(() => this.handleRangeChange(), true);
    }

    refine(): void {
        if (this.isLoading) return;
        this.pushLoad();
        this._model.refineLayer({
            origin: this._origin.value,
            target: this._target.value,
            generator: this._generator.value,
            scaling: (this._scale.value / 100),
            range: [this._rangeStart.value, this._rangeEnd.value],
            iterations: this._iterations.value,
            dontRefineSmall: this._dontRefineSmall.value
        }).catch(() => {
            // Error logging is done in SystemModel
        }).finally(() => {
            this.popLoad();
        });
    }

    handleLoadingChange(): void {
        super.handleLoadingChange();
        this._button.disabled = this.isLoading;
    }

    handleRangeChange(): void {
        const lower = this._rangeStart.value;
        const upper = this._rangeEnd.value;
        const init = String(Math.max(lower, upper));
        this._rangeEnd.setOptions(DropdownInput.rangeOptions(lower, 10, 1), init);
    }

}


class SystemReachRefinementCtrl extends WidgetPlus {

    +_model: SystemModel;
    +_origin: Input<AutomatonStateID>;
    +_outerAttr: HTMLButtonElement;
    +_outerAttrIterations: OptionsInput<number>;

    constructor(model: SystemModel): void {
        super("Reachability Refinement", "info-system-reach-refinement");
        this._model = model;
        // Negative Attractor
        this._outerAttr = dom.createButton({}, ["Outer Attr"], () => this.refineOuterAttr());
        this._outerAttrIterations = new DropdownInput(DropdownInput.rangeOptions(1, 10, 1), "5");
        // TODO: Positive Static Control
        // Assemble
        this.node = dom.DIV({}, [
            dom.P({}, [this._outerAttr, " with ", this._outerAttrIterations.node, " iteration(s)"])
        ]);
    }

    refineOuterAttr(): void {
        this.pushLoad();
        this._model.refineOuterAttr({
            iterations: this._outerAttrIterations.value
        }).catch(() => {
            // Error logging is done in SystemModel
        }).finally(() => {
            this.popLoad();
        });
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
        this._model.attach((mc) => this.handleModelChange(mc));
        // Widget: menu bar with tree-structure view below
        this._forms = {
            take:   dom.createButton({}, ["new"], () => this.takeSnapshot()),
            load:   dom.createButton({}, ["load"], () => this.loadSnapshot()),
            rename: dom.createButton({}, ["rename"], () => this.renameSnapshot()),
            name:   dom.INPUT({ "type": "text", "placeholder": "Snapshot", "size": "25" })
        };
        this._treeView = dom.DIV({ "class": "tree" });
        this.node = dom.DIV({ "id": "snapshot-ctrl"}, [
            dom.P({}, [
                this._forms.take, " ", this._forms.name,
                dom.DIV({ "class": "right" }, [this._forms.rename, " ", this._forms.load])
            ]),
            this._treeView
        ]);
        // Ready-message from worker in proxy triggers first handleModelChange
        // call and initializes the state variables
        this._data = null;
        this._selection = null;
        this.handleLoadingChange();
    }

    takeSnapshot(): void {
        const name = this._forms.name.value.trim();
        this._forms.name.value = "";
        this.pushLoad();
        this._model.takeSnapshot(name.length === 0 ? "Snapshot" : name).catch((e) => {
            // Error logging is done in SystemModel
        }).finally(() => {
            this.popLoad();
        });
    }

    loadSnapshot(): void {
        const id = this._selection;
        if (id != null) {
            this.pushLoad();
            this._model.loadSnapshot(id).catch((e) => {
                // Error logging is done in SystemModel
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
                // Error logging is done in SystemModel
            }).finally(() => {
                this.popLoad();
            });
        }
    }

    handleModelChange(mc: ?ModelChange): void {
        if (mc !== "snapshot") return;
        this.pushLoad();
        this._model.getSnapshots().then((data) => {
            this._data = data;
            this.redraw();
        }).catch((e) => {
            // Error logging is done in SystemModel
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
            dom.SPAN({}, [pluralize(snapshot.states, "state")])
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
// - TraceCtrl
// - TraceViewStepCtrl
// - TraceStepView

class TraceCtrl extends WidgetPlus {

    +_model: SystemModel;
    +_initial: HTMLSpanElement;

    constructor(model: SystemModel): void {
        super("Sample Trace", "info-trace-sample");
        this._model = model;
        this._model.attach((mc) => this.handleModelChange(mc));
        // Initial state display
        this._initial = dom.SPAN();
        // Control elements
        const controller = new DropdownInput({
            "Round-robin Controller": "round-robin",
            "Random Controller": "random"
        }, "Round-robin Controller");
        const sampleButton = dom.createButton({}, ["sample"], () => {
            this.pushLoad();
            this._model.getTrace(controller.value).then((data: TraceData) => {
                this._model.trace = data;
            }).catch((e) => {
                // ...
            }).finally(() => {
                this.popLoad();
            });
        });
        const clearButton = dom.createButton({}, ["clear"], () => {
            this._model.trace = [];
        });
        this.node = dom.DIV({}, [
            dom.P({}, ["Starting from ", this._initial, ":"]),
            dom.P({}, [controller.node, " ", sampleButton, " ", clearButton])
        ]);
    }

    handleModelChange(mc: ?ModelChange): void {
        if (mc != "state") return;
        const [x, q] = this._model.state;
        dom.replaceChildren(this._initial, x == null
            ? [dom.snLabel.toHTML(q)]
            : [dom.snLabel.toHTML(q), " in ", dom.snLabel.toHTML(x.label)]
        );
    }

}


class TraceViewStepCtrl extends WidgetPlus {

    +_model: SystemModel;
    +_layers: { [string]: FigureLayer };

    constructor(model: SystemModel): void {
        super("Trace", "info-trace");
        this._model = model;
        this._model.attach((mc) => this.handleModelChange(mc));
        const fig = new Figure();
        this._layers = {
            arrows: fig.newLayer({ "stroke": COLORS.trace, "stroke-width": "1.5", "fill": COLORS.trace }),
            step:   fig.newLayer({ "stroke": COLORS.traceStep, "stroke-width": "1.5", "fill": COLORS.traceStep }),
            states: fig.newLayer({ "font-family": "DejaVu Sans, sans-serif", "font-size": "8pt", "text-anchor": "middle" }),
            hovers: fig.newLayer({ "stroke": "none", "fill": "#FFF", "fill-opacity": "0" })
        };
        const proj = new Cartesian2D([-0.5, 15.5], [-4.7, 0.3]);
        const plot = new ShapePlot([480, 250], fig, proj, false);
        this.node = dom.DIV({}, [
            plot.node
        ]);
    }

    handleModelChange(mc: ?ModelChange): void {
        if (mc != "trace") return;
        const trace = this._model.trace;
        const arrows = [];
        const states = [];
        const hovers = [];
        if (trace.length > 0) {
            arrows.push({ kind: "arrow", origin: [0, 0], target: [0, 0] });
            states.push({ kind: "label", coords: [0, -0.35], text: trace[0].xOrigin[2] });
        }
        for (let i = 0; i < trace.length; i++) {
            const step = trace[i];
            const x = i % 15;
            const y = -Math.floor(i / 15);
            arrows.push({ kind: "arrow", origin: [x, y], target: [x + 1, y] });
            hovers.push({
                kind: "polytope",
                vertices: [[x, y + 0.3], [x + 1, y + 0.3], [x + 1, y - 0.3], [x, y - 0.3]],
                events: {
                    "mouseover": () => this.highlightStep(step, x, y),
                    "mouseout": () => this.highlightStep(null, 0, 0)
                }
            });
            if (step.xOrigin[2] !== step.xTarget[2]) {
                states.push({ kind: "label", coords: [x + 1, y - 0.35], text: step.xTarget[2] });
            }
        }
        this._layers.arrows.shapes = arrows;
        this._layers.hovers.shapes = hovers;
        this._layers.states.shapes = states;
    }

    highlightStep(step: ?JSONTraceStep, x: number, y: number): void {
        this._layers.step.shapes = step == null ? [] : [{
            kind: "arrow", origin: [x, y], target: [x + 1, y]
        }];
        this._model.traceStep = step;
    }

}



// Tab: Info
// - SystemViewCtrlCtrl
// - Logger

// Settings panel for the main view
class SystemViewCtrlCtrl extends WidgetPlus {

    constructor(systemViewCtrl: SystemViewCtrl, keys: dom.Keybindings): void {
        super("View Settings", "info-view-settings");
        // State label toggle
        const labels = new CheckboxInput(false, dom.SPAN({}, [
            "State ", dom.create("u", {}, ["L"]), "abels"
        ]));
        labels.attach(() => {
            systemViewCtrl.showLabels = labels.value;
        });
        // Vector field toggle
        const vectors = new CheckboxInput(false, dom.SPAN({}, [
            dom.create("u", {}, ["V"]), "ector Field"
        ]));
        vectors.attach(() => {
            systemViewCtrl.showVectors = vectors.value;
        });
        // Assemble
        this.node = dom.DIV({}, [
            dom.P({}, [labels.node, vectors.node])
        ]);
        // Keybindings
        keys.bind("l", inputTextRotation(labels, ["t", "f"]));
        keys.bind("v", inputTextRotation(vectors, ["t", "f"]));
    }

}


// Export to other applications
class Connectivity extends WidgetPlus {

    constructor(model: SystemModel, systemViewCtrl: SystemViewCtrl): void {
        super("Connectivity", "info-connectivity");
        // Open polytopic calculator with basic problem setup loaded
        const calculator = dom.createButton({}, ["Polytopic Calculator"], () => {
            const [y, _] = model.state;
            const calcData = {
                "A": JSON.stringify(model.lss.A),
                "B": JSON.stringify(model.lss.B),
                "X": JSON.stringify(model.lss.xx.vertices),
                "U": JSON.stringify(model.lss.uu.polytopes[0].vertices),
                "Y": (y == null) ? "" : JSON.stringify(y.polytope.vertices),
                "W": JSON.stringify(model.lss.ww.vertices)
            };
            window.open("polytopic-calculator.html#" + window.btoa(JSON.stringify(calcData)));
        });
        // Open view in plotter-2d if dimension matches
        const plotter2d = dom.createButton({}, ["Plotter 2D"], () => {
            window.open("plotter-2d.html#" + systemViewCtrl.toExportURL());
        });
        plotter2d.disabled = (model.lss.dim !== 2); // only for 2-dimensional systems
        // Assemble
        this.node = dom.DIV({}, [
            dom.P({}, [calculator, " ", plotter2d])
        ]);
    }

}


class Logger extends ObservableMixin<boolean> implements TabWidget {

    +node: HTMLDivElement;
    +heading: HTMLHeadingElement;
    +_filters: { [string]: Input<boolean> };
    +_entries: HTMLDivElement;

    constructor(): void {
        super();
        this._filters = {
            analysis: new CheckboxInput(true, "Analysis"),
            refinement: new CheckboxInput(true, "Refinement"),
            snapshot: new CheckboxInput(true, "Snapshot"),
            error: new CheckboxInput(true, "Error")
        };
        obj.forEach((_, input) => input.attach(() => this.handleFilterChange()), this._filters);
        this._entries = dom.DIV()
        this.node = dom.DIV({ "id": "logger" }, [
            dom.P({ "class": "log-filter" }, [
                this._filters.analysis.node,
                this._filters.refinement.node,
                this._filters.snapshot.node,
                this._filters.error.node
            ]),
            this._entries
        ]);
        this.heading = dom.H3({}, ["Log Messages"]);
        this.handleFilterChange();
    }

    _write(params: string[], content: HTMLDivElement): void {
        content.className = "log-content";
        const attrs = params.length === 0 ? {} : {
            "class": "log-" + params[0].toLowerCase()
        };
        const now = new Date(Date.now());
        const entry = dom.DIV(attrs, [
            dom.DIV({ "class": "log-heading" }, [now.toLocaleTimeString(), " :: ", params.join(" :: ")]),
            content
        ]);
        this._entries.insertBefore(entry, this._entries.firstChild);
        this.notify(params.length > 0 && params[0] === "Error");
    }

    write(params: string[], text: string): void {
        this._write(params, dom.DIV({}, [text]));
    }

    writeError(e: Error): void {
        console.log(e);
        this.write(["Error"], e.message);
    }

    writeAnalysis(data: AnalysisData): void {
        this._write(["Analysis"], dom.DIV({}, [
            "game abstraction (" + t2s(data.tGame) + "), analysis (" + t2s(data.tAnalysis) + ")."
        ]));
    }

    writeRefinement(params: string[], data: RefineData): void {
        this._write(["Refinement", ...params], dom.DIV({}, [
            "Removed ", dom.SPAN({ "title": data.removed.join(", ") }, [
                pluralize(data.removed.length, "state")
            ]), ".", dom.create("br"),
            "Created ", dom.SPAN({ "title": data.created.join(", ") }, [
                pluralize(data.created.length, "state")
            ]), ".", dom.create("br"),
            "Elapsed time: " + t2s(data.elapsed) + "."
        ]));
    }
    
    handleFilterChange(): void {
        let cls = "log-entries";
        for (let kind in this._filters) {
            if (!this._filters[kind].value) {
                cls += " hide-" + kind;
            }
        }
        this._entries.className = cls;
    }

}

