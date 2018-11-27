// @flow
"use strict";

import type { Region, JSONPolytope, JSONUnion } from "./geometry.js";
import type { JSONGameGraph, AnalysisResults } from "./game.js";
import type { Refinery, PartitionMap } from "./refinement.js";
import type { LSS, State, Trace, JSONAbstractedLSS } from "./system.js";

import { controller } from "./controller.js";
import { Polytope, Union } from "./geometry.js";
import { Refineries, partitionMap } from "./refinement.js";
import { AbstractedLSS } from "./system.js";
import { iter, sets, obj } from "./tools.js";
import { Communicator } from "./worker.js";


// https://github.com/facebook/flow/issues/3128
declare var self: DedicatedWorkerGlobalScope;


type Snapshot = {
    id: number,
    name: string,
    states: number,
    ratios: { [string]: number },
    system: JSONAbstractedLSS,
    analysis: ?AnalysisResults,
    // Tree structure
    parent: ?Snapshot,
    children: Set<Snapshot>
}


class SnapshotManager {

    _id: number;
    _snapshots: Map<number, Snapshot>;
    _root: ?Snapshot;
    _current: ?Snapshot;
    _system: ?AbstractedLSS;
    _analysis: ?AnalysisResults;
    _refineries: { [string]: Refinery };

    constructor(): void {
        this._snapshots = new Map();
        this._id = 0;
        this._root = null;
        this._current = null;
        this._system = null;
        this._analysis = null;
    }

    // Basic accessors

    get system(): AbstractedLSS {
        if (this._system == null) throw new Error(
            "system worker is not initialized yet (system is not set)"
        );
        return this._system;
    }

    get lss(): LSS {
        return this.system.lss;
    }

    // Transferable tree representation for widget-display

    get tree(): SnapshotData {
        if (this._root == null) throw new Error(
            "system worker is not initialized yet (snapshot tree root is not set)"
        );
        return this._treeify(this._root);
    }

    _treeify(node: Snapshot): SnapshotData {
        return {
            id: node.id,
            name: node.name,
            states: node.states,
            ratios: node.ratios,
            children: sets.map(_ => this._treeify(_), node.children),
            isCurrent: node === this._current
        };
    }

    // Startup (has to be called before instance can be used)

    initialize(system: AbstractedLSS): void {
        this._snapshots.clear();
        this._system = system;
        this.take("Initial Problem");
        this._setupRefineries();
    }

    // Snapshot management

    take(name: string): void { // TODO: analysis results
        const snapshot = {
            id: this._id++,
            name: name,
            states: this.system.states.size,
            ratios: this._volumeRatios(),
            system: this.system.serialize(true), // include actions/supports
            analysis: this._analysis,
            parent: this._current,
            children: new Set()
        }
        // Maintain snapshot tree
        if (this._current != null) {
            this._current.children.add(snapshot);
        } else {
            this._root = snapshot;
        }
        // Maintain direct access name-mapping
        this._snapshots.set(snapshot.id, snapshot);
        // Update current snapshot, no need to update system (mutable)
        this._current = snapshot;
    }

    load(id: number): void {
        const snapshot = this._snapshots.get(id);
        if (snapshot == null) throw new Error(
            "Snapshot with id " + id + "does not exist"
        );
        this._current = snapshot;
        this._system = AbstractedLSS.deserialize(snapshot.system);
        this._analysis = snapshot.analysis;
        this._setupRefineries();
    }

    rename(id: number, name: string): void {
        const snapshot = this._snapshots.get(id);
        if (snapshot == null) throw new Error(
            "Snapshot with id " + id + "does not exist"
        );
        snapshot.name = name;
    }

    // Wrapped system functionality (with additional housekeeping)

    processAnalysis(results: AnalysisResults): Set<State> {
        this._analysis = results;
        const updated = new Set(); // TODO
        // Refinery setup is affected by analysis results and system, so both
        // have to be updated earlier
        this._setupRefineries();
        return updated;
    }

    refine(steps: Iterable<string>, states: Iterable<State>): Set<State> {
        const refineries = [];
        for (let step of steps) {
            const refinery = this._refineries[step];
            if (refinery == null) throw new Error("Refinement step '" + step + "' not recognized");
            refineries.push(refinery);
        }
        return this.system.refine(partitionMap(refineries, states));
    }

    _setupRefineries(results: ?AnalysisResults): void {
        this._refineries = obj.map((key, Cls) => new Cls(this.system, this._analysis), Refineries);
    }

    // System status

