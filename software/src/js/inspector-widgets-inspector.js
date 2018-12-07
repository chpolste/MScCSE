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



export class SystemInspector extends ObservableMixin<null> {

    +node: HTMLDivElement;
    +systemComm: Communicator<Worker>;
    +_log: HTMLDivElement;
    +tabs: TabbedView;
    // ...
    +objective: Objective;
    +_system: AbstractedLSS;

    constructor(system: AbstractedLSS, objective: Objective, keybindings: dom.Keybindings) {
        super();

        try {
            this.systemComm = new Communicator("ISYS");
            this.systemComm.onRequest("init", data => {
                return system.serialize();
            });
            this.systemComm.onRequest("ready", data => {
                this.notify();
                snapshotCtrl.handleChange(); // TODO: explain
            });
            const worker = new Worker("./js/inspector-worker-system.js");
            worker.onerror = () => {
                this.logError({ name: "WorkerError", message: "unable to start system worker" });
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

        this.objective = objective;
        this._system = system;

        const viewCtrl = new ViewCtrl(this, keybindings);
        const analysisCtrl = new AnalysisCtrl(this, keybindings);
        const automatonView = new AutomatonView(this, keybindings);
        const stateView = new StateView(this, automatonView);
        const actionView = new ActionView(this, stateView);
        const supportView = new ActionSupportView(this, actionView);
        const traceView = new TraceView(this, stateView, keybindings);
        const systemView = new SystemView(
            this, viewCtrl, stateView, actionView, supportView, automatonView, traceView
        );
        const refinementCtrl = new RefinementCtrl(this, analysisCtrl, stateView, keybindings);
        const spaceView = new SpaceView(this, traceView, actionView);
        const snapshotCtrl = new SnapshotCtrl(this, analysisCtrl);

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
                plotterLink.href = "plotter-2d.html#" + systemView.toExportURL();
            });
            dom.appendChildren(appLinks, [" :: ", plotterLink]);
        }
        // Debut: Message
        this._log = dom.DIV({ "id": "log-view" }, ["-"]);

        this.tabs = new TabbedView({
            "Game": [
                dom.H3({}, ["Selection", dom.infoBox("info-state")]),
                stateView.node,
                dom.H3({}, ["Actions", dom.infoBox("info-actions")]),
                actionView.node,
                dom.H3({}, ["Action Supports", dom.infoBox("info-supports")]),
                supportView.node
            ],
            "System": [
                dom.H3({}, ["System Analysis", dom.infoBox("info-analysis")]),
                analysisCtrl.node,
                dom.H3({}, ["Abstraction Refinement", dom.infoBox("info-refinement")]),
                refinementCtrl.node,
                dom.H3({}, ["Snapshots", dom.infoBox("info-snapshots")]),
                snapshotCtrl.node
            ],
            "Objective": [
                dom.H3({}, ["Trace Sample", dom.infoBox("info-trace")]),
                traceView.node
            ],
            "Debug": [
                dom.H3({}, ["Connectivity"]),
                appLinks,
                dom.H3({}, ["Error Message"]),
                this._log
            ]
        }, "System");

