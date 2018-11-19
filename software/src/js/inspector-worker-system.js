// @flow
"use strict";

import type { JSONConvexPolytope, JSONConvexPolytopeUnion } from "./geometry.js";
import type { JSONGameGraph } from "./game.js";
import type { LSS, State, StateKind, Trace, JSONAbstractedLSS } from "./system.js";

import { controller } from "./controller.js";
import { union } from "./geometry.js";
import { refinery, partitionMap } from "./refinement.js";
import { AbstractedLSS } from "./system.js";
import { iter, sets } from "./tools.js";
import { Communicator } from "./worker.js";


// https://github.com/facebook/flow/issues/3128
declare var self: DedicatedWorkerGlobalScope;


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


type Snapshot = {
    id: number,
    name: string,
    states: number,
    ratios: { [string]: number },
    system: JSONAbstractedLSS,
    //analysis: JSONAnalysisResults, // TODO
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

    constructor(): void {
        this._snapshots = new Map();
        this._id = 0;
        this._root = null;
        this._current = null;
        this._system = null;
    }

    get system(): AbstractedLSS {
        if (this._system == null) throw new Error(
            "system worker is not initialized yet (system is not set)"
        );
        return this._system;
    }

    get lss(): LSS {
        return this.system.lss;
    }

    get tree(): SnapshotData {
        if (this._root == null) throw new Error(
            "system worker is not initialized yet (snapshot tree root is not set)"
        );
        return this._treeify(this._root);
    }

    // Has to be called before instance can be used
    initialize(system: AbstractedLSS): void {
        this._snapshots.clear();
        this._system = system;
        this.take("Initial Problem");
    }

    take(name: string): void { // TODO: analysis results
        const snapshot = {
            id: this._id++,
            name: name,
            states: this.system.states.size,
            ratios: volumeRatios(this.system),
            system: this.system.serialize(),
            parent: this._current,
            children: new Set(),

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
    }

    rename(id: number, name: string): void {
        const snapshot = this._snapshots.get(id);
        if (snapshot == null) throw new Error(
            "Snapshot with id " + id + "does not exist"
        );
        snapshot.name = name;
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

}

const $ = new SnapshotManager();


const communicator = new Communicator("2W");

// States of the system
export type StateRequest = string;
export type StatesRequest = null;
export type StateData = {
    label: string,
    kind: StateKind
};
export type StateDataPlus = StateData & {
    polytope: JSONConvexPolytope,
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
    return { label: state.label, kind: state.kind };
}
function stateDataPlusOf(state: State): StateDataPlus {
    return {
        label: state.label,
        polytope: state.polytope.serialize(),
        centroid: state.polytope.centroid,
        predicates: state.predicates,
        kind: state.kind,
        numberOfActions: state.actions.length
    };
}


// Actions of a state
export type ActionRequest = string;
export type ActionData = {
    origin: StateData,
    id: number,
    controls: JSONConvexPolytopeUnion,
    targets: StateData[]
};
communicator.onRequest("getActions", function (data: ActionRequest): ActionData[] {
    return $.system.getState(data).actions.map((action, id) => ({
        origin: stateDataOf(action.origin),
        id: id,
        controls: union.serialize(action.controls),
        targets: action.targets.map(stateDataOf)
    }));
});


// Supports of an action
export type SupportRequest = [string, number];
export type SupportData = {
    origin: StateData,
    id: number,
    origins: JSONConvexPolytopeUnion,
    targets: StateData[]
};
communicator.onRequest("getSupports", function (data: SupportRequest): SupportData[] {
    const [stateLabel, actionId] = data;
    const state = $.system.getState(stateLabel);
    return state.actions[actionId].supports.map((support, id) => ({
        origin: stateDataOf(state),
        id: id,
        origins: union.serialize(support.origins),
        targets: support.targets.map(stateDataOf)
    }));
});


// Operator of a state
export type OperatorRequest = [string, string, JSONConvexPolytopeUnion];
export type OperatorData = JSONConvexPolytopeUnion;
const OPERATORS = {
    "post":  (state, us) => state.isOuter ? [] : state.post(us),
    "pre":   (state, us) => $.lss.pre($.lss.xx, us, [state.polytope]),
    "preR":  (state, us) => $.lss.preR($.lss.xx, us, [state.polytope]),
    "attr":  (state, us) => $.lss.attr($.lss.xx, us, [state.polytope]),
    "attrR": (state, us) => $.lss.attrR($.lss.xx, us, [state.polytope])
};
communicator.onRequest("getOperator", function (data: OperatorRequest): OperatorData {
    const [operator, stateLabel, control] = data;
    const state = $.system.getState(stateLabel);
    const us = union.deserialize(control);
    return union.serialize(OPERATORS[operator](state, us));
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
export type UpdateKindsRequest = [Set<string>, Set<string>];
export type UpdateKindsData = Set<string>;
communicator.onRequest("updateKinds", function (data: UpdateKindsRequest): UpdateKindsData {
    const [satisfying, nonSatisfying] = data;
    return sets.map(_ => _.label, $.system.updateKinds(satisfying, nonSatisfying));
});


// Refine the system
export type RefineRequest = [?string, string[]];
export type RefineData = Set<string>;
communicator.onRequest("refine", function (data: RefineRequest): RefineData {
    const [stateLabel, steps] = data;
    const refineries = steps.map(_ => new refinery[_]($.system));
    const states = [];
    if (stateLabel == null) {
        states.push(...iter.filter(_ => _.isUndecided, $.system.states.values()));
    } else {
        const state = $.system.getState(stateLabel);
        if (state.isUndecided) states.push(state);
    }
    return sets.map(_ => _.label, $.system.refine(partitionMap(refineries, states)));
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

export type TakeSnapshotRequest = [string]; // TODO: send analysis results
export type TakeSnapshotData = null;
communicator.onRequest("takeSnapshot", function (data: TakeSnapshotRequest): TakeSnapshotData {
    $.take(...data);
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

