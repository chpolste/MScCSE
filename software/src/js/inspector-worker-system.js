// @flow
"use strict";

import type { JSONTrace } from "./controller.js";
import type { Region, JSONPolytope, JSONUnion } from "./geometry.js";
import type { JSONGameGraph, AnalysisResult, AnalysisResults } from "./game.js";
import type { JSONObjective, AutomatonStateID } from "./logic.js";
import type { Refinery, RobustReachabilitySettings, TransitionRefineryLayers } from "./refinement.js";
import type { Snapshot } from "./snapshot.js";
import type { StateID, ActionID, SupportID, PredicateID, LSS, State, RefinementMap,
              JSONAbstractedLSS } from "./system.js";

import { Controller, Trace } from "./controller.js";
import { TwoPlayerProbabilisticGame } from "./game.js";
import { Polytope, Union } from "./geometry.js";
import { Objective } from "./logic.js";
import { TransitionRefinery, PositiveRobustRefinery, NegativeAttrRefinery, SafetyRefinery,
         SelfLoopRefinery } from "./refinement.js";
import { SnapshotTree } from "./snapshot.js";
import { AbstractedLSS } from "./system.js";
import { just, iter, sets, obj } from "./tools.js";
import { Communicator } from "./worker.js";


// https://github.com/facebook/flow/issues/3128
declare var self: DedicatedWorkerGlobalScope;


type SystemStats = {
    yes: number,
    no: number,
    maybe: number,
    unreachable: number
}

class SystemManager {

    _snapshots: SnapshotTree;
    // Current state of worker
    _system: ?AbstractedLSS;
    _analysis: ?AnalysisResults;
    _objective: ?Objective;

    constructor(): void {
        this._snapshots = new SnapshotTree();
        this._system = null;
        this._analysis = null;
        this._objective = null;
    }

    // Startup (has to be called before instance can be used)

    initialize(system: AbstractedLSS, objective: Objective, analyse: boolean): void {
        this._system = system;
        this._objective = objective;
        if (analyse) this.analyse();
        this.takeSnapshot("Initial Problem");
    }

    // Basic accessors

    get objective(): Objective {
        return just(this._objective, "system worker is not initialized yet (objective is not set)");
    }

    get system(): AbstractedLSS {
        return just(this._system, "system worker is not initialized yet (system is not set)");
    }

    get lss(): LSS {
        return this.system.lss;
    }

    get analysis(): ?AnalysisResults {
        return this._analysis;
    }

    // Transferable tree representation for widget-display

    get snapshotTree(): SnapshotData {
        return this._treeify(this._snapshots.root);
    }

    _treeify(id: number): SnapshotData {
        return {
            id: id,
            name: this._snapshots.getName(id),
            states: this._snapshots.getNumberOfStates(id),
            children: sets.map(_ => this._treeify(_), this._snapshots.getChildren(id)),
            isCurrent: id === this._snapshots.current
        };
    }

    // Snapshot management

    takeSnapshot(name: string): void {
        this._snapshots.take(name, this.system, this.analysis, true);
    }

    loadSnapshot(id: number): Snapshot {
        this._snapshots.select(id);
        this._system = this._snapshots.getSystem();
        this._analysis = this._snapshots.getAnalysis();
        return this._snapshots.getSnapshot();
    }

    nameSnapshot(id: number, name: string): void {
        this._snapshots.rename(id, name);
    }

    // Wrapped system functionality (with additional housekeeping)

    analyse(): AnalysisData {
        const t0 = performance.now();
        const game = TwoPlayerProbabilisticGame.fromProduct(this.system, this.objective, this.analysis);
        const t1 = performance.now();
        const results = game.analyse();
        const t2 = performance.now();
        // Transfer old analysis results if available
        if (this._analysis != null) results.transferFromPrevious(this._analysis);
        // Which system states have changed?
        const updated = results.updated(this._analysis);
        // Save analysis results
        this._analysis = results;
        // Statistics
        return {
            states: [game.p1States.size, game.p2States.size],
            actions: [
                iter.sum(iter.map(_ => _.actions.length, game.p1States)),
                iter.sum(iter.map(_ => _.actions.length, game.p2States))
            ],
            updated: Array.from(updated),
            tGame: (t1 - t0),
            tAnalysis: (t2 - t1)
        };
    }

    resetAnalysis(): void {
        this._analysis = null;
    }

    refine(refinery: Refinery): RefinementMap {
        const partition = refinery.partitionAll(this.system.states.values());
        const refinementMap = this.system.refine(partition);
        // Update analysis results
        const analysis = this.analysis;
        if (analysis != null) {
            analysis.remap(refinementMap);
        }
        return refinementMap;
    }

