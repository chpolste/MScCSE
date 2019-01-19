// @flow
"use strict";

import type { JSONAnalysisResults } from "./game.js";
import type { JSONAbstractedLSS } from "./system.js";

import { AnalysisResults } from "./game.js";
import { AbstractedLSS } from "./system.js";


type Snapshot = {
    name: string,
    system: JSONAbstractedLSS,
    analysis: ?JSONAnalysisResults
}

export type JSONSnapshotTree = {}; // TODO

export class SnapshotTree {

    +_id: number;
    +_snapshots: Map<number, Snapshot>;
    +_tree: Map<?number, number[]>;
    _current: ?number;

    constructor(): void {
        this._id = 0;
        this._snapshots = new Map();
        // Start with an empty tree
        this._current = null;
        this._tree = new Map();
    }

    static deserialize(json: JSONSnapshotTree): SnapshotTree {
        return new SnapshotTree(); // TODO
    }

    get size(): number {
        return this._snapshots.size;
    }

    get current(): number {
        if (this._current == null) throw new Error(
            "Cannot obtain current snapshot ID from SnapshotTree: no snapshot has been taken yet"
        );
        return this._current;
    }

    get root(): number {
        const nullChildren = this._tree.get(null);
        if (nullChildren == null) throw new Error(
            "Cannot obtain root of SnapshotTree: no snapshot has been taken yet"
        );
        if (nullChildren.length !== 1) throw new Error(
            "Illegal state of SnapshotTree: null node must not have multiple children"
        );
        return nullChildren[0];
    }

    // Snapshot information retrieval

    getSnapshot(id?: number): Snapshot {
        if (id == null) id = this.current;
        const snapshot = this._snapshots.get(id);
        if (snapshot == null) throw new Error(
            "A snapshot with ID " + id + " does not exist"
        );
        return snapshot;
    }

    getSystem(id?: number): AbstractedLSS {
        return AbstractedLSS.deserialize(this.getSnapshot(id).system);
    }

    getAnalysis(id?: number): ?AnalysisResults {
        const snapshot = this.getSnapshot(id);
        return (snapshot.analysis == null) ? null : AnalysisResults.deserialize(snapshot.analysis);
    }

    getName(id?: number): string {
        return this.getSnapshot(id).name;
    }

    getChildren(id?: number): Iterable<number> {
        if (id == null) id = this.current;
        if (!this._snapshots.has(id)) throw new Error(
            "A snapshot with ID " + id + " does not exist"
        );
        const children = this._tree.get(id);
        return (children == null) ? [] : children;
    }

    // Number of states excluding outer states
    getNumberOfStates(id?: number): number {
        return this.getSnapshot(id).system.states.filter(_ => !_.isOuter).length;
    }

    // Tree manipulation

    take(name: string, system: AbstractedLSS, analysis: ?AnalysisResults, includeGraph?: boolean): number {
        // Create the snapshot
        const id = this._id++;
        this._snapshots.set(id, {
            name: name,
            system: system.serialize(includeGraph),
            analysis: (analysis == null) ? null : analysis.serialize()
        });
        // Maintain tree
        const parent = this._current;
        const children = this._tree.get(parent);
        if (children == null) {
            // Create new set of children
            this._tree.set(parent, [id]);
        } else {
            // null node can only have a single child (the root node)
            if (parent == null && children.length > 0) throw new Error(
                "Illegal state of SnapshotTree: null node must not have multiple children"
            );
            // Add snapshot to existing children
            children.push(id);
        }
        this.select(id);
        return id;
    }

    select(id: number): void {
        if (!this._snapshots.has(id)) throw new Error(
            "A snapshot with ID " + id + " does not exist"
        );
        this._current = id;
    }

    rename(id: number, name: string): void {
        const snapshot = this._snapshots.get(id);
        if (snapshot == null) throw new Error(
            "A snapshot with ID " + id + " does not exist"
        );
        snapshot.name = name;
    }

    // Serialization

    serialize(): JSONSnapshotTree {
        return {}; // TODO
    }

}

