// @flow
"use strict";

import type { Matrix } from "./linalg.js";
import type { Observable, WorkerMessage } from "./tools.js";
import type { ConvexPolytopeUnion, Halfspace } from "./geometry.js";
import type { LSS, State, StateID, Action, ActionSupport, Controller, Refinery,
              Trace, JSONAbstractedLSS } from "./system.js";
import type { FigureLayer, Shape } from "./figure.js";
import type { Plot } from "./widgets-plot.js";
import type { Input } from "./widgets-input.js";

import * as linalg from "./linalg.js";
import * as dom from "./dom.js";
import { iter, arr, sets, n2s, t2s, replaceAll, ObservableMixin,
         WorkerCommunicator } from "./tools.js";
import { union } from "./geometry.js";
import { Objective, stringifyProposition, texifyProposition } from "./logic.js";
import { AbstractedLSS, partitionMap, controller, refinery } from "./system.js";
import { TwoPlayerProbabilisticGame } from "./game.js";
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


function toShape(state: State): Shape {
    let fill = COLORS.undecided;
    if (state.isSatisfying) {
        fill = COLORS.satisfying;
    } else if (state.isNonSatisfying) {
        fill = COLORS.nonSatisfying;
    }
    return { kind: "polytope", vertices: state.polytope.vertices, style: { fill: fill } };
}

function stateKindString(state: State): string {
    if (state.isSatisfying) {
        return "satisfying";
    } else if (state.isOuter) {
        return "outer";
    } else if (state.isNonSatisfying) {
        return "non-satisfying";
    } else {
        return "undecided";
    }
}

