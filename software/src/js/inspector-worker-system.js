// @flow
"use strict";

import type { JSONTrace } from "./controller.js";
import type { Region, JSONPolytope, JSONUnion } from "./geometry.js";
import type { JSONGameGraph, AnalysisResult, AnalysisResults } from "./game.js";
import type { JSONObjective, AutomatonStateID } from "./logic.js";
import type { StateRefinerySettings, LayerRefinerySettings } from "./refinement.js";
import type { StateID, ActionID, SupportID, PredicateID, LSS, State,
              JSONAbstractedLSS } from "./system.js";

import { Controller, Trace } from "./controller.js";
import { TwoPlayerProbabilisticGame } from "./game.js";
import { Polytope, Union } from "./geometry.js";
import { Objective } from "./logic.js";
import { StateRefinery, LayerRefinery } from "./refinement.js";
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

    loadSnapshot(id: number): void {
        this._snapshots.select(id);
        this._system = this._snapshots.getSystem();
        this._analysis = this._snapshots.getAnalysis();
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
        // TODO: analysis statistics
        this._analysis = results;
        return {
            tGame: (t1 - t0),
            tAnalysis: (t2 - t1)
        };
    }

    refineState(x: State, method: string, settings: StateRefinerySettings): Set<State> {
        const analysis = just(this.analysis, "Refinement requires an analysed system");
        // Initialize refinement method
        const Cls = just(StateRefinery.builtIns()[method]); // TODO: error message
        const refinery = new Cls(this.system, this.objective, analysis, settings);
        // Apply partitioning to system (in-place)
        const refinementMap = x.refine(refinery.partition(x));
        // Update analysis results
        analysis.remap(refinementMap);
        // Return set of states that were refined
        return new Set(refinementMap.keys());
    }

    refineLayer(settings: LayerRefinerySettings): Set<State> {
        const analysis = this.analysis;
        if (analysis == null) throw new Error(
            "Refinement requires an analysed system" // TODO: analysis generally not required for layer-based refinement
        );
        const refinery = new LayerRefinery(this.system, this.objective, analysis, settings)
        const refinementMap = this.system.refine(refinery.partitionAll(this.system.states.values()));
        // Update analysis results
        analysis.remap(refinementMap);
        // Return set of states that were refined
        return new Set(refinementMap.keys());
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


// System information summary
export type SystemSummaryRequest = null;
export type SystemSummaryData = Map<AutomatonStateID, { count: SystemStats, volume: SystemStats }>;
inspector.onRequest("get-system-summary", function (data: SystemSummaryRequest): SystemSummaryData {
    return new Map(iter.map(
        q => [q, { count: $.getCountStats(q), volume: $.getVolumeStats(q) }],
        $.objective.allStates
    ));
});


// Actions of a state
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
        targets: action.targets.map(_ => _.label)
    }));
});


// Supports of an action
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
        targets: support.targets.map(stateDataOf)
    }));
});


// Trace Sampling
export type TraceRequest = [string, ?StateID, AutomatonStateID];
export type TraceData = JSONTrace;
inspector.onRequest("get-trace", function (data: TraceRequest): TraceData {
    const [controllerName, xLabel, qLabel] = data;
    // ...
    const Cls = just(
        Controller.builtIns()[controllerName],
        "Controller '" + controllerName + "' not found in built-in controllers"
    );
    const controller = new Cls($.system, $.objective, $.analysis);
    // ...
    const qInit = $.objective.getState(qLabel);
    const xInit = xLabel == null
                ? $.system.lss.xx.sample()
                : $.system.getState(xLabel).polytope.sample();
    // ...
    const trace = new Trace($.system, $.objective);
    trace.stepFor(100, controller, xInit, null, qInit);
    return trace.serialize();
});


// Analyse the system
export type AnalysisRequest = null;
export type AnalysisData = {
    tGame: number,
    tAnalysis: number
};
inspector.onRequest("analyse", function (data: AnalysisRequest): AnalysisData {
    return $.analyse();
});


// Refinement
export type RefineData = {
    elapsed: number,
    states: Set<StateID>
};
// State-based
export type RefineStateRequest = [StateID, string, StateRefinerySettings];
inspector.onRequest("refine-state", function (data: RefineStateRequest): RefineData {
    const [label, method, settings] = data;
    const x = $.system.getState(label);
    const t0 = performance.now();
    const states = sets.map(_ => _.label, $.refineState(x, method, settings));
    const t1 = performance.now();
    return {
        elapsed: (t1 - t0),
        states: states
    };
});
// Layer-based
export type RefineLayerRequest = LayerRefinerySettings;
inspector.onRequest("refine-layer", function (settings: RefineLayerRequest): RefineData {
    const t0 = performance.now();
    const states = sets.map(_ => _.label, $.refineLayer(settings));
    const t1 = performance.now();
    return {
        elapsed: (t1 - t0),
        states: states
    };
});


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
export type LoadSnapshotData = null;
inspector.onRequest("load-snapshot", function (data: LoadSnapshotRequest): LoadSnapshotData {
    $.loadSnapshot(data);
    return null;
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

