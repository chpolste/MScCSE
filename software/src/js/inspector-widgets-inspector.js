// @flow
"use strict";

import type { Matrix } from "./linalg.js";
import type { WorkerMessage } from "./tools.js";
import type { ConvexPolytopeUnion, Halfspace } from "./geometry.js";
import type { AbstractedLSS, State, StateID, Action, ActionSupport,
              StrategyGenerator, Trace } from "./system.js";
import type { FigureLayer, Shape } from "./figure.js";
import type { Plot } from "./widgets-plot.js";
import type { Input } from "./widgets-input.js";

import * as linalg from "./linalg.js";
import * as dom from "./domtools.js";
import * as refinement from "./refinement.js";
import { iter, arr, sets, n2s, t2s, ObservableMixin, WorkerCommunicator } from "./tools.js";
import { union } from "./geometry.js";
import { Refinery } from "./refinement.js";
import { Objective, stringifyProposition } from "./logic.js";
import { TwoPlayerProbabilisticGame } from "./game.js";
import { Figure, autoProjection } from "./figure.js";
import { InteractivePlot, AxesPlot } from "./widgets-plot.js";
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
    //action: "#F60",
    predicate: "#000",
    split: "#C00",
    vectorField: "#000",
    trace: "#600"
    //trace: "#603"
};

export const TRACE_LENGTH = 50;


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
    return dom.span(attributes, [state.label]);
}

function asInequation(h: Halfspace): string {
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
    return dom.span({ "title": asInequation(system.getPredicate(label)) }, [label]);
}

function matrixToTeX(m: Matrix): string {
    return "\\begin{pmatrix}" + m.map(row => row.join("&")).join("\\\\") + "\\end{pmatrix}";
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
            formula = formula.replace(symbol, stringifyProposition(prop));
        }

        this.node = dom.div({ "class": "problem-summary" }, [
            dom.renderTeX("x_{t+1} = " + matrixToTeX(system.lss.A) + " x_t + " + matrixToTeX(system.lss.B) + " u_t + w_t", dom.p()),
            dom.div({ "class": "boxes" }, [
                dom.div({}, [dom.h3({}, ["Control Space Polytope"]), cs.node]),
                dom.div({}, [dom.h3({}, ["Random Space Polytope"]), rs.node]),
                dom.div({}, [dom.h3({}, ["State Space Polytope"]), ss.node]),
                dom.div({}, [
                    dom.h3({}, ["Labeled Predicates"]),
                    ...Array.from(system.predicates.entries()).map(([label, halfspace]) =>
                        dom.p({}, [
                            label, ": ",
                            dom.span({}, [asInequation(halfspace)]) // TODO: use KaTeX
                        ])
                    )
                ])
            ]),
            dom.div({}, [
                dom.h3({}, ["Objective"]),
                dom.p({}, [objective.kind.name, ": ", dom.create("code", {}, [formula])]) // TODO: use KaTeX
            ])
        ]);
    }

}



/* System Inspector: interactive system visualization */

export class SystemInspector {

    +node: HTMLDivElement;
    +system: AbstractedLSS;
    +objective: Objective;
    +settings: Settings;
    +analysis: AnalysisRefinement;
    +stateView: StateView;
    +actionView: ActionView;
    +actionSupportView: ActionSupportView;
    +systemView: SystemView;
    +controlView: ControlView;
    +systemSummary: Summary;
    +keybindings: dom.Keybindings;