function styledStateLabel(state: State, markSelected?: ?State): HTMLSpanElement {
    let attributes = {};
    if (markSelected != null && markSelected === state) {
        attributes["class"] = "selected";
    } else if (state.isSatisfying) {
        attributes["class"] = "satisfying";
    } else if (state.isNonSatisfying) {
        attributes["class"] = "nonsatisfying";
    }
    return dom.span(attributes, [dom.label.toHTML(state.label)]);
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

function styledPredicateLabel(label: string, system: AbstractedLSS): HTMLSpanElement {
    const node = dom.label.toHTML(label);
    node.setAttribute("title", ineq2s(system.getPredicate(label)));
    return node;
}

function matrixToTeX(m: Matrix): string {
    return "\\begin{pmatrix}" + m.map(row => row.join("&")).join("\\\\") + "\\end{pmatrix}";
}

function volumeRatios(system: AbstractedLSS): { [string]: number } {
    let volSat = 0;
    let volUnd = 0;
    let volNon = 0;
    for (let state of system.states.values()) {
        if (state.isSatisfying) {
            volSat += state.polytope.volume;
        } else if (state.isUndecided) {
            volUnd += state.polytope.volume;
        } else if (!state.isOuter) {
            volNon += state.polytope.volume;
        }
    }
    const volAll = volSat + volUnd + volNon;
    return {
        "satisfying": volSat / volAll,
        "undecided": volUnd / volAll,
        "non-satisfying": volNon / volAll
    };
}

function percentageBar(ratios: { [string]: number }): HTMLDivElement {
    const bar = dom.div({ "class": "percentage-bar" });
    for (let name in ratios) {
        bar.appendChild(dom.div({
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
            formula = replaceAll(formula, symbol, "(" + texifyProposition(prop, dom.label.toTeX) + ")");
        }

        this.node = dom.div({ "class": "problem-summary" }, [
            dom.renderTeX("x_{t+1} = " + matrixToTeX(system.lss.A) + " x_t + " + matrixToTeX(system.lss.B) + " u_t + w_t", dom.p()),
            dom.div({ "class": "boxes" }, [
                dom.div({}, [dom.h3({}, ["Control Space Polytope"]), cs.node]),
                dom.div({}, [dom.h3({}, ["Random Space Polytope"]), rs.node]),
                dom.div({}, [dom.h3({}, ["State Space Polytope"]), ss.node]),
                dom.div({}, [
                    dom.h3({}, ["Labeled Predicates"]),
                    ...Array.from(system.predicates.entries()).map(
                        ([label, halfspace]) => dom.renderTeX(dom.label.toTeX(label) + ": " + ineq2s(halfspace), dom.p())
                    )
                ])
            ]),
            dom.div({}, [
                dom.h3({}, ["Objective"]),
                dom.renderTeX(formula, dom.p()),
                dom.p({}, [objective.kind.name])
            ])
        ]);
    }

}



/* System Inspector: interactive system visualization */

interface SystemWrapper extends Observable<null> {
    system: AbstractedLSS;
    +objective: Objective;
    updateKinds(Set<StateID>, Set<StateID>): Set<State>;
    refine(Map<State, ConvexPolytopeUnion>): Set<State>;
}

export class SystemInspector extends ObservableMixin<null> implements SystemWrapper {

    +node: HTMLDivElement;

    // ...
    _system: AbstractedLSS;
    _objective: Objective;

    // Widgets
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
        this._system = system;
        this._objective = objective;

        this.settings = new Settings(this, keybindings);
        this.analysis = new Analysis(this, keybindings);
        this.stateView = new StateView(this);
        this.traceView = new TraceView(this, this.stateView, keybindings);
        this.actionView = new ActionView(this.stateView);
        this.supportView = new ActionSupportView(this.actionView);
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

        this.node = dom.div({ "class": "inspector" }, [
            dom.div({ "class": "left" }, [
                this.systemView.node,
                dom.h3({}, ["System Analysis", dom.infoBox("info-analysis")]),
                this.analysis.node,
                dom.h3({}, ["Abstraction Refinement", dom.infoBox("info-refinement")]),
                this.refinement.node,
                dom.h3({}, ["Snapshots", dom.infoBox("info-snapshots")]),
                this.snapshots.node
            ]),
            dom.div({ "class": "right" }, [
                dom.div({"class": "cols"}, [
                    dom.div({ "class": "left" }, [
                        dom.h3({}, ["View Settings", dom.infoBox("info-settings")]),
                        this.settings.node
                    ]),
                    dom.div({ "class": "right" }, [
                        dom.h3({}, ["Control and Random Space", dom.infoBox("info-control")]),
                        this.controlView.node,
                    ])
                ]),
                dom.div({ "class": "rest" }, [
                    dom.h3({}, ["Selected State", dom.infoBox("info-state")]),
                    this.stateView.node,
                    dom.h3({}, ["Actions", dom.infoBox("info-actions")]),
                    this.actionView.node,
                    dom.h3({}, ["Action Supports", dom.infoBox("info-supports")]),
                    this.supportView.node,
                    dom.h3({}, ["Trace", dom.infoBox("info-trace")]),
                    this.traceView.node,
                ]),
            ])
        ]);
    }

    // WrappedSystem interface

    get system(): AbstractedLSS {
        return this._system;
    }

    set system(system: AbstractedLSS): void {
        this._system = system;
        this.notify();
    }

    get objective(): Objective {
        return this._objective;
    }

    // Wrap mutating method calls of system, so that changes are properly
    // propagated to the widgets

    updateKinds(satisfying: Set<StateID>, nonSatisfying: Set<StateID>): Set<State> {
        const out = this.system.updateKinds(satisfying, nonSatisfying);
        if (out.size > 0) this.notify();
        return out;
    }

    refine(partitions: Map<State, ConvexPolytopeUnion>): Set<State> {
        const out = this.system.refine(partitions);
        if (out.size > 0) this.notify();
        return out;
    }

}


type ClickOperatorWrapper = (state: State, control: ConvexPolytopeUnion) => ConvexPolytopeUnion;

// Settings panel for the main view.
class Settings extends ObservableMixin<null> {

    +node: HTMLDivElement;
    +wrapper: SystemWrapper;
    +toggleKind: Input<boolean>;
    +toggleLabel: Input<boolean>;
    +toggleVectorField: Input<boolean>;
    +highlight: Input<ClickOperatorWrapper>;
    +highlightNode: HTMLDivElement;
    
    constructor(wrapper: SystemWrapper, keybindings: dom.Keybindings): void {
        super();
        this.wrapper = wrapper;

        this.toggleKind = new CheckboxInput(true);
        this.toggleLabel = new CheckboxInput(false);
        this.toggleVectorField = new CheckboxInput(false);
        this.highlight = new SelectInput({
            "None": (state, u) => [],
            "Posterior": (state, u) => state.isOuter ? [] : state.post(u),
            "Predecessor": (state, u) => this.lss.pre(this.lss.stateSpace, u, [state.polytope]),
            "Robust Predecessor": (state, u) => this.lss.preR(this.lss.stateSpace, u, [state.polytope]),
            "Attractor": (state, u) => this.lss.attr(this.lss.stateSpace, u, [state.polytope]),
            "Robust Attractor": (state, u) => this.lss.attrR(this.lss.stateSpace, u, [state.polytope])
        }, "None");

        this.node = dom.div({ "class": "settings" }, [
            dom.create("label", {}, [this.toggleKind.node, "analysis c", dom.create("u", {}, ["o"]), "lors"]),
            dom.create("label", {}, [this.toggleLabel.node, "state ", dom.create("u", {}, ["l"]), "abels"]),
            dom.create("label", {}, [this.toggleVectorField.node, dom.create("u", {}, ["v"]), "ector field"]),
            dom.p({ "class": "highlight" }, [
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

    get lss(): LSS {
        return this.wrapper.system.lss;
    }

}


type JSONAnalysisResults = { [string]: string[] };


// Analysis
class Analysis extends ObservableMixin<null> {

    +node: HTMLDivElement;
    +wrapper: SystemWrapper;
    +button: HTMLButtonElement;
    +info: HTMLSpanElement;
    _results: Map<string, Set<StateID>>; // TODO: provide interface for refinement
    worker: ?Worker;
    communicator: ?WorkerCommunicator;
    _ready: boolean;

    constructor(wrapper: SystemWrapper, keybindings: dom.Keybindings): void {
        super();
        this._results = new Map();
        this.wrapper = wrapper;

        this.button = dom.create("button", {}, [dom.create("u", {}, ["a"]), "nalyse"]);
        this.button.addEventListener("click", () => this.analyse());
        this.info = dom.span();
        this.node = dom.div({ "class": "analysis-control"}, [
            dom.p({}, [this.button, " ", this.info])
        ]);

        keybindings.bind("a", () => this.analyse());

        this.initializeAnalysisWorker();
    }

    get system(): AbstractedLSS {
        return this.wrapper.system;
    }

    get objective(): Objective {
        return this.wrapper.objective;
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

    // Create and setup the worker
    initializeAnalysisWorker(): void {
        this.ready = false;
        this.infoText = "initializing...";
        // Terminate an old worker if exists, then create new
        if (this.worker != null) this.worker.terminate();
        try {
            const worker = new Worker("./js/inspector-worker-analysis.js");
            // Associcate a communicator for message exchange
            const communicator = new WorkerCommunicator(worker);
            // Worker will request objective automaton
            communicator.onMessage("automaton", (msg) => {
                const automaton = this.objective.automaton.stringify();
                msg.answer(automaton);
            });
            // Worker will request alphabetMap (connects the automaton transition
            // labels with the linear predicates of the system)
            communicator.onMessage("alphabetMap", (msg) => {
                const alphabetMap = {};
                for (let [label, prop] of this.objective.propositions.entries()) {
                    alphabetMap[label] = stringifyProposition(prop);
                }
                msg.answer(alphabetMap);
            });
            // Worker will tell when ready
            communicator.onMessage("ready", (msg) => {
                this.worker = worker;
                this.communicator = communicator;
                this.infoText = "Web Worker ready.";
                this.ready = true;
            });
            // If worker creation fails, switch to local game analysis.
            worker.onerror = () => this.initializeAnalysisFallback();
        } catch (e) {
            // Chrome does not allow Web Workers for local resources
            if (e.name === "SecurityError") {
                this.initializeAnalysisFallback();
                return;
            }
            throw e;
        }
    }

    // If a Web Worker cannot be created for some reason, analysis can still be
    // performed locally, although this means the UI is locked the entire time.
    initializeAnalysisFallback(): void {
        this.ready = false;
        this.worker = null;
        this.communicator = null;
        this.infoText = "Unable to create Web Worker. Will analyse locally instead.";
        this.ready = true;
    }

    analyse(): void {
        if (!this.ready) {
            return;
        }
        this.ready = false;
        // TODO: the message is not flushed properly by the browser before the
        // snapshot locks the page :(
        this.infoText = "constructing game abstraction...";
        const startTime = performance.now();
        const snapshot = this.system.serializeGameGraph();
        this.infoText = "analysing...";
        // Web Worker available. Send the transition system induced by the
        // abstracted LSS to the worker and analyse it with respect to the
        // previously sent objective and proposition mapping.
        if (this.worker != null && this.communicator != null) {
            this.communicator.postMessage("analysis", JSON.stringify(snapshot), (msg) => {
                const elapsed = performance.now() - startTime;
                const results = msg.data;
                if (msg.kind !== "error" && results instanceof Map) {
                    this.processAnalysisResults(results, elapsed);
                } else {
                    this.infoText = "analysis error '" + String(msg.data) + "'";
                }
                this.ready = true;
            });
        // Local analysis when Web Worker creation fails.
        } else {
            const predicateTest = (label, predicates) => {
                const formula = this.objective.propositions.get(label);
                if (formula == null) throw new Error(
                    "No propositional formula assigned to transition '" + label + "'"
                );
                return formula.evalWith(p => predicates.has(p.symbol));
            };
            const game = TwoPlayerProbabilisticGame.fromProduct(
                this.system, this.objective.automaton, predicateTest
            );
            const analysis = game.analyse(new Map([
                ["satisfying",      TwoPlayerProbabilisticGame.analyseSatisfying],
                ["non-satisfying",  TwoPlayerProbabilisticGame.analyseNonSatisfying]
            ]));
            this.processAnalysisResults(analysis, performance.now() - startTime);
            this.ready = true;
        }
    }

    // Apply analysis results to system and show information message
    processAnalysisResults(results: Map<string, Set<StateID>>, elapsed: number): void {
        this._results = results;
        const satisfying = results.get("satisfying");
        const nonSatisfying = results.get("non-satisfying");
        let updated = new Set();
        if (satisfying != null && nonSatisfying != null) {
            updated = this.wrapper.updateKinds(satisfying, nonSatisfying);
        }
        const nStates = this.system.states.size;
        const nActions = iter.sum(iter.map(s => s.actions.length, this.system.states.values()));
        this.infoText = (
            nStates + " states and " + nActions + " actions analysed in " + t2s(elapsed) +
            ". Updated " + updated.size + (updated.size === 1 ? " state" : " states.")
        );
    }

    serializeResults(): JSONAnalysisResults {
        const results = {};
        for (let [name, stateLabels] of this._results.entries()) {
            results[name] = Array.from(stateLabels);
        }
        return results;
    }

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
    +wrapper: SystemWrapper;
    +stateView: StateView;
    +analysis: Analysis;
    +info: HTMLSpanElement;
    +buttons: { [string]: HTMLButtonElement };
    +toggles: { [string]: Input<boolean> };
    
    constructor(wrapper: SystemWrapper, analysis: Analysis, stateView: StateView,
            keybindings: dom.Keybindings): void {
        this.wrapper = wrapper;
        this.analysis = analysis;
        this.analysis.attach(() => this.handleChange());
        this.stateView = stateView;
        this.stateView.attach(() => this.handleChange());

        this.info = dom.span();
        this.buttons = {
            refineAll: dom.create("button", {}, [dom.create("u", {}, ["r"]), "efine all"]),
            refineOne: dom.create("button", {}, ["r", dom.create("u", {}, ["e"]), "fine selection"])
        };
        this.toggles = {
            negativeAttr: new CheckboxInput(true)
        };
        this.node = dom.div({}, [
            dom.p({}, [this.buttons.refineAll, " ", this.buttons.refineOne, " ", this.info]),
            dom.div({ "class": "refinement-toggles" }, [
                dom.create("label", {}, [this.toggles.negativeAttr.node, "Negative Attractor"])
            ])
        ]);

        this.buttons.refineAll.addEventListener("click", () => this.refineAll());
        this.buttons.refineOne.addEventListener("click", () => this.refineOne());

        keybindings.bind("r", () => this.refineAll());
        keybindings.bind("e", () => this.refineOne());

        this.handleChange();
    }

    get system(): AbstractedLSS {
        return this.wrapper.system;
    }

    getRefinementSequence(): Refinery[] {
        const steps = [];
        if (this.toggles.negativeAttr.value) {
            steps.push(new refinery.NegativeAttr(this.system));
        }
        return steps;
    }

    set infoText(text: string): void {
        dom.replaceChildren(this.info, [text]);
    }

    refine(states: Iterable<State>): void {
        if (this.analysis.ready) {
            const refined = this.wrapper.refine(partitionMap(this.getRefinementSequence(), states));
            this.infoText = "Refined " + refined.size + (refined.size === 1 ? " state." : " states.");
        } else {
            this.infoText = "Cannot refine while analysis is running.";
        }
    }

    refineAll(): void {
        this.refine(iter.filter(s => s.isUndecided, this.system.states.values()));
    }

    refineOne(): void {
        const state = this.stateView.selection;
        if (state != null && state.isUndecided) {
            this.refine([state]);
        }
    }

    handleChange(): void {
        const ready = this.analysis.ready;
        const state = this.stateView.selection;
        this.buttons["refineAll"].disabled = !ready;
        this.buttons["refineOne"].disabled = !(ready && state != null && state.isUndecided);
    }

}



// Contains and provides information on and preview of the currently selected
// state.
class StateView extends ObservableMixin<null> {

    +node: HTMLDivElement;
    +wrapper: SystemWrapper;
    +summary: HTMLDivElement;
    +predicates: SelectableNodes<string>;
    _selection: ?State;

    constructor(wrapper: SystemWrapper): void {
        super();
        this._selection = null;
        this.wrapper = wrapper;
        this.wrapper.attach(() => this.handleChange());

        // Summary is filled with basic state information
        this.summary = dom.p();
        // Predicates that state fulfils
        this.predicates = new SelectableNodes(p => styledPredicateLabel(p, this.wrapper.system), "-", ", ");
        this.predicates.node.className = "predicates";
        this.node = dom.div({ "class": "state-view" }, [
            this.summary, this.predicates.node
        ]);

        this.handleChange();
    }

    get system(): AbstractedLSS {
        return this.wrapper.system;
    }

    get selection(): ?State {
        return this._selection;
    }

    set selection(state: ?State): void {
        this._selection = state;
        this.handleChange();
    }

    handleChange() {
        let state = this._selection;
        // If system has changed, State instance has to be refreshed
        if (state != null) {
            const newState = this.system.states.get(state.label);
            // newState is undefined if state does not exist anymore
            this._selection = state = (newState == null) ? null : newState;
        }
        if (state != null) {
            const actionCount = state.actions.length;
            const actionText = actionCount === 1 ? " action" : " actions";
            dom.replaceChildren(this.summary, [
                styledStateLabel(state, state),
                " (", stateKindString(state), ", ", String(actionCount), actionText, ")"
            ]);
            this.predicates.items = Array.from(state.predicates);
        } else {
            dom.replaceChildren(this.summary, ["no selection"]);
            this.predicates.items = [];
        }
        this.notify();
    }

}


// Traces through the system
class TraceView extends ObservableMixin<null> {

    +node: HTMLDivElement;
    +wrapper: SystemWrapper;
    +stateView: StateView;
    +controller: Input<Class<Controller>>;
    +arrowLayer: FigureLayer;
    +interactionLayer: FigureLayer;
    _trace: Trace;
    _marked: number;

    constructor(wrapper: SystemWrapper, stateView: StateView, keybindings: dom.Keybindings): void {
        super();
        this.stateView = stateView;
        this.wrapper = wrapper;
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

        this.controller = new SelectInput(controller, "Random");
        const sampleButton = dom.create("button", {
            "title": "sample a new trace with the selected controller"
        }, [dom.create("u", {}, ["s"]), "ample trace"]);
        sampleButton.addEventListener("click", () => this.sample());
        const clearButton = dom.create("button", { "title": "clear the current trace" }, [
            dom.create("u", {}, ["d"]), "elete"
        ]);
        clearButton.addEventListener("click", () => this.clear());

        this.node = dom.div({ "class": "trace-view" }, [
            dom.p({}, [
                sampleButton, " ", clearButton,
                dom.div({ "class": "right" }, [
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

    get system(): AbstractedLSS {
        return this.wrapper.system;
    }

    get trace(): Trace {
        return this._trace;
    }

    get marked(): number {
        return this._marked;
    }

    sample(): void {
        // If a system state is selected, sample from its polytope, otherwise
        // from the entire state space polytope
        const selection = this.stateView.selection;
        const initPoly = selection == null ? this.system.lss.stateSpace : selection.polytope;
        const controller = new this.controller.value(this.system);
        this._trace = this.system.sampleTrace(initPoly.sample(), controller, TRACE_LENGTH);
        // Reversing results in nicer plots (tips aren't covered by next line)
        this._trace.reverse();
        this.drawTraceSelectors();
        this.drawTraceArrows();
        this.notify();
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
class ActionView extends SelectableNodes<Action> {

    +stateView: StateView;

    constructor(stateView: StateView): void {
        super(action => ActionView.asNode(action), "none");
        this.node.className = "action-view";
        this.stateView = stateView;
        this.stateView.attach(() => this.handleChange());
    }

    handleChange(): void {
        const state = this.stateView.selection;
        this.items = state == null ? [] : state.actions;
    }

    static asNode(action: Action): HTMLDivElement {
        return dom.div({}, [
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
class ActionSupportView extends SelectableNodes<ActionSupport> {
    
    +actionView: ActionView;

    constructor(actionView: ActionView): void {
        super(support => ActionSupportView.asNode(support), "none");
        this.node.className = "support-view";
        this.actionView = actionView;
        this.actionView.attach(isClick => {
            if (isClick) this.handleChange();
        });
    }

    handleChange(): void {
        const action = this.actionView.selection;
        this.items = action == null ? [] : action.supports;
    }

    static asNode(support: ActionSupport): HTMLDivElement {
        return dom.div({}, [
            "{",
            ...arr.intersperse(", ", support.targets.map(
                target => styledStateLabel(target, support.action.origin)
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
    +wrapper: SystemWrapper;
    +traceView: TraceView;
    +actionView: ActionView;
    +ctrlPlot: Plot;
    +ctrlLayers: { [string]: FigureLayer };
    +randPlot: Plot;
    +randLayers: { [string]: FigureLayer };

    constructor(wrapper: SystemWrapper, traceView: TraceView, actionView: ActionView): void {
        this.wrapper = wrapper;
        this.wrapper.attach(() => this.drawSpaces());
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
        this.node = dom.div({}, [this.ctrlPlot.node, this.randPlot.node]);

        this.drawSpaces();
    }

    get lss(): LSS {
        return this.wrapper.system.lss;
    }

    drawSpaces(): void {
        const controlSpace = this.lss.controlSpace;
        const randomSpace = this.lss.randomSpace;
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

    +wrapper: SystemWrapper;
    +settings: Settings;
    +stateView: StateView;
    +traceView: TraceView;
    +actionView: ActionView;
    +supportView: ActionSupportView;
    +plot: InteractivePlot;
    +layers: { [string]: FigureLayer };

    constructor(wrapper: SystemWrapper, settings: Settings, stateView: StateView,
                traceView: TraceView, actionView: ActionView,
                supportView: ActionSupportView): void {
        this.wrapper = wrapper;

        wrapper.attach(() => {
            this.drawSystem();
            this.drawKind();
            this.drawLabels();
            this.drawVectorField();
        });

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
        this.plot = new InteractivePlot([630, 420], fig, autoProjection(6/4, ...this.system.extent));

        this.drawSystem();
        this.drawHighlight();
        this.drawKind();
        this.drawVectorField();
        this.drawLabels();
        this.drawPredicate();
        this.drawTrace();
    }

    get system(): AbstractedLSS {
        return this.wrapper.system;
    }

    get node(): Element {
        return this.plot.node;
    }

    drawSystem(): void {
        this.layers.interaction.shapes = iter.map(state => ({
            kind: "polytope", vertices: state.polytope.vertices,
            events: {
                "click": () => {
                    this.stateView.selection = this.stateView.selection === state ? null : state;
                }
            }
        }), this.system.states.values());
    }

    drawHighlight(): void {
        const operator = this.settings.highlight;
        const state = this.stateView.selection;
        const action = this.actionView.hoverSelection == null
                     ? this.actionView.selection
                     : this.actionView.hoverSelection;
        const control = action == null ? this.system.lss.controlSpace : action.controls;
        if (state != null) {
            const shapes = operator.value(state, control).map(
                poly => ({ kind: "polytope", vertices: poly.vertices })
            );
            this.layers.highlight1.shapes = shapes;
            this.layers.highlight2.shapes = shapes;
        } else {
            this.layers.highlight1.shapes = [];
            this.layers.highlight2.shapes = [];
        }
    }

    drawVectorField(): void {
        const shapes = [];
        if (this.settings.toggleVectorField.value) {
            shapes.push({
                kind: "vectorField",
                fun: x => linalg.apply(this.system.lss.A, x),
                n: [12, 12]
            });
        }
        this.layers.vectorField.shapes = shapes;
    }

    drawKind(): void {
        let shapes = [];
        if (this.settings.toggleKind.value) {
            shapes = iter.map(toShape, this.system.states.values());
        }
        this.layers.kind.shapes = shapes;
    }

    drawLabels(): void {
        let labels = [];
        if (this.settings.toggleLabel.value) {
            labels = iter.map(state => ({
                kind: "label", coords: state.polytope.centroid, text: state.label, style: {dy: "3"}
            }), this.system.states.values());
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
                    origin: action.origin.polytope.centroid,
                    target: target.polytope.centroid
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
            const predicate = this.system.getPredicate(label);
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


type InspectorSnapshot = {
    name: string,
    states: number,
    ratios: { [string]: number },
    system: JSONAbstractedLSS,
    analysis: JSONAnalysisResults
}

type Tree<T> = { element: T, children: Tree<T>[] };

class SnapshotManager {

    +node: HTMLDivElement;
    +wrapper: SystemWrapper;
    +analysis: Analysis;
    +forms: { [string]: HTMLButtonElement };
    +treeView: HTMLDivElement;

    _tree: Tree<InspectorSnapshot>;
    _current: Tree<InspectorSnapshot>;
    _selection: ?Tree<InspectorSnapshot>;

    constructor(wrapper: SystemWrapper, analysis: Analysis): void {
        this.wrapper = wrapper;
        this.analysis = analysis;

        this.forms = {
            take:   dom.create("button", {}, ["new"]),
            load:   dom.create("button", {}, ["load"]),
            rename: dom.create("button", {}, ["rename"]),
            name:   dom.create("input", { "type": "text", "placeholder": "Snapshot", "size": "25" })
        };
        this.forms.take.addEventListener("click", () => this.newSnapshot());
        this.forms.load.addEventListener("click", () => this.loadSnapshot());
        this.forms.rename.addEventListener("click", () => this.renameSnapshot());
        this.treeView = dom.div({ "class": "tree" });
        this.node = dom.div({ "class": "snapshot-view"}, [
            dom.p({}, [
                this.forms.take, " ", this.forms.name,
                dom.div({ "class": "right" }, [this.forms.rename, " ", this.forms.load])
            ]),
            this.treeView
        ]);

        const tree = {
            element: this._takeSnapshot("Initial Problem"),
            children: []
        }
        this._current = tree;
        this._tree = this._current;
        this._selection = null;

        this.handleChange();
    }

    get system(): AbstractedLSS {
        return this.wrapper.system;
    }

    newSnapshot(): void {
        const name = this.forms.name.value.trim();
        this.forms.name.value = "";
        const tree = {
            element: this._takeSnapshot(name.length === 0 ? "Snapshot" : name),
            children: []
        };
        this._current.children.push(tree);
        this._current = tree;
        this.handleChange();
    }

    loadSnapshot(): void {
        const tree = this._selection;
        if (tree != null) {
            const snapshot = tree.element;
            this.wrapper.system = AbstractedLSS.deserialize(snapshot.system);
            this.analysis.deserializeResults(snapshot.analysis);
            this._current = tree;
        }
        this.handleChange();
    }

    renameSnapshot(): void {
        const name = this.forms.name.value.trim();
        const tree = this._selection;
        if (tree != null && name.length > 0) {
            tree.element.name = name;
            this.forms.name.value = "";
        }
        this.handleChange();
    }

    _takeSnapshot(name: string): InspectorSnapshot {
        return {
            name: name,
            states: this.system.states.size,
            ratios: volumeRatios(this.system),
            system: this.system.serialize(true),
            analysis: this.analysis.serializeResults()
        };
    }

    _select(tree: Tree<InspectorSnapshot>): void {
        this._selection = this._selection === tree ? null : tree;
        this.handleChange();
    }

    _renderTree(tree: Tree<InspectorSnapshot>): HTMLDivElement[] {
        const snap = tree.element;
        const nodes = [];
        const cls = "snap" + (tree === this._current ? " current" : "")
                           + (tree === this._selection ? " selection" : "");
        const node = dom.div({ "class": cls }, [
            snap.name,
            dom.span({}, [snap.states + " states", percentageBar(snap.ratios)])
        ]);
        node.addEventListener("click", () => this._select(tree));
        nodes.push(node);
        if (tree.children.length > 0) {
            const indented = dom.div({ "class": "indented" });
            for (let child of tree.children) {
                dom.appendChildren(indented, this._renderTree(child));
            }
            nodes.push(indented);
        }
        return nodes;
    }

    handleChange(): void {
        this.forms.load.disabled = this._selection == null;
        this.forms.rename.disabled = this._selection == null;
        dom.replaceChildren(this.treeView, this._renderTree(this._tree));
    }

}

