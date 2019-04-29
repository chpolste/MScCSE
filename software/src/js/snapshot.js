// @flow
"use strict";

import type { JSONAnalysisResults } from "./game.js";
import type { JSONAbstractedLSS } from "./system.js";

import { AnalysisResults } from "./game.js";
import { AbstractedLSS } from "./system.js";
import { just, obj } from "./tools.js";


export type Snapshot = {
    name: string,
    system: JSONAbstractedLSS,
    analysis: ?JSONAnalysisResults
}
// Snapshot type is already JSON-serializable
export type JSONSnapshot = Snapshot;

// ...
export type JSONSnapshotTree = {
    // Which ids are associated with a snapshot
    ids: number[],
    // Snapshots and their children in the hierarchy
    snapshots: [JSONSnapshot, number[]][],
    // Root element of the tree
    root: ?number,
    // Active snapshot
    current: ?number
};

// ...
export class SnapshotTree {

    _id: number;
    _current: ?number;
    +_snapshots: Map<number, Snapshot>;
    +_tree: Map<?number, number[]>;

    constructor(): void {
        this._id = 0;
        this._snapshots = new Map();
        // Start with an empty tree
        this._current = null;
        this._tree = new Map();
    }

    static deserialize(json: JSONSnapshotTree): SnapshotTree {
        const tree = new SnapshotTree();
        // Restore snapshot tree
        for (let id of json.ids) {
            const [snapshot, children] = json.snapshots[id];
            // Assign shallow copies, so metadata manipulation of the
            // deserialized tree does not affect the serialized data
            tree._snapshots.set(id, obj.clone(snapshot));
            tree._tree.set(id, Array.from(children));
            // Update id generator status
            if (tree._id <= id) {
                tree._id = id + 1;
            }
        }
        // Restore root node of tree
        if (json.root != null) {
            tree._tree.set(null, [json.root]);
        }
        // Restore selection
        if (json.current != null) {
            tree.select(json.current);
        }
        return tree;
    }

    get size(): number {
        return this._snapshots.size;
    }

    get current(): number {
        return just(
            this._current,
            "Cannot obtain current snapshot ID from SnapshotTree: no snapshot has been taken yet"
        );
    }

    get root(): number {
        const nullChildren = just(
            this._tree.get(null),
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
        return just(
            this._snapshots.get(id),
            "A snapshot with ID " + id + " does not exist"
        );
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
        const snapshot = just(
            this._snapshots.get(id),
            "A snapshot with ID " + id + " does not exist"
        );
        snapshot.name = name;
    }

    // Serialization

    serialize(includeGraph?: boolean): JSONSnapshotTree {
        const ids = Array.from(this._snapshots.keys());
        const snapshots = [];
        for (let id of ids) {
            const snapshot = obj.clone(this.getSnapshot(id));
            if (includeGraph !== true) {
                // Strip the game graph from the system, which drastically
                // reduces the snapshot size
                snapshot.system = AbstractedLSS.deserialize(snapshot.system).serialize(false);
            }
            snapshots[id] = [snapshot, Array.from(this.getChildren(id))];
        }
        return {
            ids: ids,
            snapshots: snapshots,
            root: (ids.length === 0 ? null : this.root),
            current: this._current
        };
    }

}