    constructor(system: AbstractedLSS, objective: Objective, keybindings: dom.Keybindings) {
        this.system = system;
        this.objective = objective;

        this.keybindings = keybindings;
        this.settings = new Settings(this.system, this.keybindings);
        this.analysis = new AnalysisRefinement(this.system, this.objective, this.keybindings);
        this.stateView = new StateView(this.system, this.analysis);
        this.actionView = new ActionView(this.stateView);
        this.controlView = new ControlView(this.system, this.stateView, this.actionView, this.keybindings);
        this.actionSupportView = new ActionSupportView(this.actionView);
        this.systemView = new SystemView(
            this.system, this.settings, this.analysis, this.stateView, this.controlView,
            this.actionView, this.actionSupportView
        );
        this.systemSummary = new Summary(this.system, this.analysis);

        this.node = dom.div({ "class": "inspector" }, [
            dom.div({ "class": "left" }, [
                this.systemView.node,
                dom.h3({}, ["Analysis and Abstraction Refinement", dom.infoBox("info-analysis-refinement")]),
                this.analysis.node
            ]),
            dom.div({ "class": "right" }, [
                dom.div({"class": "cols"}, [
                    dom.div({ "class": "left" }, [
                        dom.h3({}, ["System Summary", dom.infoBox("info-summary")]),
                        this.systemSummary.node,
                        dom.h3({}, ["View Settings", dom.infoBox("info-settings")]),
                        this.settings.node,
                    ]),
                    dom.div({ "class": "right" }, [
                        dom.h3({}, ["Control and Trace", dom.infoBox("info-control")]),
                        this.controlView.node,
                        dom.h3({}, ["Selected State", dom.infoBox("info-state")]),
                        this.stateView.node
                    ])
                ]),
                dom.div({ "class": "rest" }, [
                    dom.h3({}, ["Actions", dom.infoBox("info-actions")]),
                    this.actionView.node,
                    dom.h3({}, ["Action Supports", dom.infoBox("info-supports")]),
                    this.actionSupportView.node
                ]),
            ])
        ]);
    }

}


// Settings panel for the main view.
class Settings extends ObservableMixin<null> {

    +node: HTMLDivElement;
    +toggleKind: Input<boolean>;
    +toggleLabel: Input<boolean>;
    +toggleVectorField: Input<boolean>;
    +highlight: Input<ClickOperatorWrapper>;
    +highlightNode: HTMLDivElement;
    +strategy: Input<string>;
    
    constructor(system: AbstractedLSS, keybindings: dom.Keybindings): void {
        super();
        this.toggleKind = new CheckboxInput(true);
        this.toggleLabel = new CheckboxInput(false);
        this.toggleVectorField = new CheckboxInput(false);

        const lss = system.lss;
        this.highlight = new SelectInput({
            "None": (state, u) => [],
            "Posterior": (state, u) => state.isOuter ? [] : state.post(u),
            "Predecessor": (state, u) => lss.pre(lss.stateSpace, u, [state.polytope]),
            "Robust Predecessor": (state, u) => lss.preR(lss.stateSpace, u, [state.polytope]),
            "Attractor": (state, u) => lss.attr(lss.stateSpace, u, [state.polytope]),
            "Robust Attractor": (state, u) => lss.attrR(lss.stateSpace, u, [state.polytope])
        }, "None");

        this.node = dom.div({ "class": "settings" }, [
            dom.create("label", {}, [this.toggleKind.node, "analysis ", dom.create("u", {}, ["c"]), "olors"]),
            dom.create("label", {}, [this.toggleLabel.node, "state ", dom.create("u", {}, ["l"]), "abels"]),
            dom.create("label", {}, [this.toggleVectorField.node, dom.create("u", {}, ["v"]), "ector field"]),
            dom.p({ "class": "highlight" }, [
                "Highlight ", dom.create("u", {}, ["o"]), "perator:", this.highlight.node
            ])
        ]);

        keybindings.bind("c", inputTextRotation(this.toggleKind, ["t", "f"]));
        keybindings.bind("l", inputTextRotation(this.toggleLabel, ["t", "f"]));
        keybindings.bind("v", inputTextRotation(this.toggleVectorField, ["t", "f"]));
        keybindings.bind("o", inputTextRotation(this.highlight, [
            "None", "Posterior", "Predecessor", "Robust Predecessor", "Attractor", "Robust Attractor"
        ]));
    }

}

type ClickOperatorWrapper = (state: State, control: ConvexPolytopeUnion) => ConvexPolytopeUnion;


// Analysis and refinement controls
class AnalysisRefinement extends ObservableMixin<null> {