    // System status

    getAnalysis(state: State): ?AnalysisResult {
        if (this._analysis == null) return null;
        const result = this._analysis.get(state.label);
        return result;
    }

    getCountStats(q: AutomatonStateID): SystemStats {
        return this._stats(q, _ => 1);
    }

    getVolumeStats(q: AutomatonStateID): SystemStats {
        return this._stats(q, _ => _.polytope.volume);
    }

    _stats(q: AutomatonStateID, f: (State) => number): SystemStats {
        let sYes     = 0;
        let sMaybe   = 0;
        let sNo      = 0;
        let sUnreach = 0;
        for (let state of this.system.states.values()) {
            const result = this.getAnalysis(state);
            if (state.isOuter) {
                continue
            } else if (result == null || result.maybe.has(q)) {
                sMaybe += f(state);
            } else if (result.yes.has(q)) {
                sYes += f(state);
            } else if (result.no.has(q)) {
                sNo += f(state);
            } else {
                sUnreach += f(state);
            }
        }
        return { 
            yes: sYes,
            no: sNo,
            maybe: sMaybe,
            unreachable: sUnreach
        };
    }

}


// Global state encapsulated in SystemManager class, instantiated once here and
// initialized later
const $ = new SystemManager();


// Communication with host (inspector application)
const inspector = new Communicator("2W");


/* Game-graph */

// States of the system
export type StateData = {
    label: StateID,
    isOuter: boolean,
    predicates: Set<PredicateID>,
    analysis: ?AnalysisResult,
    polytope: JSONPolytope,
    centroid: number[]
};
export type StatesRequest = null;
export type StatesData = Map<StateID, StateData>;
inspector.onRequest("update-states", function (data: StatesRequest): StatesData {
    const out = new Map();
    for (let [label, state] of $.system.states) {
        out.set(label, stateDataOf(state));
    }
    return out;
});

function stateDataOf(state: State): StateData {
    return {
        label: state.label,
        isOuter: state.isOuter,
        predicates: state.predicates,
        analysis: $.getAnalysis(state),
        polytope: state.polytope.serialize(),
        centroid: state.polytope.centroid
    };
}

// Actions (player 1 actions)
export type ActionsRequest = StateID;
export type ActionData = {
    id: ActionID,
    controls: JSONUnion,
    origin: StateID,
    targets: StateID[]
};
export type ActionsData = ActionData[];
inspector.onRequest("get-actions", function (data: ActionsRequest): ActionsData {
    return $.system.getState(data).actions.map((action, id) => ({
        origin: action.origin.label,
        id: id,
        controls: action.controls.toUnion().serialize(),
        targets: Array.from(action.targets, _ => _.label)
    }));
});

// Supports (player 2 actions)
export type SupportRequest = [StateID, ActionID];
export type SupportData = {
    origin: StateData,
    id: SupportID,
    origins: JSONUnion,
    targets: StateData[]
};
inspector.onRequest("get-supports", function (data: SupportRequest): SupportData[] {
    const [stateLabel, actionId] = data;
    const state = $.system.getState(stateLabel);
    return state.actions[actionId].supports.map((support, id) => ({
        origin: stateDataOf(state),
        id: id,
        origins: support.origins.toUnion().serialize(),
        targets: Array.from(support.targets, stateDataOf)
    }));
});


/* Trace Sampling */

export type TraceRequest = {
    controller: string,
    origin: [?StateID, AutomatonStateID],
    steps: number
};
export type TraceData = JSONTrace;
inspector.onRequest("get-trace", function (data: TraceRequest): TraceData {
    const Cls = just(
        Controller.builtIns()[data.controller],
        "Controller '" + data.controller + "' not found in built-in controllers"
    );
    const controller = new Cls($.system, $.objective, $.analysis);
    const [xLabel, qLabel] = data.origin;
    const qInit = $.objective.getState(qLabel);
    const xInit = xLabel == null
                ? $.system.lss.xx.sample()
                : $.system.getState(xLabel).polytope.sample();
    const trace = new Trace($.system, $.objective);
    trace.stepFor(data.steps, controller, xInit, null, qInit);
    return trace.serialize();
});


/* System Analysis */

// Analyse the system
export type AnalysisRequest = null;
export type AnalysisData = {
    states: [number, number],
    actions: [number, number],
    updated: StateID[],
    tGame: number,
    tAnalysis: number
};
inspector.onRequest("analyse", function (data: AnalysisRequest): AnalysisData {
    return $.analyse();
});

