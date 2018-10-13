// @flow
"use strict";

import type { Vector, Matrix } from "./linalg.js";
import type { JSONConvexPolytopeUnion, Halfspace } from "./geometry.js";
import type { AbstractedLSS, LSS, StateID, ActionID, PredicateID } from "./system.js";
import type { FigureLayer } from "./figure.js";
import type { Plot } from "./widgets-plot.js";
import type { Input } from "./widgets-input.js";
import type { StateData, StateDataPlus, ActionData, SupportData, OperatorData, TraceData,
              GameGraphData, UpdateKindsData, RefineData, TakeSnapshotData, LoadSnapshotData,
              NameSnapshotData, SnapshotData } from "./inspector-worker-system.js";

import * as linalg from "./linalg.js";
import * as dom from "./dom.js";
import { Communicator } from "./worker.js";
import { arr, n2s, t2s, replaceAll, ObservableMixin } from "./tools.js";
import { union } from "./geometry.js";
import { Objective, stringifyProposition, texifyProposition } from "./logic.js";
import { State } from "./system.js";
import { Figure, autoProjection, Horizontal1D } from "./figure.js";
import { InteractivePlot, AxesPlot, ShapePlot } from "./widgets-plot.js";
import { CheckboxInput, SelectInput, SelectableNodes, inputTextRotation } from "./widgets-input.js";


export const VAR_NAMES = "xy";

export const COLORS = {
    satisfying: "#093",
    nonSatisfying: "#CCC",
    undecided: "#FFF",
    selection: "#069",
    highlight: "#FC0",
    support: "#09C",
    action: "#000",
    predicate: "#000",
    split: "#C00",
    vectorField: "#333",
    trace: "#000"
};

const MARKED_STEP_STYLE = { "stroke": "#C00", "fill": "#C00" };

export const TRACE_LENGTH = 35;


function stateColor(state: StateData): string {
    let fill = COLORS.undecided;
    if (State.isSatisfying(state)) {
        fill = COLORS.satisfying;
    } else if (State.isNonSatisfying(state)) {
        fill = COLORS.nonSatisfying;
    }
    return fill;
}

function stateKindString(state: StateData): string {
    if (State.isSatisfying(state)) {
        return "satisfying";
    } else if (State.isOuter(state)) {
        return "outer";
    } else if (State.isNonSatisfying(state)) {
        return "non-satisfying";
    } else {
        return "undecided";
    }
}

function styledStateLabel(state: StateData, markSelected?: ?StateData): HTMLSpanElement {
    let attributes = {};
    if (markSelected != null && markSelected.label === state.label) {
        attributes["class"] = "selected";
    } else if (State.isSatisfying(state)) {
        attributes["class"] = "satisfying";
    } else if (State.isNonSatisfying(state)) {
        attributes["class"] = "nonsatisfying";
    }
    return dom.SPAN(attributes, [dom.snLabel.toHTML(state.label)]);
}

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

function styledPredicateLabel(label: string, halfspace: Halfspace): HTMLSpanElement {
    const node = dom.snLabel.toHTML(label);
    node.setAttribute("title", ineq2s(halfspace));
    return node;
}

function matrixToTeX(m: Matrix): string {
    return "\\begin{pmatrix}" + m.map(row => row.join("&")).join("\\\\") + "\\end{pmatrix}";
}

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


/* Problem Summary: summary of the problem setup */

export class ProblemSummary {

    +node: HTMLDivElement;