    // Widget
    +node: HTMLDivElement;
    +analyseButton: HTMLInputElement;
    +info: HTMLSpanElement;
    +refineButton: HTMLInputElement;
    +toggles: { [string]: Input<boolean> };
    // Web Worker for multithreaded analysis
    worker: ?Worker;
    communicator: ?WorkerCommunicator;
    // Data for analysis and refinement
    +system: AbstractedLSS;
    +objective: Objective;

    _ready: boolean;
    
    constructor(system: AbstractedLSS, objective: Objective, keybindings: dom.Keybindings): void {
        super();
        this.system = system;
        this.objective = objective;
        // Analysis
        this.analyseButton = dom.create("button", {}, ["analys", dom.create("u", {}, ["e"])]);
        this.analyseButton.addEventListener("click", () => this.analyse());
        this.info = dom.span({ "class": "analysis-info" });
        keybindings.bind("e", () => this.analyse());
        // Refinement
        this.refineButton = dom.create("button", {}, [dom.create("u", {}, ["r"]), "efine all"]);
        this.refineButton.addEventListener("click", () => this.refineAll());
        this.toggles = {
            outerAttr: new CheckboxInput(true)
        };
        keybindings.bind("r", () => this.refineAll());
        this.node = dom.div({}, [
            dom.p({}, [this.analyseButton, " ", this.refineButton, " ", this.info]),
            dom.p({}, ["Apply refinement procedures:"]),
            dom.p({ "class": "refinement-toggles" }, [
                dom.create("label", {}, [this.toggles.outerAttr.node, "Outer Attractor"])
            ])
        ]);
        this.initializeAnalysisWorker();
    }

    get ready(): boolean {
        return this._ready;
    }

    set ready(ready: boolean): void {
        this._ready = ready;
        this.analyseButton.disabled = !ready;
        this.refineButton.disabled = !ready;
    }

    write(text: string): void {
        dom.replaceChildren(this.info, [text]);
    }

    // Create and setup the worker
    initializeAnalysisWorker(): void {
        this.ready = false;
        this.write("initializing...");
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
                this.write("Web Worker ready.");
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
        this.write("Unable to create Web Worker. Will analyse locally instead.");
        this.ready = true;
    }

    analyse(): void {
        if (!this.ready) {
            return;
        }
        this.ready = false;
        // TODO: the message is not flushed properly by the browser before the
        // snapshot locks the page :(
        this.write("constructing game abstraction...");
        const startTime = performance.now();
        const snapshot = this.system.snapshot(false);
        this.write("analysing...");
        // Web Worker available. Send the transition system induced by the
        // abstracted LSS to the worker and analyse it with respect to the
        // previously sent objective and proposition mapping.
        if (this.worker != null && this.communicator != null) {
            this.communicator.postMessage("analysis", JSON.stringify(snapshot), (msg) => {
                const elapsed = performance.now() - startTime;
                const data = msg.data;
                if (msg.kind !== "error" && data != null && typeof data === "object"
                        && data.satisfying instanceof Set && data.nonSatisfying instanceof Set) {
                    this.processAnalysisResults(data.satisfying, data.nonSatisfying, elapsed);
                } else {
                    this.write("analysis error"); // TODO
                }
                this.ready = true;
            });
        // Local analysis when Web Worker creation fails.
        } else {
            const predicateTest = (label, predicates) => {
                const formula = this.objective.propositions.get(label);
                if (formula == null) throw new Error(); // TODO
                return formula.evalWith(p => predicates.has(p.symbol));
            };
            const [game, init] = TwoPlayerProbabilisticGame.fromProduct(
                this.system, this.objective.automaton, predicateTest
            );
            const win = game.solve();
            const winCoop = game.solveCoop();
            const satisfying = sets.intersection(win, init);
            const nonsatisfying = sets.difference(init, winCoop);
            this.processAnalysisResults(
                new Set(iter.map(s => s.systemState, satisfying)),
                new Set(iter.map(s => s.systemState, nonsatisfying)),
                performance.now() - startTime
            );
            this.ready = true;
        }
    }