// Reset the analysis state
export type ResetAnalysisRequest = null;
export type ResetAnalysisData = null;
inspector.onRequest("reset-analysis", function (data: ResetAnalysisRequest): ResetAnalysisData {
    $.resetAnalysis();
    return null;
});

// System information summary
export type SystemSummaryRequest = null;
export type SystemSummaryData = Map<AutomatonStateID, { count: SystemStats, volume: SystemStats }>;
inspector.onRequest("get-system-summary", function (data: SystemSummaryRequest): SystemSummaryData {
    return new Map(iter.map(
        q => [q, { count: $.getCountStats(q), volume: $.getVolumeStats(q) }],
        $.objective.allStates
    ));
});


/* Refinement */

export type RefineData = {
    elapsed: number,
    removed: StateID[],
    created: StateID[]
};
function refineData(elapsed, refinementMap): RefineData {
    const removed = [];
    const created = [];
    for (let [r, cs] of refinementMap) {
        removed.push(r.label);
        for (let c of cs) created.push(c.label);
    }
    return {
        elapsed: elapsed,
        removed: removed,
        created: created
    };
}

// Transition-based refinement
export type RefineTransitionRequest = {
    origin: AutomatonStateID,
    target: AutomatonStateID,
    iterations: number,
    layers: ?TransitionRefineryLayers,
    settings: RobustReachabilitySettings

};
inspector.onRequest("refine-transition", function (data: RefineTransitionRequest): RefineData {
    const analysis = just($.analysis, "Refinement requires an analysed system");
    const t0 = performance.now();
    const refinery = new TransitionRefinery($.system, $.objective, analysis, data.origin,
                                            data.target, data.layers, data.settings);
    refinery.iterate(data.iterations);
    const refinementMap = $.refine(refinery);
    const t1 = performance.now();
    return refineData((t1 - t0), refinementMap);
});

// Holistic Refinement
export type RefineHolisticRequest = { method: "positive-robust", operator: "AttrR" | "PreR" }
                                  | { method: "negative-attractor" }
                                  | { method: "safety" }
                                  | { method: "self-loop", optimistic: boolean, onlySafe: boolean };
inspector.onRequest("refine-holistic", function (data: RefineHolisticRequest): RefineData {
    const analysis = just($.analysis, "Refinement requires an analysed system");
    const t0 = performance.now();
    let refinery;
    if (data.method === "positive-robust") {
        refinery = new PositiveRobustRefinery($.system, $.objective, analysis, data.operator)
    } else if (data.method === "negative-attractor") {
        refinery = new NegativeAttrRefinery($.system, $.objective, analysis)
    } else if (data.method === "safety") {
        refinery = new SafetyRefinery($.system, $.objective, analysis)
    } else if (data.method === "self-loop") {
        refinery = new SelfLoopRefinery($.system, $.objective, analysis, data.optimistic, data.onlySafe)
    } else throw new Error(
        "Unknown holistic refinement method '" + data.method + "'"
    );
    const refinementMap = $.refine(refinery);
    const t1 = performance.now();
    return refineData((t1 - t0), refinementMap);
});


/* Snapshot management */

export type SnapshotsRequest = null;
export type SnapshotData = {
    id: number,
    name: string,
    states: number,
    children: Set<SnapshotData>,
    isCurrent: boolean
};
inspector.onRequest("get-snapshots", function (data: SnapshotsRequest): SnapshotData {
    return $.snapshotTree;
});

export type TakeSnapshotRequest = string;
export type TakeSnapshotData = null;
inspector.onRequest("take-snapshot", function (data: TakeSnapshotRequest): TakeSnapshotData {
    $.takeSnapshot(data);
    return null;
});

export type LoadSnapshotRequest = number;
export type LoadSnapshotData = {
    name: string,
    states: number
};
inspector.onRequest("load-snapshot", function (data: LoadSnapshotRequest): LoadSnapshotData {
    const snap = $.loadSnapshot(data);
    return {
        name: snap.name,
        states: snap.system.states.filter(_ => !_.isOuter).length
    };
});

export type NameSnapshotRequest = [number, string];
export type NameSnapshotData = null;
inspector.onRequest("name-snapshot", function (data: NameSnapshotRequest): NameSnapshotData {
    $.nameSnapshot(...data);
    return null;
});



// Because https://github.com/facebook/flow/pull/6100 is not merged yet:
// $FlowFixMe
inspector.host = self;

// Initialize
inspector.request("init", null).then(function (data: [JSONAbstractedLSS, JSONObjective, boolean]) {
    const [system, objective, analyse] = data;
    // Initialize the global state manager
    $.initialize(AbstractedLSS.deserialize(system), Objective.deserialize(objective), analyse);
    // Send the ready signal to the host application
    inspector.request("ready", null);
});