    _volumeRatios(): { [string]: number } {
        let volSat = 0;
        let volUnd = 0;
        let volNon = 0;
        for (let state of this.system.states.values()) {
            if (false) {
                volSat += state.polytope.volume;
            } else if (true) {
                volUnd += state.polytope.volume;
            } else if (false) {
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

}

const $ = new SnapshotManager();


const communicator = new Communicator("2W");

// States of the system
export type StateRequest = string;
export type StatesRequest = null;
export type StateData = {
    label: string
};
export type StateDataPlus = StateData & {
    polytope: JSONPolytope,
    centroid: number[],
    predicates: Set<string>,
    numberOfActions: number
};
communicator.onRequest("getState", function (data: StateRequest): StateDataPlus {
    return stateDataPlusOf($.system.getState(data));
});
communicator.onRequest("getStates", function (data: StatesRequest): StateDataPlus[] {
    return Array.from(iter.map(stateDataPlusOf, $.system.states.values()));
});

function stateDataOf(state: State): StateData {
    return { label: state.label };
}
function stateDataPlusOf(state: State): StateDataPlus {
    return {
        label: state.label,
        polytope: state.polytope.serialize(),
        centroid: state.polytope.centroid,
        predicates: state.predicates,
        numberOfActions: state.actions.length
    };
}


// Actions of a state
export type ActionRequest = string;
export type ActionData = {
    origin: StateData,
    id: number,
    controls: JSONUnion,
    targets: StateData[]
};
communicator.onRequest("getActions", function (data: ActionRequest): ActionData[] {
    return $.system.getState(data).actions.map((action, id) => ({
        origin: stateDataOf(action.origin),
        id: id,
        controls: action.controls.toUnion().serialize(),
        targets: action.targets.map(stateDataOf)
    }));
});


// Supports of an action
export type SupportRequest = [string, number];
export type SupportData = {
    origin: StateData,
    id: number,
    origins: JSONUnion,
    targets: StateData[]
};
communicator.onRequest("getSupports", function (data: SupportRequest): SupportData[] {
    const [stateLabel, actionId] = data;
    const state = $.system.getState(stateLabel);
    return state.actions[actionId].supports.map((support, id) => ({
        origin: stateDataOf(state),
        id: id,
        origins: support.origins.toUnion().serialize(),
        targets: support.targets.map(stateDataOf)
    }));
});


// Operator of a state
export type OperatorRequest = [string, string, JSONUnion];
export type OperatorData = JSONUnion;
const OPERATORS: { [string]: (State, Union) => Region } = {
    "post":  (state, us) => state.isOuter ? Polytope.ofDim($.lss.dim).empty() : state.post(us),
    "pre":   (state, us) => $.lss.pre($.lss.xx, us, state.polytope),
    "preR":  (state, us) => $.lss.preR($.lss.xx, us, state.polytope),
    "attr":  (state, us) => $.lss.attr($.lss.xx, us, state.polytope),
    "attrR": (state, us) => $.lss.attrR($.lss.xx, us, state.polytope)
};
communicator.onRequest("getOperator", function (data: OperatorRequest): OperatorData {
    const [operator, stateLabel, control] = data;
    const state = $.system.getState(stateLabel);
    const us = Union.deserialize(control);
    return OPERATORS[operator](state, us).toUnion().serialize(); // TODO: enforce Union
});


// Trace through a system
export type TraceRequest = [string|null, string, number];
export type TraceData = Trace;
communicator.onRequest("sampleTrace", function (data: TraceRequest): TraceData {
    const [sourceLabel, controllerName, maxSteps] = data;
    const srcPoly = sourceLabel == null ? $.lss.xx : $.system.getState(sourceLabel).polytope;
    const Strategy = controller[controllerName];
    if (Strategy == null) throw new Error(
        "Control strategy " + controllerName + " cannot be found"
    );
    return $.system.sampleTrace(srcPoly.sample(), new Strategy($.system), maxSteps);
});


// Game abstraction for analysis of the system wrt the objective
export type GameGraphRequest = null;
export type GameGraphData = JSONGameGraph;
communicator.onRequest("getGameGraph", function (data: GameGraphRequest): GameGraphData {
    return $.system.serializeGameGraph();
});


// 
export type ProcessAnalysisRequest = AnalysisResults;
export type ProcessAnalysisData = Set<string>;
communicator.onRequest("processAnalysis", function (data: ProcessAnalysisRequest): ProcessAnalysisData {
    return sets.map(_ => _.label, $.processAnalysis(data));
});


// Refine the system
export type RefineRequest = [?string, string[]];
export type RefineData = Set<string>;
communicator.onRequest("refine", function (data: RefineRequest): RefineData {
    const [stateLabel, steps] = data;
    // Which states to refine?
    const states = [];
    if (stateLabel == null) {
        states.push(...$.system.states.values()); // TODO: only choose undecided states
    } else {
        const state = $.system.getState(stateLabel);
        // TODO verify that state is undecided for any automaton state
        states.push(state);
    }
    // Return set of states that were changed by refinement
    return sets.map(_ => _.label, $.refine(steps, states));
});


export type SnapshotsRequest = null;
export type SnapshotData = {
    id: number,
    name: string,
    states: number,
    ratios: { [string]: number },
    children: Set<SnapshotData>,
    isCurrent: boolean
};
communicator.onRequest("getSnapshots", function (data: SnapshotsRequest): SnapshotData {
    return $.tree;
});

export type TakeSnapshotRequest = string;
export type TakeSnapshotData = null;
communicator.onRequest("takeSnapshot", function (data: TakeSnapshotRequest): TakeSnapshotData {
    $.take(data);
    return null;
});

export type LoadSnapshotRequest = number;
export type LoadSnapshotData = null;
communicator.onRequest("loadSnapshot", function (data: LoadSnapshotRequest): LoadSnapshotData {
    $.load(data);
    return null;
});

export type NameSnapshotRequest = [number, string];
export type NameSnapshotData = null;
communicator.onRequest("nameSnapshot", function (data: NameSnapshotRequest): NameSnapshotData {
    $.rename(...data);
    return null;
});


// Because https://github.com/facebook/flow/pull/6100 is not merged yet:
// $FlowFixMe
communicator.host = self;


// Initialize
communicator.request("init", null).then(function (data: JSONAbstractedLSS) {
    $.initialize(AbstractedLSS.deserialize(data));
    return communicator.request("ready", null);
});