    // Apply analysis results to system and show information message
    processAnalysisResults(satisfying: Set<StateID>, nonSatisfying: Set<StateID>, elapsed: number): void {
        const updated = this.system.updateKinds(satisfying, nonSatisfying);
        const nStates = this.system.states.size;
        const nActions = iter.sum(iter.map(s => s.actions.length, this.system.states.values()));
        this.write(
            nStates + " states and " + nActions + " actions analysed in " + t2s(elapsed) +
            ". Updated " + updated.size + (updated.size === 1 ? " state" : " states.")
        );
        this.notify();
    }

    get refinementSteps(): Refinery[] {
        const steps = [];
        if (this.toggles.outerAttr.value) {
            steps.push(new refinement.OuterAttr(this.system));
        }
        return steps;
    }

    refine(states: Iterable<State>): void {
        if (this.ready) {
            const refined = this.system.refine(refinement.partitionAll(this.refinementSteps, states));
            this.write("Refined " + refined.size + (refined.size === 1 ? " state." : " states."));
            if (refined.size > 0) {
                this.notify();
            }
        } else {
            this.write("Cannot refine while analysing...");
        }
    }

    refineAll(): void {
        this.refine(iter.filter(s => s.isUndecided, this.system.states.values()));
    }

}



// Contains and provides information on and preview of the currently selected
// state.
class StateView extends ObservableMixin<null> {

    +node: HTMLDivElement;
    +system: AbstractedLSS;
    +summary: HTMLDivElement;
    +predicates: SelectableNodes<string>;
    +refineButton: HTMLInputElement;
    _selection: ?State;