        this.node = dom.DIV({ "id": "inspector" }, [
            dom.DIV({ "class": "left" }, [
                systemView.node,
                dom.DIV({"class": "cols"}, [
                    dom.DIV({ "class": "left" }, [
                        dom.H3({}, ["Control and Random Space", dom.infoBox("info-control")]),
                        spaceView.node,
                        dom.H3({}, ["View Settings", dom.infoBox("info-settings")]),
                        viewCtrl.node
                    ]),
                    dom.DIV({ "class": "right" }, [
                        dom.H3({}, ["Objective Automaton", dom.infoBox("info-automaton")]),
                        automatonView.node
                    ])
                ])
            ]),
            this.tabs.node
        ]);
    }

    // Static information from the system

    get lss(): LSS {
        return this._system.lss;
    }

    getPredicate(label: PredicateID): Halfspace {
        return this._system.getPredicate(label);
    }

    log(text: string): void {
        dom.replaceChildren(this._log, [text]);
    }

    logError(e: { name: string, message: string }): void {
        console.log(e);
        this.log(e.name + " :: " + e.message);
        this.tabs.highlight("Debug");
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

    getOperator(op: string, state: StateID, us: JSONUnion): Promise<OperatorData> {
        return this.systemComm.request("getOperator", [op, state, us]);
    }

    getGameGraph(): Promise<GameGraphData> {
        return this.systemComm.request("getGameGraph", null);
    }

    sampleTrace(state: ?StateID, controller: string, maxSteps: number): Promise<TraceData> {
        return this.systemComm.request("sampleTrace", [state, controller, maxSteps]);
    }

    processAnalysis(results: AnalysisResults): Promise<ProcessAnalysisData> {
        return this.systemComm.request("processAnalysis", results).then(data => {
            // Returned is the set of states that has changed kind
            //if (data.size > 0) this.notify();
            this.notify(); // TODO
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
        return this.systemComm.request("takeSnapshot", name);
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
        dom.replaceChildren(this.content, nodes.map(_ => (_ instanceof Element ? _ : _.node)));
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

// Contains and provides information on and preview of the currently selected
// state.
class StateView extends ObservableMixin<null> {

    +node: HTMLDivElement;
    +proxy: SystemInspector;
    +automatonView: AutomatonView;
    +lines: HTMLDivElement[];
    +predicates: SelectableNodes<string>;
    _selection: ?StateDataPlus;

    constructor(proxy: SystemInspector, automatonView: AutomatonView): void {
        super();
        this.proxy = proxy;
        this.proxy.attach(() => this.refreshSelection());
        this.automatonView = automatonView;
        this.automatonView.attach(() => this.handleChange());
        this.lines = [dom.DIV(), dom.DIV(), dom.DIV()];
        this.predicates = new SelectableNodes(
            _ => predicateLabel(_, this.proxy.getPredicate(_)), "-", ", "
        );
        this.predicates.node.className = "predicates";
        this.node = dom.DIV({ "id": "state-view" }, [
            dom.DIV({}, [dom.DIV({ "class": "label" }, ["State:"]), this.lines[0]]),
            dom.DIV({}, [dom.DIV({ "class": "label" }, ["Actions:"]), this.lines[1]]),
            dom.DIV({}, [dom.DIV({ "class": "label" }, ["Analysis:"]), this.lines[2]]),
            dom.DIV({}, [dom.DIV({ "class": "label" }, ["Predicates:"]), this.predicates.node]),
        ]);
        this._selection = null;
        this.handleChange();
    }

    get selection(): ?StateDataPlus {
        return this._selection;
    }

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
        if (state != null) {
            const automatonState = this.automatonView.selection;
            const analysis = state.analysis;
            // Line 1: system and automaton labels
            dom.replaceChildren(this.lines[0], [
                stateLabel(state, state), ", ", automatonLabel(automatonState, analysis)
            ]);
            // Line 2: action and automaton transition
            if (state.isOuter) {
                dom.replaceChildren(this.lines[1], ["0 (outer state)"]);
            } else if (analysisKind(automatonState, analysis) === "unreachable") {
                dom.replaceChildren(this.lines[1], ["0 (state is unreachable)"]);
            } else if (analysis != null) {
                const next = analysis.next[automatonState];
                if (next == null) throw new Error(
                    "no next automaton state found for reachable state " + state.label // TODO: recover
                );
                dom.replaceChildren(this.lines[1], [
                    state.numberOfActions.toString(), " (transition to ",
                    automatonLabel(next, null), ")"
                ]);
            } else {
                dom.replaceChildren(this.lines[1], [state.numberOfActions.toString()]);
            }
            // Line 3: analysis kinds
            if (analysis == null) {
                dom.replaceChildren(this.lines[2], ["?"]);
            } else {
                dom.replaceChildren(this.lines[2], arr.intersperse(
                    ", ", iter.map(_ => automatonLabel(_, analysis), this.automatonView.allStates)
                ));
            };
            // Line 4: linear predicates
            this.predicates.items = Array.from(state.predicates);
            this.notify();
        } else {
            for (let line of this.lines) dom.replaceChildren(line, ["-"]);
            this.predicates.items = [];
            this.notify();
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
        this.node.id = "action-view";
        this.proxy = proxy;
        this.stateView = stateView;
        this.stateView.attach(() => this.handleChange());
    }

    handleChange(): void {
        const state = this.stateView.selection;
        if (state != null) {
            this.proxy.getActions(state.label).then(actions => {
                this.items = actions;
            }).catch(e => {
                this.proxy.logError(e);
            });
        } else {
            this.items = [];
        }
    }

    static asNode(action: ActionData): HTMLDivElement {
        return dom.DIV({}, [
            stateLabel(action.origin, action.origin), " → {",
            ...arr.intersperse(", ", action.targets.map(
                target => stateLabel(target, action.origin)
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
        this.node.id = "support-view";
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
            }).catch(e => {
                this.proxy.logError(e);
            });
        } else {
            this.items = [];
        }
    }

    static asNode(support: SupportData): HTMLDivElement {
        return dom.DIV({}, [
            "{",
            ...arr.intersperse(", ", support.targets.map(
                target => stateLabel(target, support.origin)
            )),
            "}"
        ]);
    }

}


// Tab: System
// - AnalysisCtrl
// - RefinementCtrl
// - SnapshotCtrl

class AnalysisCtrl extends ObservableMixin<null> {

    +node: HTMLDivElement;
    +proxy: SystemInspector;
    +button: HTMLButtonElement;
    +info: HTMLSpanElement;
    communicator: ?Communicator<Worker>;
    _ready: boolean;

    constructor(proxy: SystemInspector, keybindings: dom.Keybindings): void {
        super();
        this.proxy = proxy;
        // Control elements, information display, keybindings
        this.button = dom.BUTTON({}, [dom.create("u", {}, ["a"]), "nalyse"]);
        this.button.addEventListener("click", () => this.analyse());
        this.info = dom.SPAN();
        this.node = dom.DIV({ "id": "analysis-ctrl"}, [
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
                this.infoText = "startup error"
                this.proxy.logError({ name: "WorkerError", message: "unable to start analysis web worker" });
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
        let startTime = performance.now();
        // Redirect game graph to analysis worker and wait for results
        this.proxy.getGameGraph().then(gameGraph => {
            this.infoText = "analysing...";
            if (this.communicator == null) throw new Error(
                "worker not available, game analysis not possible"
             );
            return this.communicator.request("analysis", gameGraph);
        // Hand over analysis results to system worker (triggers update of
        // system state kinds)
        }).then(results => {
            this.infoText = "processing results...";
            return this.proxy.processAnalysis(results);
        // Show information message
        }).then(updated => {
            const s = updated.size;
            const elapsed = performance.now() - startTime;
            this.infoText = "Updated " + s + (s === 1 ? " state" : " states") + " after " + t2s(elapsed) + ".";
            this.ready = true;
        }).catch(err => {
            this.infoText = "analysis error";
            this.proxy.logError(err);
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
    +proxy: SystemInspector;
    +stateView: StateView;
    +analysisCtrl: AnalysisCtrl;
    +info: HTMLSpanElement;
    +buttons: { [string]: HTMLButtonElement };
    +_steps: RefinementStep[];
    +stepBox: HTMLDivElement;
    
    constructor(proxy: SystemInspector, analysisCtrl: AnalysisCtrl, stateView: StateView,
            keybindings: dom.Keybindings): void {
        this.proxy = proxy;
        this.analysisCtrl = analysisCtrl;
        this.analysisCtrl.attach(() => this.handleChange());
        this.stateView = stateView;
        this.stateView.attach(() => this.handleChange());
        // Information display
        this.info = dom.SPAN();
        // Refinement step configurator
        this._steps = [
            this._newStep("Negative Attractor", "NegativeAttr"),
            this._newStep("Positive Robust Predecessor", "PositivePreR"),
            this._newStep("Positive Robust Attractors (TODO)", "PositiveAttrR")
        ];
        this.stepBox = dom.DIV({ "id": "refinement-ctrl" }, [
            dom.P({}, ["The following refinement steps are applied in order:"]),
            ...this._steps.map(_ => _.node)
        ]);
        // Interface
        this.buttons = {
            refineAll: dom.BUTTON({}, [dom.create("u", {}, ["r"]), "efine all"]),
            refineOne: dom.BUTTON({}, ["r", dom.create("u", {}, ["e"]), "fine selection"])
        };
        this.buttons.refineAll.addEventListener("click", () => this.refineAll());
        this.buttons.refineOne.addEventListener("click", () => this.refineOne());
        this.node = dom.DIV({}, [
            dom.P({}, [this.buttons.refineAll, " ", this.buttons.refineOne, " ", this.info]),
            this.stepBox
        ]);
        // Keyboard Shortcuts
        keybindings.bind("r", () => this.refineAll());
        keybindings.bind("e", () => this.refineOne());
        // Initialize
        this.handleChange();
    }

    get steps(): string[] {
        return this._steps.filter(_ => _.toggle.checked).map(_ => _.name);
    }

    set infoText(text: string): void {
        dom.replaceChildren(this.info, [text]);
    }

    refine(which: ?StateData): void {
        if (this.analysisCtrl.ready) {
            const state = which == null ? null : which.label;
            this.proxy.refine(state, this.steps).then(data => {
                this.infoText = "Refined " + data.size + (data.size === 1 ? " state." : " states.");
            }).catch(e => {
                this.proxy.logError(e);
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
        if (state != null) {
            this.refine(state);
        }
    }

    handleChange(): void {
        const ready = this.analysisCtrl.ready;
        const state = this.stateView.selection;
        this.buttons["refineAll"].disabled = !ready;
        this.buttons["refineOne"].disabled = !(ready && state != null);
    }

    _newStep(text: string, name: string): RefinementStep {
        const toggle = dom.INPUT({ "type": "checkbox" });
        const up = dom.BUTTON({}, ["▲"]);
        up.addEventListener("click", () => {
            const i = this._steps.indexOf(step);
            if (i > 0) {
                const other = this._steps[i - 1];
                this.stepBox.insertBefore(step.node, other.node);
                this._steps[i - 1] = step;
                this._steps[i] = other;
            }
        });
        const down = dom.BUTTON({}, ["▼"]);
        down.addEventListener("click", () => {
            const i = this._steps.indexOf(step);
            if (i < this._steps.length - 1) {
                const other = this._steps[i + 1];
                this.stepBox.insertBefore(other.node, step.node);
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


class SnapshotCtrl {

    +node: HTMLDivElement;
    +proxy: SystemInspector;
    +analysisCtrl: AnalysisCtrl;
    +forms: { [string]: HTMLButtonElement|HTMLInputElement };
    +treeView: HTMLDivElement;
    // Internal state
    _data: ?SnapshotData;
    _selection: ?number;

    constructor(proxy: SystemInspector, analysisCtrl: AnalysisCtrl): void {
        this.proxy = proxy;
        this.analysisCtrl = analysisCtrl;
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
        this.node = dom.DIV({ "id": "snapshot-ctrl"}, [
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
        this.proxy.takeSnapshot(name.length === 0 ? "Snapshot" : name);
        this.handleChange();
    }

    loadSnapshot(): void {
        const selection = this._selection;
        if (selection != null) {
            this.proxy.loadSnapshot(selection).then(data => {
                this.handleChange();
            }).catch(e => {
                this.proxy.logError(e);
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
            }).catch(e => {
                this.proxy.logError(e);
            });
        }
    }

    handleChange(): void {
        this.forms.take.disabled = false;
        this.proxy.getSnapshots().then(data => {
            this._data = data;
            this.redraw();
        }).catch(e => {
            this.proxy.logError(e);
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



// Tab: Control
// - TraceView

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
        this.arrowLayer = fig.newLayer({ "stroke": COLORS.trace, "stroke-width": "1.5", "fill": COLORS.trace });
        this.interactionLayer = fig.newLayer({ "stroke": "none", "fill": "#FFF", "fill-opacity": "0" });
        const proj = new Horizontal1D([-1, 0.01], [0, 1]);
        const plot = new ShapePlot([480, 20], fig, proj, false);

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

        this.node = dom.DIV({ "id": "trace-ctrl" }, [
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
        }).catch(e => {
            this.proxy.logError(e);
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


type OperatorWrapper = (StateData, JSONUnion) => Promise<OperatorData>;
// Settings panel for the main view.
class ViewCtrl extends ObservableMixin<null> {

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

        this.toggleKind = new CheckboxInput(false);
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

        this.node = dom.DIV({ "id": "view-ctrl" }, [
            dom.P({ "class": "highlight" }, [
                this.highlight.node, " ", dom.create("u", {}, ["h"]), "ighlight" 
            ]),
            dom.LABEL({}, [this.toggleKind.node, "Analysis C", dom.create("u", {}, ["o"]), "lors"]),
            dom.LABEL({}, [this.toggleLabel.node, "State ", dom.create("u", {}, ["L"]), "abels"]),
            dom.LABEL({}, [this.toggleVectorField.node, dom.create("u", {}, ["V"]), "ector Field"])
        ]);

        keybindings.bind("o", inputTextRotation(this.toggleKind, ["t", "f"]));
        keybindings.bind("l", inputTextRotation(this.toggleLabel, ["t", "f"]));
        keybindings.bind("v", inputTextRotation(this.toggleVectorField, ["t", "f"]));
        keybindings.bind("h", inputTextRotation(this.highlight, [
            "None", "Posterior", "Predecessor", "Robust Predecessor", "Attractor", "Robust Attractor"
        ]));
    }

}


class SpaceView {

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
        this.ctrlPlot = new AxesPlot([120, 120], ctrlFig, autoProjection(1));
        this.randPlot = new AxesPlot([120, 120], randFig, autoProjection(1));
        this.node = dom.DIV({}, [this.ctrlPlot.node, this.randPlot.node]);

        this.drawSpaces();
    }

    drawSpaces(): void {
        const controlSpace = this.proxy.lss.uus;
        const randomSpace = this.proxy.lss.ww;
        this.ctrlPlot.projection = autoProjection(1, ...controlSpace.extent);
        this.ctrlLayers.poly.shapes = controlSpace.polytopes.map(u => ({ kind: "polytope", vertices: u.vertices }));
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
            this.ctrlLayers.action.shapes = action.controls.polytopes.map(
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
// ViewCtrl             → Toggle labels, kinds, vector field. Select polytopic operator.
// AnalysisCtrl         → Kind changes after analysis.
// RefinementCtrl       → System refresh after refinement.
// StateView            → Selected state.
// ActionView           → Selected action.
// ActionSupportView    → Selected action support.
// AutomatonView        → Analysis state kind.
// TraceView            → Trace sample.
class SystemView {

    +proxy: SystemInspector;
    +viewCtrl: ViewCtrl;
    +stateView: StateView;
    +traceView: TraceView;
    +actionView: ActionView;
    +supportView: ActionSupportView;
    +automatonView: AutomatonView;
    +plot: InteractivePlot;
    +layers: { [string]: FigureLayer };
    // Data caches
    _data: ?StateDataPlus[];
    _centroid: { [string]: Vector };

    constructor(proxy: SystemInspector, viewCtrl: ViewCtrl, stateView: StateView,
                actionView: ActionView, supportView: ActionSupportView,
                automatonView: AutomatonView, traceView: TraceView): void {
        this.proxy = proxy;
        this._data = null;
        this._centroid = {};

        proxy.attach(() => this.drawSystem());

        this.viewCtrl = viewCtrl;
        this.viewCtrl.toggleKind.attach(() => this.drawKind());
        this.viewCtrl.toggleLabel.attach(() => this.drawLabels());
        this.viewCtrl.toggleVectorField.attach(() => this.drawVectorField());
        this.viewCtrl.highlight.attach(() => this.drawHighlight());

        this.automatonView = automatonView;
        this.automatonView.attach(() => this.drawKind());

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
            label:          fig.newLayer({ "font-family": "DejaVu Sans, sans-serif", "font-size": "8pt", "text-anchor": "middle", "transform": "translate(0 3)" }),
            interaction:    fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#FFF", "fill-opacity": "0" })
        };
        this.plot = new InteractivePlot([660, 440], fig, autoProjection(3/2, ...this.proxy.lss.extent));

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
                    click: () => {
                        this.stateView.selection = state;
                    }
                }
            }));
            this.drawKind();
            this.drawLabels();
        }).catch(e => {
            this.proxy.logError(e);
        });
    }

    drawHighlight(): void {
        const operator = this.viewCtrl.highlight.value;
        const state = this.stateView.selection;
        if (operator == null || state == null) {
            this.layers.highlight1.shapes = [];
            this.layers.highlight2.shapes = [];
        } else {
            const action = this.actionView.hoverSelection == null
                         ? this.actionView.selection
                         : this.actionView.hoverSelection;
            const control = action == null ? this.proxy.lss.uus.toUnion().serialize() : action.controls;
            operator(state, control).then(data => {
                const shapes = data.polytopes.map(
                    poly => ({ kind: "polytope", vertices: poly.vertices })
                );
                this.layers.highlight1.shapes = shapes;
                this.layers.highlight2.shapes = shapes;
            }).catch(e => {
                this.proxy.logError(e);
            });

        }
    }

    drawVectorField(): void {
        const shapes = [];
        if (this.viewCtrl.toggleVectorField.value) {
            shapes.push({
                kind: "vectorField",
                fun: x => linalg.apply(this.proxy.lss.A, x),
                n: [12, 12]
            });
        }
        this.layers.vectorField.shapes = shapes;
    }

    drawKind(): void {
        if (this._data != null) {
            let color = stateColorSimple;
            if (this.viewCtrl.toggleKind.value) {
                color = (state) => stateColor(state, this.automatonView.selection);
            }
            this.layers.kind.shapes = this._data.map(state => ({
                kind: "polytope", vertices: state.polytope.vertices, style: { fill: color(state) }
            }));
        }
    }

    drawLabels(): void {
        let labels = [];
        if (this._data != null && this.viewCtrl.toggleLabel.value) {
            labels = this._data.map(state => ({
                kind: "label", coords: state.centroid, text: state.label
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
            this.layers.support.shapes = support.origins.polytopes.map(
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

}