    constructor(system: AbstractedLSS, objective: Objective): void {
        const csFig = new Figure();
        csFig.newLayer({ stroke: "#000", fill: "#EEE" }).shapes = system.lss.controlSpace.map(
            u => ({ kind: "polytope", vertices: u.vertices })
        );
        const rsFig = new Figure();
        rsFig.newLayer({ stroke: "#000", fill: "#EEE" }).shapes = [
            { kind: "polytope", vertices: system.lss.randomSpace.vertices }
        ];
        const ssFig = new Figure();
        ssFig.newLayer({ stroke: "#000", fill: "#EEE" }).shapes = [
            { kind: "polytope", vertices: system.lss.stateSpace.vertices }
        ];
        const cs = new AxesPlot([90, 90], csFig, autoProjection(1, ...union.extent(system.lss.controlSpace)));
        const rs = new AxesPlot([90, 90], rsFig, autoProjection(1, ...system.lss.randomSpace.extent));
        const ss = new AxesPlot([90, 90], ssFig, autoProjection(1, ...system.lss.stateSpace.extent));

        let formula = objective.kind.formula;
        for (let [symbol, prop] of objective.propositions) {
            formula = replaceAll(formula, symbol, "(" + texifyProposition(prop, dom.snLabel.toTeX) + ")");
        }

        this.node = dom.DIV({ "class": "problem-summary" }, [
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



/* System Inspector: interactive system visualization */

export class SystemInspector extends ObservableMixin<null> {

    +node: HTMLDivElement;
    +systemComm: Communicator<Worker>;
    // ...
    +objective: Objective;
    +_system: AbstractedLSS;
    // Sub-widgets are coordinated here
    +settings: Settings;
    +analysis: Analysis;
    +stateView: StateView;
    +traceView: TraceView;
    +actionView: ActionView;
    +supportView: ActionSupportView;
    +systemView: SystemView;
    +refinement: Refinement;
    +controlView: ControlView;
    +snapshots: SnapshotManager;
    +keybindings: dom.Keybindings;

    constructor(system: AbstractedLSS, objective: Objective, keybindings: dom.Keybindings) {
        super();

        try {
            this.systemComm = new Communicator("ISYS");
            this.systemComm.onRequest("init", data => {
                return system.serialize();
            });
            this.systemComm.onRequest("ready", data => {
                this.notify();
                this.snapshots.handleChange(); // TODO: explain
            });
            const worker = new Worker("./js/inspector-worker-system.js");
            worker.onerror = () => {
                // TODO: provide a global error mechanism
            };
            this.systemComm.host = worker;
        } catch (e) {
            // Chrome does not allow Web Workers for local resources
            if (e.name === "SecurityError") {
                this.node = dom.DIV({}, ["error: unable to start web worker for system"]);
                return;
            }
            throw e;
        }

        const x = dom.create("dsfjkd");

        this.objective = objective;
        this._system = system;

        this.settings = new Settings(this, keybindings);
        this.analysis = new Analysis(this, keybindings);
        this.stateView = new StateView(this);
        this.traceView = new TraceView(this, this.stateView, keybindings);
        this.actionView = new ActionView(this, this.stateView);
        this.supportView = new ActionSupportView(this, this.actionView);
        this.systemView = new SystemView(
            this,
            this.settings,
            this.stateView,
            this.traceView,
            this.actionView,
            this.supportView
        );
        this.refinement = new Refinement(this, this.analysis, this.stateView, keybindings);
        this.controlView = new ControlView(this, this.traceView, this.actionView);
        this.snapshots = new SnapshotManager(this, this.analysis);

        this.node = dom.DIV({ "class": "inspector" }, [
            dom.DIV({ "class": "left" }, [
                this.systemView.node,
                dom.H3({}, ["System Analysis", dom.infoBox("info-analysis")]),
                this.analysis.node,
                dom.H3({}, ["Abstraction Refinement", dom.infoBox("info-refinement")]),
                this.refinement.node,
                dom.H3({}, ["Snapshots", dom.infoBox("info-snapshots")]),
                this.snapshots.node
            ]),
            dom.DIV({ "class": "right" }, [
                dom.DIV({"class": "cols"}, [
                    dom.DIV({ "class": "left" }, [
                        dom.H3({}, ["View Settings", dom.infoBox("info-settings")]),
                        this.settings.node
                    ]),
                    dom.DIV({ "class": "right" }, [
                        dom.H3({}, ["Control and Random Space", dom.infoBox("info-control")]),
                        this.controlView.node,
                    ])
                ]),
                dom.DIV({ "class": "rest" }, [
                    dom.H3({}, ["Selected State", dom.infoBox("info-state")]),
                    this.stateView.node,
                    dom.H3({}, ["Actions", dom.infoBox("info-actions")]),
                    this.actionView.node,
                    dom.H3({}, ["Action Supports", dom.infoBox("info-supports")]),
                    this.supportView.node,
                    dom.H3({}, ["Trace", dom.infoBox("info-trace")]),
                    this.traceView.node,
                ]),
            ])
        ]);
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
        return this.systemComm.request("getState", state);
    }

    getStates(): Promise<StateDataPlus[]> {
        return this.systemComm.request("getStates", null);
    }

    getActions(state: StateID): Promise<ActionData[]> {
        return this.systemComm.request("getActions", state);
    }

    getSupports(state: StateID, action: ActionID): Promise<SupportData[]> {
        return this.systemComm.request("getSupports", [state, action]);
    }

    getOperator(op: string, state: StateID, us: JSONConvexPolytopeUnion): Promise<OperatorData> {
        return this.systemComm.request("getOperator", [op, state, us]);
    }

    getGameGraph(): Promise<GameGraphData> {
        return this.systemComm.request("getGameGraph", null);
    }

    sampleTrace(state: ?StateID, controller: string, maxSteps: number): Promise<TraceData> {
        return this.systemComm.request("sampleTrace", [state, controller, maxSteps]);
    }

    updateKinds(satisfying: Set<StateID>, nonSatisfying: Set<StateID>): Promise<UpdateKindsData> {
        return this.systemComm.request("updateKinds", [satisfying, nonSatisfying]).then(data => {
            if (data.size > 0) this.notify();
            return data;
        });
    }

    refine(state: ?StateID, steps: string[]): Promise<RefineData> {
        return this.systemComm.request("refine", [state, steps]).then(data => {
            if (data.size > 0) this.notify();
            return data;
        });
    }

    getSnapshots(): Promise<SnapshotData> {
        return this.systemComm.request("getSnapshots", null);
    }

    takeSnapshot(name: string): Promise<TakeSnapshotData> {
        return this.systemComm.request("takeSnapshot", [name]);
    }

    loadSnapshot(id: number): Promise<LoadSnapshotData> {
        return this.systemComm.request("loadSnapshot", id).then(data => {
            this.notify();
            return data;
        });
    }

    nameSnapshot(id: number, name: string): Promise<NameSnapshotData> {
        return this.systemComm.request("nameSnapshot", [id, name]);
    }

}


type OperatorWrapper = (StateData, JSONConvexPolytopeUnion) => Promise<OperatorData>;

// Settings panel for the main view.
class Settings extends ObservableMixin<null> {

    +node: HTMLDivElement;
    +proxy: SystemInspector;
    +toggleKind: Input<boolean>;
    +toggleLabel: Input<boolean>;
    +toggleVectorField: Input<boolean>;
    +highlight: Input<null|OperatorWrapper>;
    +highlightNode: HTMLDivElement;
    
    constructor(proxy: SystemInspector, keybindings: dom.Keybindings): void {
        super();
        this.proxy = proxy;

        this.toggleKind = new CheckboxInput(true);
        this.toggleLabel = new CheckboxInput(false);
        this.toggleVectorField = new CheckboxInput(false);
        this.highlight = new SelectInput({
            "None": null,
            "Posterior": (state, us) => proxy.getOperator("post", state.label, us),
            "Predecessor": (state, us) => proxy.getOperator("pre", state.label, us),
            "Robust Predecessor": (state, us) => proxy.getOperator("preR", state.label, us),
            "Attractor": (state, us) => proxy.getOperator("attr", state.label, us),
            "Robust Attractor": (state, us) => proxy.getOperator("attrR", state.label, us)
        }, "None");

        this.node = dom.DIV({ "class": "settings" }, [
            dom.LABEL({}, [this.toggleKind.node, "analysis c", dom.create("u", {}, ["o"]), "lors"]),
            dom.LABEL({}, [this.toggleLabel.node, "state ", dom.create("u", {}, ["l"]), "abels"]),
            dom.LABEL({}, [this.toggleVectorField.node, dom.create("u", {}, ["v"]), "ector field"]),
            dom.P({ "class": "highlight" }, [
                dom.create("u", {}, ["H"]), "ighlight operator:", this.highlight.node
            ])
        ]);

        keybindings.bind("o", inputTextRotation(this.toggleKind, ["t", "f"]));
        keybindings.bind("l", inputTextRotation(this.toggleLabel, ["t", "f"]));
        keybindings.bind("v", inputTextRotation(this.toggleVectorField, ["t", "f"]));
        keybindings.bind("h", inputTextRotation(this.highlight, [
            "None", "Posterior", "Predecessor", "Robust Predecessor", "Attractor", "Robust Attractor"
        ]));
    }

}


type JSONAnalysisResults = { [string]: string[] };


// Analysis
class Analysis extends ObservableMixin<null> {

    +node: HTMLDivElement;
    +proxy: SystemInspector;
    +button: HTMLButtonElement;
    +info: HTMLSpanElement;
    _results: Map<string, Set<StateID>>; // TODO: provide interface for refinement
    communicator: ?Communicator<Worker>;
    _ready: boolean;

    constructor(proxy: SystemInspector, keybindings: dom.Keybindings): void {
        super();
        this._results = new Map();
        this.proxy = proxy;

        this.button = dom.BUTTON({}, [dom.create("u", {}, ["a"]), "nalyse"]);
        this.button.addEventListener("click", () => this.analyse());
        this.info = dom.SPAN();
        this.node = dom.DIV({ "class": "analysis-control"}, [
            dom.P({}, [this.button, " ", this.info])
        ]);

        keybindings.bind("a", () => this.analyse());

        // Create and setup the worker (separate worker for analysis, so system
        // exploration stays responsive)
        this.ready = false;
        this.infoText = "initializing...";
        try {
            // Associcate a communicator for message exchange
            const communicator = new Communicator("IANA");
            // Worker will request objective automaton
            communicator.onRequest("automaton", data => {
                return this.objective.automaton.stringify();
            });
            // Worker will request co-safe interpretation of objective
            communicator.onRequest("coSafeInterpretation", data => {
                return this.objective.coSafeInterpretation;
            });
            // Worker will request alphabetMap (connects the automaton transition
            // labels with the linear predicates of the system)
            communicator.onRequest("alphabetMap", data => {
                const alphabetMap = {};
                for (let [label, prop] of this.objective.propositions.entries()) {
                    alphabetMap[label] = stringifyProposition(prop);
                }
                return alphabetMap;
            });
            // Worker will tell when ready
            communicator.onRequest("ready", (msg) => {
                this.communicator = communicator;
                this.infoText = "Web Worker ready.";
                this.ready = true;
            });
            const worker = new Worker("./js/inspector-worker-analysis.js");
            worker.onerror = () => {
                this.infoText = "error: unable to start web worker for analysis"
            };
            // Start communicator
            communicator.host = worker;
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
        return this.proxy.objective;
    }

    get ready(): boolean {
        return this._ready;
    }

    set ready(ready: boolean): void {
        this._ready = ready;
        this.button.disabled = !ready;
        this.notify();
    }

    set infoText(text: string): void {
        dom.replaceChildren(this.info, [text]);
    }

    analyse(): void {
        if (!this.ready) {
            return;
        }
        this.ready = false;
        this.infoText = "constructing game abstraction...";
        const startTime = performance.now();
        // Send the transition system induced by the abstracted LSS to the
        // worker and analyse it with respect to the previously sent objective
        // and proposition mapping.
        this.proxy.getGameGraph().then(gameGraph => {
            this.infoText = "analysing...";
            // Redirect game graph to analysis worker
            if (this.communicator == null) throw new Error(); // TODO: no non-worker fallback anymore
            return this.communicator.request("analysis", gameGraph);
        }).then(results => {
            const elapsed = performance.now() - startTime;
            if (results instanceof Map) {
                this.processAnalysisResults(results, elapsed);
            } else {
                this.infoText = "analysis error '" + String(results) + "'";
            }
            this.ready = true;
        }).catch(err => {
            console.log(err); // TODO
        });
    }

    // Apply analysis results to system and show information message
    processAnalysisResults(results: Map<string, Set<StateID>>, elapsed: number): void {
        this._results = results;
        const satisfying = results.get("satisfying");
        const nonSatisfying = results.get("non-satisfying");
        let updated = new Set();
        if (satisfying != null && nonSatisfying != null) {
            this.proxy.updateKinds(satisfying, nonSatisfying).then(updated => {
                this.infoText = (
                    "Updated " + updated.size + (updated.size === 1 ? " state" : " states")
                    + " after " + t2s(elapsed) + "."
                );
            }).catch(err => {
                console.log(err); // TODO
            });
        }
    }

    // TODO
    serializeResults(): JSONAnalysisResults {
        const results = {};
        for (let [name, stateLabels] of this._results.entries()) {
            results[name] = Array.from(stateLabels);
        }
        return results;
    }

    // TODO
    deserializeResults(json: JSONAnalysisResults): void {
        this._results = new Map();
        for (let name in json) {
            this._results.set(name, new Set(json[name]));
        }
    }

}


// Refinement controls. Observes analysis widget to block operations while
// analysis is carried out. Also depends on analysis for refinement hints (TODO).
class Refinement {

    +node: HTMLDivElement;
    +proxy: SystemInspector;
    +stateView: StateView;
    +analysis: Analysis;
    +info: HTMLSpanElement;
    +buttons: { [string]: HTMLButtonElement };
    +toggles: { [string]: Input<boolean> };
    
    constructor(proxy: SystemInspector, analysis: Analysis, stateView: StateView,
            keybindings: dom.Keybindings): void {
        this.proxy = proxy;
        this.analysis = analysis;
        this.analysis.attach(() => this.handleChange());
        this.stateView = stateView;
        this.stateView.attach(() => this.handleChange());

        this.info = dom.SPAN();
        this.buttons = {
            refineAll: dom.BUTTON({}, [dom.create("u", {}, ["r"]), "efine all"]),
            refineOne: dom.BUTTON({}, ["r", dom.create("u", {}, ["e"]), "fine selection"])
        };
        this.toggles = {
            innerPreR: new CheckboxInput(false),
            negativeAttr: new CheckboxInput(false)
        };
        this.node = dom.DIV({}, [
            dom.P({}, [this.buttons.refineAll, " ", this.buttons.refineOne, " ", this.info]),
            dom.DIV({ "class": "refinement-toggles" }, [
                dom.LABEL({}, [this.toggles.innerPreR.node, "Inner Robust Predecessor"]),
                dom.LABEL({}, [this.toggles.negativeAttr.node, "Negative Attractor"])
            ])
        ]);

        this.buttons.refineAll.addEventListener("click", () => this.refineAll());
        this.buttons.refineOne.addEventListener("click", () => this.refineOne());

        keybindings.bind("r", () => this.refineAll());
        keybindings.bind("e", () => this.refineOne());

        this.handleChange();
    }

    get steps(): string[] {
        const steps = [];
        if (this.toggles.negativeAttr.value) {
            steps.push("NegativeAttr");
        }
        if (this.toggles.innerPreR.value) {
            steps.push("InnerPreR");
        }
        return steps;
    }

    set infoText(text: string): void {
        dom.replaceChildren(this.info, [text]);
    }

    refine(which: ?StateData): void {
        if (this.analysis.ready) {
            const state = which == null ? null : which.label;
            this.proxy.refine(state, this.steps).then(data => {
                this.infoText = "Refined " + data.size + (data.size === 1 ? " state." : " states.");
            }).catch(err => {
                console.log(err); // TODO
            });
        } else {
            this.infoText = "Cannot refine while analysis is running.";
        }
    }

    refineAll(): void {
        this.refine(null);
    }

    refineOne(): void {
        const state = this.stateView.selection;
        if (state != null && State.isUndecided(state)) {
            this.refine(state);
        }
    }

    handleChange(): void {
        const ready = this.analysis.ready;
        const state = this.stateView.selection;
        this.buttons["refineAll"].disabled = !ready;
        this.buttons["refineOne"].disabled = !(ready && state != null && State.isUndecided(state));
    }

}



// Contains and provides information on and preview of the currently selected
// state.
class StateView extends ObservableMixin<null> {

    +node: HTMLDivElement;
    +proxy: SystemInspector;
    +summary: HTMLParagraphElement;
    +predicates: SelectableNodes<string>;
    _selection: ?StateDataPlus;

    constructor(proxy: SystemInspector): void {
        super();
        this._selection = null;
        this.proxy = proxy;
        this.proxy.attach(() => this.handleChange());

        // Summary is filled with basic state information
        this.summary = dom.P();
        // Predicates that state fulfils
        this.predicates = new SelectableNodes(
            _ => styledPredicateLabel(_, this.proxy.getPredicate(_)), "-", ", "
        );
        this.predicates.node.className = "predicates";
        this.node = dom.DIV({ "class": "state-view" }, [
            this.summary, this.predicates.node
        ]);

        this.handleChange();
    }

    get selection(): ?StateDataPlus {
        return this._selection;
    }

    select(state: ?StateDataPlus): void {
        const selection = this._selection;
        if (selection != null && state != null && state.label === selection.label) {
            this._selection = null;
        } else {
            this._selection = state;
        }
        this.handleChange();
    }

    handleChange() {
        let state = this._selection;
        if (state != null) {
            // TODO: documentation
            this.proxy.getState(state.label).then(data => {
                this._selection = data;
                const actionCount = data.numberOfActions;
                const actionText = actionCount === 1 ? " action" : " actions";
                dom.replaceChildren(this.summary, [
                    styledStateLabel(data, data),
                    " (", stateKindString(data), ", ", String(actionCount), actionText, ")"
                ]);
                this.predicates.items = Array.from(data.predicates);
                this.notify();
            }).catch(err => {
                this._selection = null;
                this.handleChange();
            });
        } else {
            dom.replaceChildren(this.summary, ["no selection"]);
            this.predicates.items = [];
            this.notify();
        }
    }

}


// Traces through the system
class TraceView extends ObservableMixin<null> {

    +node: HTMLDivElement;
    +proxy: SystemInspector;
    +stateView: StateView;
    +controller: Input<string>;
    +arrowLayer: FigureLayer;
    +interactionLayer: FigureLayer;
    _trace: TraceData;
    _marked: number;

    constructor(proxy: SystemInspector, stateView: StateView, keybindings: dom.Keybindings): void {
        super();
        this.stateView = stateView;
        this.proxy = proxy;
        this._trace = [];
        this._marked = -1;

        const fig = new Figure();
        this.arrowLayer = fig.newLayer({
            "stroke": COLORS.trace,
            "stroke-width": "1.5",
            "fill": COLORS.trace
        });
        this.interactionLayer = fig.newLayer({
            "stroke": "none",
            "fill": "#FFF",
            "fill-opacity": "0"
        });
        const proj = new Horizontal1D([-1, 0.01], [0, 1]);
        const plot = new ShapePlot([510, 20], fig, proj, false);

        this.controller = new SelectInput({
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

        this.node = dom.DIV({ "class": "trace-view" }, [
            dom.P({}, [
                sampleButton, " ", clearButton,
                dom.DIV({ "class": "right" }, [
                    dom.create("u", {}, ["C"]), "ontroller ",
                    this.controller.node
                ])
            ]),
            plot.node
        ]);

        keybindings.bind("s", () => this.sample());
        keybindings.bind("c", inputTextRotation(this.controller, ["Random"]));
        keybindings.bind("d", () => this.clear());

        this.drawTraceArrows();
    }

    get trace(): TraceData {
        return this._trace;
    }

    get marked(): number {
        return this._marked;
    }

    sample(): void {
        // If a system state is selected, sample from its polytope, otherwise
        // from the entire state space polytope
        const selection = this.stateView.selection;
        const initPoly = selection == null ? null : selection.label;
        const controller = this.controller.value;
        this.proxy.sampleTrace(initPoly, controller, TRACE_LENGTH).then(data => {
            // Reversing results in nicer plots (tips aren't covered by next line)
            this._trace = data.reverse();
            this.drawTraceSelectors();
            this.drawTraceArrows();
            this.notify();
        }).catch(err => {
            console.log(err); // TODO
        });
    }

    clear(): void {
        this._trace = [];
        this.drawTraceSelectors();
        this.drawTraceArrows();
        this.notify();
    }

    mark(stepNo: number): void {
        this._marked = stepNo;
        this.drawTraceArrows();
        this.notify();
    }

    drawTraceSelectors(): void {
        const n = this._trace.length;
        this.interactionLayer.shapes = this._trace.map((step, i) => ({
            kind: "polytope", vertices: [[-(i+1)/n], [-i/n]],
            events: {
                "mouseover": () => this.mark(i),
                "mouseout": () => this.mark(-1)
            }
        }));
    }

    drawTraceArrows(): void {
        const n = this._trace.length;
        const marked = this._marked;
        if (n === 0) {
            this.arrowLayer.shapes = [];
        } else {
            this.arrowLayer.shapes = this._trace.map((step, i) => ({
                kind: "arrow", origin: [-(i+1)/n], target: [-i/n],
                style: (i === marked ? MARKED_STEP_STYLE : {})
            }));
        }
    }

}


// Lists actions available for the selected state and contains the currently
// selected action. Observes StateView for the currently selected state.
class ActionView extends SelectableNodes<ActionData> {

    +proxy: SystemInspector;
    +stateView: StateView;

    constructor(proxy: SystemInspector, stateView: StateView): void {
        super(ActionView.asNode, "none");
        this.node.className = "action-view";
        this.proxy = proxy;
        this.stateView = stateView;
        this.stateView.attach(() => this.handleChange());
    }

    handleChange(): void {
        const state = this.stateView.selection;
        if (state != null) {
            this.proxy.getActions(state.label).then(actions => {
                this.items = actions;
            }).catch(err => {
                console.log(err); // TODO
            });
        } else {
            this.items = [];
        }
    }

    static asNode(action: ActionData): HTMLDivElement {
        return dom.DIV({}, [
            styledStateLabel(action.origin, action.origin), " → {",
            ...arr.intersperse(", ", action.targets.map(
                target => styledStateLabel(target, action.origin)
            )),
            "}"
        ]);
    }

}


// Lists actions supports available for the selected action and contains the
// currently selected action support. Observes ActionView for the currently
// selected action.
class ActionSupportView extends SelectableNodes<SupportData> {
    
    +proxy: SystemInspector;
    +actionView: ActionView;

    constructor(proxy: SystemInspector, actionView: ActionView): void {
        super(ActionSupportView.asNode, "none");
        this.node.className = "support-view";
        this.proxy = proxy;
        this.actionView = actionView;
        this.actionView.attach(isClick => {
            if (isClick) this.handleChange();
        });
    }

    handleChange(): void {
        const action = this.actionView.selection;
        if (action != null) {
            this.proxy.getSupports(action.origin.label, action.id).then(supports => {
                this.items = supports;
            }).catch(err => {
                console.log(err); // TODO
            });
        } else {
            this.items = [];
        }
    }

    static asNode(support: SupportData): HTMLDivElement {
        return dom.DIV({}, [
            "{",
            ...arr.intersperse(", ", support.targets.map(
                target => styledStateLabel(target, support.origin)
            )),
            "}"
        ]);
    }

}


// Information on and preview of the control space polytope and sampling of
// traces through the system based on specific strategies. Observes ActionView
// to display the control subset (action polytope) of the currently selected
// action.
class ControlView {

    +node: HTMLDivElement;
    +proxy: SystemInspector;
    +traceView: TraceView;
    +actionView: ActionView;
    +ctrlPlot: Plot;
    +ctrlLayers: { [string]: FigureLayer };
    +randPlot: Plot;
    +randLayers: { [string]: FigureLayer };

    constructor(proxy: SystemInspector, traceView: TraceView, actionView: ActionView): void {
        this.proxy = proxy;
        this.proxy.attach(() => this.drawSpaces());
        this.actionView = actionView;
        this.actionView.attach(() => this.drawAction());
        this.traceView = traceView;
        this.traceView.attach(() => this.drawTrace());
        // Control space figure
        const ctrlFig = new Figure();
        this.ctrlLayers = {
            poly:   ctrlFig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#FFF" }),
            action: ctrlFig.newLayer({ "stroke": COLORS.action, "fill": COLORS.action }),
            trace:  ctrlFig.newLayer(MARKED_STEP_STYLE)
        };
        // Random space figure
        const randFig = new Figure();
        this.randLayers = {
            poly:   randFig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#FFF" }),
            trace:  randFig.newLayer(MARKED_STEP_STYLE)
        };
        // Side-by-side plots
        this.ctrlPlot = new AxesPlot([90, 90], ctrlFig, autoProjection(1));
        this.randPlot = new AxesPlot([90, 90], randFig, autoProjection(1));
        this.node = dom.DIV({}, [this.ctrlPlot.node, this.randPlot.node]);

        this.drawSpaces();
    }

    drawSpaces(): void {
        const controlSpace = this.proxy.lss.controlSpace;
        const randomSpace = this.proxy.lss.randomSpace;
        this.ctrlPlot.projection = autoProjection(1, ...union.extent(controlSpace));
        this.ctrlLayers.poly.shapes = controlSpace.map(u => ({ kind: "polytope", vertices: u.vertices }));
        this.randPlot.projection = autoProjection(1, ...randomSpace.extent);
        this.randLayers.poly.shapes = [{ kind: "polytope", vertices: randomSpace.vertices }];
    }

    drawAction(): void {
        const action = this.actionView.hoverSelection == null
                     ? this.actionView.selection
                     : this.actionView.hoverSelection;
        if (action == null) {
            this.ctrlLayers.action.shapes = [];
        } else {
            this.ctrlLayers.action.shapes = action.controls.map(
                poly => ({ kind: "polytope", vertices: poly.vertices })
            );
        }
    }

    drawTrace(): void {
        const marked = this.traceView.marked;
        const trace = this.traceView.trace;
        if (marked >= 0 && marked < trace.length) {
            this.ctrlLayers.trace.shapes = [{ kind: "marker", size: 3, coords: trace[marked].control }];
            this.randLayers.trace.shapes = [{ kind: "marker", size: 3, coords: trace[marked].random }];
        } else {
            this.ctrlLayers.trace.shapes = [];
            this.randLayers.trace.shapes = [];
        }
    }

}


// Main view of the inspector: shows the abstracted LSS and lets user select
// states. Has layers for displaying state space subsets (polytopic operators,
// action supports), state information (selection, labels, kinds), linear
// predicates, traces, A-induced vector field. Observes:
// Settings             → Toggle labels, kinds, vector field. Select polytopic operator.
// Analysis             → Kind changes after analysis.
// Refinement           → System refresh after refinement.
// StateView            → Selected state.
// ActionView           → Selected action.
// ActionSupportView    → Selected action support.
// TraceView            → Trace sample.
class SystemView {

    +proxy: SystemInspector;
    +settings: Settings;
    +stateView: StateView;
    +traceView: TraceView;
    +actionView: ActionView;
    +supportView: ActionSupportView;
    +plot: InteractivePlot;
    +layers: { [string]: FigureLayer };
    // Data caches
    _data: ?StateDataPlus[];
    _centroid: { [string]: Vector };

    constructor(proxy: SystemInspector, settings: Settings, stateView: StateView,
                traceView: TraceView, actionView: ActionView,
                supportView: ActionSupportView): void {
        this.proxy = proxy;
        this._data = null;
        this._centroid = {};

        proxy.attach(() => this.drawSystem());

        this.settings = settings;
        this.settings.toggleKind.attach(() => this.drawKind());
        this.settings.toggleLabel.attach(() => this.drawLabels());
        this.settings.toggleVectorField.attach(() => this.drawVectorField());
        this.settings.highlight.attach(() => this.drawHighlight());

        this.traceView = traceView;
        this.traceView.attach(() => this.drawTrace());

        this.stateView = stateView;
        this.stateView.attach(() => {
            this.drawSelection();
            this.drawHighlight();
        });
        this.stateView.predicates.attach(() => this.drawPredicate());
        this.actionView = actionView;
        this.actionView.attach(() => {
            this.drawHighlight();
            this.drawAction();
        });
        this.supportView = supportView;
        this.supportView.attach(() => this.drawActionSupport());

        const fig = new Figure();
        this.layers = {
            kind:           fig.newLayer({ "stroke": "none" }),
            highlight1:     fig.newLayer({ "stroke": COLORS.highlight, "fill": COLORS.highlight }),
            selection:      fig.newLayer({ "stroke": COLORS.selection, "fill": COLORS.selection }),
            highlight2:     fig.newLayer({ "stroke": "none", "fill": COLORS.highlight, "fill-opacity": "0.2" }),
            support:        fig.newLayer({ "stroke": COLORS.support, "fill": COLORS.support }),
            vectorField:    fig.newLayer({ "stroke": COLORS.vectorField, "stroke-width": "1", "fill": COLORS.vectorField }),
            action:         fig.newLayer({ "stroke": COLORS.action, "stroke-width": "2", "fill": COLORS.action }),
            predicate:      fig.newLayer({ "stroke": COLORS.predicate, "fill": COLORS.predicate, "fill-opacity": "0.2" }),
            trace:          fig.newLayer({ "stroke": COLORS.trace, "stroke-width": "1.5", "fill": COLORS.trace }),
            label:          fig.newLayer({ "font-family": "DejaVu Sans, sans-serif", "font-size": "8pt", "text-anchor": "middle" }),
            interaction:    fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#FFF", "fill-opacity": "0" })
        };
        this.plot = new InteractivePlot([630, 420], fig, autoProjection(6/4, ...this.proxy.lss.extent));

        this.drawVectorField();
    }

    get node(): Element {
        return this.plot.node;
    }

    _cache(data: StateDataPlus[]): void {
        this._data = data;
        // Centroids are cached in a direct access data structure, as they are
        // important for positioning arrows (action/support targets don't
        // contain geometry)
        this._centroid = {};
        for (let state of data) {
            this._centroid[state.label] = state.centroid;
        }
    }

    // Fetch the current state of the system and redraw the shapes that handle
    // mouse interaction 
    drawSystem(): void {
        this.proxy.getStates().then(data => {
            this._cache(data);
            this.layers.interaction.shapes = data.map(state => ({
                kind: "polytope", vertices: state.polytope.vertices,
                events: {
                    click: () => this.stateView.select(state)
                }
            }));
            this.drawKind();
            this.drawLabels();
        }).catch(err => {
            console.log(err); // TODO
        });
    }

    drawHighlight(): void {
        const operator = this.settings.highlight.value;
        const state = this.stateView.selection;
        if (operator == null || state == null) {
            this.layers.highlight1.shapes = [];
            this.layers.highlight2.shapes = [];
        } else {
            const action = this.actionView.hoverSelection == null
                         ? this.actionView.selection
                         : this.actionView.hoverSelection;
            const control = action == null ? union.serialize(this.proxy.lss.controlSpace) : action.controls;
            operator(state, control).then(data => {
                const shapes = data.map(
                    poly => ({ kind: "polytope", vertices: poly.vertices })
                );
                this.layers.highlight1.shapes = shapes;
                this.layers.highlight2.shapes = shapes;
            }).catch(err => {
                console.log(err); // TODO
            });

        }
    }

    drawVectorField(): void {
        const shapes = [];
        if (this.settings.toggleVectorField.value) {
            shapes.push({
                kind: "vectorField",
                fun: x => linalg.apply(this.proxy.lss.A, x),
                n: [12, 12]
            });
        }
        this.layers.vectorField.shapes = shapes;
    }

    drawKind(): void {
        let shapes = [];
        if (this._data != null && this.settings.toggleKind.value) {
            shapes = this._data.map(state => ({
                kind: "polytope", vertices: state.polytope.vertices, style: { fill: stateColor(state) }
            }));
        }
        this.layers.kind.shapes = shapes;
    }

    drawLabels(): void {
        let labels = [];
        if (this._data != null && this.settings.toggleLabel.value) {
            labels = this._data.map(state => ({
                kind: "label", coords: state.centroid, text: state.label, style: {dy: "3"}
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
        const support = this.supportView.hoverSelection == null
                      ? this.supportView.selection
                      : this.supportView.hoverSelection;
        if (action == null) {
            this.layers.action.shapes = [];
        } else {
            let polys = support != null && this.actionView.hoverSelection == null ? support.targets : action.targets;
            this.layers.action.shapes = polys.map(
                target => ({
                    kind: "arrow",
                    origin: this._centroid[action.origin.label],
                    target: this._centroid[target.label]
                })
            );
        }
    }

    drawActionSupport(): void {
        const support = this.supportView.hoverSelection == null
                      ? this.supportView.selection
                      : this.supportView.hoverSelection;
        this.drawAction();
        if (support == null) {
            this.layers.support.shapes = [];
        } else {
            this.layers.support.shapes = support.origins.map(
                origin => ({ kind: "polytope", vertices: origin.vertices })
            );
        }
    }

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

}


class SnapshotManager {

    +node: HTMLDivElement;
    +proxy: SystemInspector;
    +analysis: Analysis;
    +forms: { [string]: HTMLButtonElement|HTMLInputElement };
    +treeView: HTMLDivElement;
    // Internal state
    _data: ?SnapshotData;
    _selection: ?number;

    constructor(proxy: SystemInspector, analysis: Analysis): void {
        this.proxy = proxy;
        this.analysis = analysis;
        // Widget: menu bar with tree-structure view below
        this.forms = {
            take:   dom.BUTTON({}, ["new"]),
            load:   dom.BUTTON({}, ["load"]),
            rename: dom.BUTTON({}, ["rename"]),
            name:   dom.INPUT({ "type": "text", "placeholder": "Snapshot", "size": "25" })
        };
        this.forms.take.addEventListener("click", () => this.takeSnapshot());
        this.forms.load.addEventListener("click", () => this.loadSnapshot());
        this.forms.rename.addEventListener("click", () => this.renameSnapshot());
        this.treeView = dom.DIV({ "class": "tree" });
        this.node = dom.DIV({ "class": "snapshot-view"}, [
            dom.P({}, [
                this.forms.take, " ", this.forms.name,
                dom.DIV({ "class": "right" }, [this.forms.rename, " ", this.forms.load])
            ]),
            this.treeView
        ]);
        // Ready-message from worker in proxy triggers first handleChange call
        // and initializes the state variables
        this._data = null;
        this._selection = null;
        // Disable taking snapshots at first, will be enabled with the first
        // handleChange call
        this.forms.take.disabled = true;
    }

    takeSnapshot(): void {
        const name = this.forms.name.value.trim();
        this.forms.name.value = "";
        this.proxy.takeSnapshot(
            (name.length === 0 ? "Snapshot" : name)
            // TODO: analysis results
        );
        this.handleChange();
    }

    loadSnapshot(): void {
        const selection = this._selection;
        if (selection != null) {
            this.proxy.loadSnapshot(selection).then(data => {
                this.handleChange();
            }).catch(err => {
                console.log(err); // TODO
            });
        }
        this.handleChange();
    }

    renameSnapshot(): void {
        const selection = this._selection;
        const name = this.forms.name.value.trim();
        if (selection != null && name.length > 0) {
            this.proxy.nameSnapshot(selection, name).then(data => {
                this.handleChange();
            }).catch(err => {
                console.log(err); // TODO
            });
        }
    }

    handleChange(): void {
        this.forms.take.disabled = false;
        this.proxy.getSnapshots().then(data => {
            this._data = data;
            this.redraw();
        }).catch(err => {
            console.log(err); // TODO
        });
    }

    // Refresh the contents of the snapshot tree-view
    redraw(): void {
        if (this._data != null) {
            dom.replaceChildren(this.treeView, this._renderTree(this._data));
        } else {
            dom.removeChildren(this.treeView);
        }
    }

    // Click handler
    _select(which: number): void {
        this._selection = this._selection === which ? null : which;
        this.forms.load.disabled = this._selection == null;
        this.forms.rename.disabled = this._selection == null;
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