    constructor(system: AbstractedLSS, analysis: AnalysisRefinement): void {
        super();
        this.system = system;
        analysis.attach(() => {
            const keep = this.selection != null && this.system.states.has(this.selection.label);
            this.selection = keep ? this.selection : null; // invokes changeHandler
        });
        // Summary is filled basic state information
        this.summary = dom.p();
        // Predicates that state fulfils
        this.predicates = new SelectableNodes(p => styledPredicateLabel(p, this.system), ", ", "-");
        this.predicates.node.className = "predicates";
        // Refine-button for undecided states
        this.refineButton = dom.create("input", { "type": "button", "value": "refine", "class": "refine" });
        this.refineButton.addEventListener("click", () => {
            const selection = this.selection;
            if (selection != null && selection.isUndecided) {
                analysis.refine([selection]);
            }
        });
        this.node = dom.div({ "class": "state-view" }, [
            this.refineButton, this.summary, this.predicates.node
        ]);
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
        const state = this._selection;
        this.refineButton.disabled = state == null || !state.isUndecided;
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


// Lists actions available for the selected state and contains the currently
// selected action. Observes StateView for the currently selected state.
class ActionView extends SelectableNodes<Action> {

    +stateView: StateView;

    constructor(stateView: StateView): void {
        super(action => ActionView.asNode(action), null, "none");
        this.node.className = "action-view";
        this.stateView = stateView;
        this.stateView.attach(() => this.changeHandler());
    }

    changeHandler(): void {
        const state = this.stateView.selection;
        this.items = state == null ? [] : state.actions;
    }

    static asNode(action: Action): Element {
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
        super(support => ActionSupportView.asNode(support), null, "none");
        this.node.className = "support-view";
        this.actionView = actionView;
        this.actionView.attach(wasClick => {
            if (wasClick) this.changeHandler();
        });
    }

    changeHandler(): void {
        const action = this.actionView.selection;
        this.items = action == null ? [] : action.supports;
    }

    static asNode(support: ActionSupport): Element {
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
class ControlView extends ObservableMixin<null> {

    +node: HTMLDivElement;
    +system: AbstractedLSS;
    +stateView: StateView;
    +actionView: ActionView;
    +actionLayer: FigureLayer;
    +strategyGen: Input<StrategyGenerator>;
    +trace: Trace;
    _trace: Trace;

    constructor(system: AbstractedLSS, stateView: StateView,
                actionView: ActionView, keybindings: dom.Keybindings): void {
        super();
        this.system = system;
        this.actionView = actionView;
        this.stateView = stateView;
        const controlSpace = system.lss.controlSpace;

        // Function 1: control space polytope visualisation with highlighting
        // of action polytopes
        const fig = new Figure();
        this.actionLayer = fig.newLayer({ "stroke": COLORS.action, "fill": COLORS.action });
        const layer = fig.newLayer({
            "stroke": "#000", "stroke-width": "1",
            "fill": "#FFF", "fill-opacity": "0"
        });
        layer.shapes = controlSpace.map(u => ({ kind: "polytope", vertices: u.vertices }));
        const view = new AxesPlot([90, 90], fig, autoProjection(1, ...union.extent(controlSpace)));
        this.actionView.attach(() => this.drawAction());

        // Function 2: Trace sampling
        this._trace = [];
        // Strategy selection. Because strategies must bring their own memory
        // if needed, the values are strategy generators
        this.strategyGen =  new SelectInput({
            "Random": () => ((state) => controlSpace[0].sample())
            // TODO: round-robin strategy
        }, "random");
        // Trace creation and removal buttons
        const newTrace = dom.create("button", {
            "title": "sample a new trace based on the selected strategy"
        }, ["new tr", dom.create("u", {}, ["a"]), "ce"]);
        newTrace.addEventListener("click", () => this._newTrace());
        const clearTrace = dom.create("button", { "title": "delete the current trace" }, [
            dom.create("u", {}, ["d"]), "elete"
        ]);
        clearTrace.addEventListener("click", () => this._clearTrace());
        // Keybindings for trace control buttons
        keybindings.bind("a", () => this._newTrace());
        keybindings.bind("s", inputTextRotation(this.strategyGen, ["Random"]));
        keybindings.bind("d", () => this._clearTrace());

        this.node = dom.div({ "class": "control" }, [
            view.node,
            dom.div({}, [
                dom.p({}, ["Control ", dom.create("u", {}, ["s"]), "trategy:"]),
                dom.p({}, [this.strategyGen.node]),
                dom.p({ "class": "trace" }, [newTrace, " ", clearTrace])
            ])
        ]);
    }

    get trace(): Trace {
        return this._trace;
    }

    _newTrace(): void {
        // If a system state is selected, sample from its polytope, otherwise
        // from the entire state space polytope
        const selection = this.stateView.selection;
        const initPoly = selection == null ? this.system.lss.stateSpace : selection.polytope;
        // Obtain strategy from selection
        const strategy = this.strategyGen.value();
        // Sample a new trace and update
        this._trace = this.system.sampleTrace(initPoly.sample(), strategy, TRACE_LENGTH);
        this.notify();
    }

    _clearTrace(): void {
        this._trace = [];
        this.notify();
    }

    drawAction(): void {
        const action = this.actionView.hoverSelection == null
                     ? this.actionView.selection
                     : this.actionView.hoverSelection;
        if (action == null) {
            this.actionLayer.shapes = [];
        } else {
            this.actionLayer.shapes = action.controls.map(
                poly => ({ kind: "polytope", vertices: poly.vertices })
            );
        }
    }

}


// Main view of the inspector: shows the abstracted LSS and lets user select
// states. Has layers for displaying state space subsets (polytopic operators,
// action supports), state information (selection, labels, kinds), linear
// predicates, traces, A-induced vector field. Observes:
// Settings             → Toggle labels, kinds, vector field. Select polytopic operator.
// AnalysisRefinement   → System refresh after refinement. Kind changes after analysis.
// StateView            → Selected state.
// ActionView           → Selected action.
// ActionSupportView    → Selected action support.
// ControlView            → Trace sample.
class SystemView {

    +system: AbstractedLSS;
    +settings: Settings;
    +stateView: StateView;
    +controlView: ControlView;
    +actionView: ActionView;
    +actionSupportView: ActionSupportView;
    +plot: Plot;
    +layers: { [string]: FigureLayer };

    constructor(system: AbstractedLSS, settings: Settings, analysis: AnalysisRefinement,
                stateView: StateView, controlView: ControlView, actionView: ActionView,
                actionSupportView: ActionSupportView): void {
        this.system = system;

        analysis.attach(() => {
            this.drawInteraction();
            this.drawKind();
            this.drawLabels();
        });

        this.settings = settings;
        this.settings.toggleKind.attach(() => this.drawKind());
        this.settings.toggleLabel.attach(() => this.drawLabels());
        this.settings.toggleVectorField.attach(() => this.drawVectorField());
        this.settings.highlight.attach(() => this.drawHighlight());

        this.controlView = controlView;
        this.controlView.attach(() => this.drawTrace());

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
        this.actionSupportView = actionSupportView;
        this.actionSupportView.attach(() => this.drawActionSupport());

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
            trace:          fig.newLayer({ "stroke": COLORS.trace, "stroke-width": "2", "fill": COLORS.trace }),
            label:          fig.newLayer({ "font-family": "DejaVu Sans, sans-serif", "font-size": "8pt", "text-anchor": "middle" }),
            interaction:    fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#FFF", "fill-opacity": "0" })
        };
        this.plot = new InteractivePlot([630, 420], fig, autoProjection(6/4, ...system.extent));

        this.drawInteraction();
        this.drawHighlight();
        this.drawKind();
        this.drawVectorField();
        this.drawLabels();
        this.drawPredicate();
        this.drawTrace();
    }

    get node(): Element {
        return this.plot.node;
    }

    drawInteraction(): void {
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
                kind: "text", coords: state.polytope.centroid, text: state.label, style: {dy: "3"}
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
        const support = this.actionSupportView.hoverSelection == null
                      ? this.actionSupportView.selection
                      : this.actionSupportView.hoverSelection;
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
        const support = this.actionSupportView.hoverSelection == null
                      ? this.actionSupportView.selection
                      : this.actionSupportView.hoverSelection;
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
        const trace = this.controlView.trace;
        const segments = arr.cyc2map((o, t) => ({ kind: "arrow", origin: o, target: t }), trace);
        if (segments.length > 1) {
            segments.pop();
        }
        this.layers.trace.shapes = segments;
    }

}


// Textual system information and analysis progress bar.
class Summary {

    +node: HTMLDivElement;
    +system: AbstractedLSS;

    constructor(system: AbstractedLSS, analysis: AnalysisRefinement): void {
        this.system = system;
        analysis.attach(() => this.changeHandler());
        this.node = dom.div();
        this.changeHandler();
    }

    changeHandler() {
        let count = 0;
        let volSat = 0;
        let volUnd = 0;
        let volNon = 0;
        for (let state of this.system.states.values()) {
            if (state.isSatisfying) {
                volSat += state.polytope.volume;
            } else if (state.isUndecided) {
                volUnd += state.polytope.volume;
            } else if (!state.isOuter) {
                volNon += state.polytope.volume;
            }
            count++;
        }
        const volAll = volSat + volUnd + volNon;
        const pctSat = volSat / volAll * 100;
        const pctUnd = volUnd / volAll * 100;
        const pctNon = volNon / volAll * 100;
        dom.replaceChildren(this.node, [
            dom.p({}, [count + " states"]),
            dom.div({ "class": "analysis-progress" }, [
                dom.div({
                    "class": "satisfying",
                    "style": "width:" + pctSat + "%;",
                    "title": pctSat.toFixed(1) + "% satisfying"
                }),
                dom.div({
                    "class": "undecided",
                    "style": "width:" + pctUnd + "%;",
                    "title": pctUnd.toFixed(1) + "% undecided"
                }),
                dom.div({
                    "class": "nonsatisfying",
                    "style": "width:" + pctNon + "%;",
                    "title": pctNon.toFixed(1) + "% non-satisfying"
                }),
            ])
        ]);
    }

}

