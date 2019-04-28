// @flow
"use strict";

import type { AnalysisResults, AnalysisResult } from "./game.js";
import type { Region } from "./geometry.js";
import type { Objective, AutomatonStateID } from "./logic.js";
import type { LSS, AbstractedLSS, State } from "./system.js";

import { Polytope, Union } from "./geometry.js";
import * as linalg from "./linalg.js";
import { itemizedOperatorPartition } from "./system.js";
import { just, obj, sets, iter, ValueError, NotImplementedError } from "./tools.js";


// Positive AttrR refinement kernel: return [AttrR (good), rest (unknown)]
function refineAttrR(lss: LSS, origin: Polytope, target: Region): [Region, Region] {
    // If a control space region ensuring an exclusive transition to target
    // already exists, return origin unchanged in good part
    if (!lss.actR(origin, target).isEmpty) {
        return [origin, Polytope.ofDim(lss.dim).empty()];
    }
    // Select a control input to refine with
    const u = sampleControl(lss, origin, target);
    // Compute the Robust Attractor in origin wrt to the target region and
    // selected control input
    const attrR = (u == null) ? null : lss.attrR(origin, u, target).simplify();
    // A usable Robust Attractor is available
    if (attrR != null && !attrR.isEmpty) {
        return [attrR, origin.remove(attrR)];
    // Refinement step could not be executed, return without change in unknown
    // region (caller must decide what to do then)
    } else {
        return [Polytope.ofDim(lss.dim).empty(), origin];
    }
}

// Monte-Carlo sampling of control inputs for positive refinement
function sampleControl(lss: LSS, origin: Polytope, target: Region): ?Polytope {
    // Sample from within the robust predecessor, so sample points have
    // a non-empty ActR. Start with vertices of the origin, and add a few
    // random points from within the polytope. Because the preR is a Region in
    // general, use hull to obtain a simpler Polytope first.
    const preR = lss.preR(origin, lss.uu, target).hull();
    const xs = Array.from(preR.vertices);
    for (let i = 0; i < (3 * lss.dim); i++) {
        xs.push(preR.sample());
    }
    // Use ActRs of sample points wrt to target region to determine
    // a control input to refine with
    const actR = (x) => {
        const Axpw = lss.ww.translate(linalg.apply(lss.A, x));
        return target.pontryagin(Axpw).applyRight(lss.B).intersect(lss.uu);
    };
    // Intersect all control inputs with one another to find
    // a subregion that most points can use. The exponential
    // complexity of itemizedOperatorPartition makes this quite
    // expensive so a simpler clustering should be chosen if this
    // is ever applied to higher dimensions.
    const u = iter.argmax(
        _ => _.items.length,
        itemizedOperatorPartition(xs, actR).filter(_ => !_.region.isEmpty)
    );
    // Return only a single polytope from the control region. This simplifies
    // the following geometric operations and has the same guarantees.
    return (u == null) ? null : u.region.polytopes[0];
}


export class Refinery {

    +system: AbstractedLSS;
    +objective: Objective;
    +results: AnalysisResults;

    constructor(system: AbstractedLSS, objective: Objective, results: AnalysisResults): void {
        this.system = system;
        this.objective = objective;
        this.results = results;
    }

    /* Interface */

    // Partition the system states using the given refinement steps. Modifies
    // the given system partition in-place.
    partitionAll(states: Iterable<State>): Map<State, Region> {
        return new Map(iter.map(_ => [_, this.partition(_)], states));
    }

    // Implement in subclass:
    partition(x: State): Region {
        throw new NotImplementedError("Refinery must override method 'partition'");
    }

    /* Common convenience accessors for subclasses */

    // States that have are already decided should not be refined further
    _isDecided(x: State, q: AutomatonStateID): boolean {
        return !this._getResult(x).maybe.has(q);
    }

    // System states analysed as yes/no/maybe in automaton state q
    _getStates(which: "yes"|"no"|"maybe", q: AutomatonStateID): Iterable<State> {
        return iter.filter((state) => this._getResult(state)[which].has(q), this.system.states.values());
    }

    // getStates but returns the polytopic region
    _getStateRegion(which: "yes"|"no"|"maybe", q: AutomatonStateID): Region {
        return this._asRegion(this._getStates(which, q));
    }

    // Easy AnalysisResult accessor
    _getResult(x: State): AnalysisResult {
        return just(this.results.get(x.label));
    }

    // Empty Region of state space dimension
    _getEmpty(): Region {
        return Polytope.ofDim(this.system.lss.dim).empty();
    }

    // Region covered by the system states
    _asRegion(xs: Iterable<State>): Region {
        const polys = [];
        for (let x of xs) {
            polys.push(x.polytope);
        }
        return polys.length === 0 ? this._getEmpty() : Union.from(polys).simplify();
    }

    // Automaton transition target from product state (x, q)
    _qNext(x: State, q: AutomatonStateID): ?AutomatonStateID {
        return this.objective.nextState(x.predicates, q);
    }

}


/* Holistic refinement with geometric condition */

// Implementation of general partition pattern
class _HolisticGeometricRefinery extends Refinery {

    partition(x: State): Region {
        let parts = x.polytope;
        for (let q of this.objective.allStates) {
            // Only refine undecided, state that aren't dead-ends
            const qNext = this._qNext(x, q);
            if (this._isDecided(x, q) || qNext == null) {
                continue;
            }
            // Partition with Attractor of target q no-region
            let newParts = this._getEmpty();
            for (let part of parts.polytopes) {
                newParts = newParts.union(this._partition(part, qNext));
            }
            parts = newParts;
        }
        return parts;
    }

    // Override in subclass
    _partition(part: Polytope, qNext: AutomatonStateID): Region {
        throw new Error("_HolisticGeometricRefinery subclass must implement method _partition");
    }

}


// Positive robust refinement
export class PositiveRobustRefinery extends _HolisticGeometricRefinery {

    +_op: "PreR" | "AttrR";
    +_yes: { [AutomatonStateID]: Region };

    constructor(system: AbstractedLSS, objective: Objective, results: AnalysisResults,
                operator: "PreR" | "AttrR"): void {
        super(system, objective, results);
        this._op = operator;
        // Cache yes regions for target qs
        this._yes = obj.fromMap((q) => this._getStateRegion("yes", q), this.objective.allStates);
    }


    _partition(part: Polytope, qNext: AutomatonStateID): Region {
        const lss = this.system.lss;
        if (this._op === "PreR") {
            const preR = lss.preR(part, lss.uu, this._yes[qNext]);
            return preR.union(part.remove(preR).simplify());
        } else if (this._op === "AttrR") {
            const [attr, other] = refineAttrR(lss, part, this._yes[qNext]);
            return attr.union(other);
        } else throw new Error(
            "Unknown operator '" + this._op + "' for positive robust refinement"
        );
    }

}


// Negative attractor refinement
export class NegativeAttrRefinery extends _HolisticGeometricRefinery {

    +_attr: { [AutomatonStateID]: Region };

    constructor(system: AbstractedLSS, objective: Objective, results: AnalysisResults): void {
        super(system, objective, results);
        const lss = system.lss;
        // Cache attractors of no-regions for target qs
        this._attr = obj.fromMap(q => {
            const no = this._getStateRegion("no", q);
            return lss.attr(lss.xx, lss.uu, no).simplify();
        }, objective.allStates);
    }

    _partition(part: Polytope, qNext: AutomatonStateID): Region {
        const attr = part.intersect(this._attr[qNext]).simplify();
        if (attr.isEmpty) {
            return part;
        } else {
            return attr.union(part.remove(attr).simplify());
        }

    }

}


// Safety refinement
export class SafetyRefinery extends _HolisticGeometricRefinery {

    +_ok: { [AutomatonStateID]: Region };

    constructor(system: AbstractedLSS, objective: Objective, results: AnalysisResults): void {
        super(system, objective, results);
        // Cache safe regions for target qs
        this._ok = obj.fromMap((q) => {
            return system.lss.xx.remove(this._getStateRegion("no", q)).simplify();
        }, this.objective.allStates);
    }

    _partition(part: Polytope, qNext: AutomatonStateID): Region {
        const [safe, other] = refineAttrR(this.system.lss, part, this._ok[qNext]);
        return safe.union(other);
    }
}


/* Self-Loop removal refinement */

export class SelfLoopRefinery extends Refinery {

    // Settings
    +optimistic: boolean;
    +onlySafe: boolean;
    // Caches
    +_noStates: { [AutomatonStateID]: Set<State> };

    constructor(system: AbstractedLSS, objective: Objective, results: AnalysisResults,
                optimistic: boolean, onlySafe: boolean): void {
        super(system, objective, results);
        this.optimistic = optimistic;
        this.onlySafe = onlySafe;
        // Cache no-states of system for every automaton state for safety check
        this._noStates = obj.fromMap(q => new Set(this._getStates("no", q)), objective.allStates);
    }

    partition(x: State): Region {
        // Quick geometric test if self-loop is possible
        if (x.post(this.system.lss.uu).intersect(x.polytope).isEmpty) {
            return x.polytope;
        }
        for (let q of this.objective.allStates) {
            // Only refine undecided, state that lead to same automaton state
            if (this._isDecided(x, q) || this._qNext(x, q) !== q) {
                continue;
            }
            // Examine actions: try to find an action that has no self-loop and
            // and an action that has a self-loop
            let goodAction = null;
            let support = null;
            for (let action of x.actions) {
                const targetsSelf = action.targets.has(x);
                // If only safe actions should be considered, ignore the action
                // if it is not
                if (!this.onlySafe || this._isSafe(action.targets, q)) {
                    // If the action does not self-target, it cannot have
                    // a self-loop
                    if (!targetsSelf) {
                        goodAction = action;
                    } else {
                        // Find a self-loop in the player 2 actions
                        let selfLoopSupport = null;
                        for (let support of action.supports) {
                            if (support.targets.size === 1 && support.targets.has(x)) {
                                selfLoopSupport = support;
                                break; // exit loop over supports
                            }
                        }
                        // No self-loop found
                        if (selfLoopSupport == null) {
                            goodAction = action;
                        // Self-loop found, this action/support combination is
                        // suitable for refinement
                        } else {
                            support = selfLoopSupport;
                            break; // exit loop over actions
                        }
                    }
                }
            }
            // If refinement is optimistic and a non-self-looping action was
            // found, continue. Otherwise partition the state if an
            // action/support combination for refinement was found.
            if (!(this.optimistic && goodAction != null) && support != null) {
                // Split with PreP associated with the action support
                const preP = support.origins.simplify();
                return preP.union(x.polytope.remove(preP).simplify());
            }
        }
        // No suitable action/support combination was found for refinement
        return x.polytope;
    }

    _isSafe(targets: Set<State>, q: AutomatonStateID): boolean {
        return !sets.doIntersect(targets, this._noStates[q]);
    }

}



/* Transition refinement */

export type RobustReachabilitySettings = {
    expandTarget: boolean,
    dontRefineSmall: boolean,
    postProcessing: "none" | "hull" | "largest" | "suppress"
};

class RobustReachabilityProblem {

    +lss: LSS;
    +avoid: Region;
    +reach: Region;
    // Configuration
    expandTarget: boolean;
    dontRefineSmall: boolean;
    postProcessing: ?((Region) => Region);
    // State
    _parts: { polytope: Polytope, state: State, done: boolean }[];
    _target: Region;

    constructor(lss: LSS, parts: Map<State, Region>, reach: Region, avoid: Region,
                settings: RobustReachabilitySettings): void {
        this.lss = lss;
        this.avoid = avoid;
        this.reach = reach;
        // Save configuration
        this.expandTarget = settings.expandTarget;
        this.dontRefineSmall = settings.dontRefineSmall;
        this.postProcessing = {
            "none": null,
            // Take the convex hull of the region
            "hull": _ => _.hull(),
            // Take only the largest polytope of the region
            "largest": _ => {
                const largest = iter.argmax((poly) => poly.volume, _.polytopes);
                return largest == null ? _ : largest;
            },
            // Remove all small states from the region
            "suppress": _ => Union.from(_.polytopes.filter(
                (poly) => !poly.pontryagin(lss.ww).isEmpty
            ), _.dim)
        }[settings.postProcessing];
        // Initialize partition
        this._parts = [];
        for (let [state, region] of parts) {
            for (let poly of region.polytopes) {
                this._parts.push({ polytope: poly, state: state, done: false });
            }
        }
        // _target is an mutable version of reach (if expandTarget is set, it
        // is expanded in _updateStep)
        this._target = reach.simplify();
    }

    // Assemble partition for associated states of original system
    get partitions(): Map<State, Region> {
        const partitions = new Map();
        for (let part of this._parts) {
            const region = partitions.get(part.state);
            partitions.set(part.state, (region == null ? part.polytope : region.union(part.polytope)));
        }
        return partitions;
    }

    // Is the problems completely decided?
    get allDone(): boolean {
        return this._parts.every(_ => _.done);
    }

    iterate(n: number): void {
        for (let i = 0; i < n; i++) {
            // Update target region until convergence
            this._update();
            // ...
            if (this.allDone) break;
            // Refine states wrt current target
            this._refine();
        }
    }

    _refine(): void {
        const parts = [];
        for (let part of this._parts) {
            // Don't refine parts marked as done
            if (part.done) {
                parts.push(part);
                continue;
            // A small polytope is only refined if dontRefineSmall is not set
            // or it is not safe (transition to avoid-region is unavoidable
            // with non-zero probability)
            } else if (this.dontRefineSmall && part.polytope.pontryagin(this.lss.ww).isEmpty
                       && !this.lss.act(part.polytope, this.avoid).isSameAs(this.lss.uu)) {
                part.done = true;
                parts.push(part);
                continue;
            // Refine the polytope
            } else {
                // Partition with robust attractor
                let [good, other] = refineAttrR(this.lss, part.polytope, this._target);
                // Apply post-processing if enabled
                if (this.postProcessing != null) {
                    good = this.postProcessing(good);
                    other = part.polytope.remove(good);
                }
                // "Good" polytopes are considered as done and are not refined
                // further in subsequent iterations
                for (let poly of good.polytopes) {
                    parts.push({ polytope: poly, state: part.state, done: true });
                }
                // Remaining region might require further refinement
                for (let poly of other.polytopes) {
                    parts.push({ polytope: poly, state: part.state, done: false });
                }
            }
        }
        // Replace partition
        this._parts = parts;
    }

    _update(): void {
        // Iterate updateStep until convergence
        while (true) {
            const hasChanged = this._updateStep();
            if (!hasChanged) break;
        }
    }

    _updateStep(): boolean {
        const newTarget = Array.from(this.reach.polytopes);
        let hasChanged = false;
        // Go through partition elements, find polytopes that have not been
        // recognized as done yet and update them. Keep track of done-region
        // for expansion of target region.
        for (let part of this._parts) {
            if (part.done) {
                newTarget.push(part.polytope);
                continue;
            }
            // Non-empty robust action indicates that element has a robust
            // transition to the target and is therefore done
            const actR = this.lss.actR(part.polytope, this._target);
            if (!actR.isEmpty) {
                part.done = true;
                newTarget.push(part.polytope);
                hasChanged = true;
            }
        }
        // Update target region if expansion is enabled
        if (this.expandTarget) {
            this._target = Union.from(newTarget, this.lss.dim).simplify();
        }
        // Return if any changes happened. Due to the expanding target region
        // multiple passes might be necessary until every state is properly
        // classified.
        return hasChanged;
    }

}


export type TransitionRefineryLayers = {
    generator: "PreR" | "Pre",
    scaling: number,
    range: [number, number]
};

export class TransitionRefinery extends Refinery {

    +_problems: RobustReachabilityProblem[];
    _partitions: Map<State, Region>;

    constructor(system: AbstractedLSS, objective: Objective, results: AnalysisResults,
                origin: AutomatonStateID, target: AutomatonStateID, 
                layers: ?TransitionRefineryLayers, settings: RobustReachabilitySettings): void {
        super(system, objective, results);
        const lss = system.lss;
        // Sort system states into good, bad, todo categories
        const bad = [];
        const good = [];
        const todo = new Map();
        for (let x of system.states.values()) {
            const qNext = this._qNext(x, origin);
            const result = this._getResult(x);
            // A no-state must be avoided
            if (result.no.has(origin)) {
                bad.push(x.polytope);
            // Reaching a yes-state is acceptable
            } else if (result.yes.has(origin)) {
                good.push(x.polytope);
            // "Neutral" states
            } else if (qNext === origin) {
                todo.set(x, x.polytope);
                // Special case for self-loop in the automaton
                if (origin === target) good.push(x.polytope);
            // Transition states should be reached
            } else if (qNext === target) {
                good.push(x.polytope);
            // All other states are to be avoided
            } else {
                bad.push(x.polytope);
            }
        }
        // List of robust reachability subproblems
        this._problems = [];
        // Union of bad states is to be avoided
        const avoid = Union.from(bad, lss.dim).simplify();
        // Union of good states is the target
        let reach = Union.from(good, lss.dim).simplify();
        // Case 1: refinement without layer decomposition
        if (layers == null) {
            this._problems.push(new RobustReachabilityProblem(lss, todo, reach, avoid, settings));
        // Case 2: further decomposition into layers
        } else {
            // Apply scaling to layer generating control input
            const uu = lss.uu.scale(layers.scaling);
            // Build subproblems based on layers
            for (let i = 1; i <= layers.range[1]; i++) {
                // Obtain layer for chosen generator
                const layer = this._generateLayer(reach, uu, layers.generator);
                // Only apply refinement to layers in given range
                if (layers.range[0] <= i) {
                    // Collect todo-states of the current layer
                    const layerTodo = new Map();
                    for (let [state, region] of todo) {
                        const intersection = region.intersect(layer).simplify();
                        if (!intersection.isEmpty) {
                            // Add intersection of state region and layer to
                            // the layer's todo-states
                            layerTodo.set(state, intersection);
                            // Remove the intersection from the global
                            // todo-state so that it is not refined in another
                            // sub-problem
                            todo.set(state, region.remove(intersection).simplify());
                        }
                    }
                    // If no new todo-states appear, layer generator has
                    // converged and generation can be stopped
                    if (layerTodo.size === 0) break;
                    // Add the layer-subproblem to the list
                    this._problems.push(new RobustReachabilityProblem(lss, layerTodo, reach, avoid, settings));
                }
                // Update reach to the layer for the next subproblem
                reach = layer.remove(avoid).simplify();
            }
        }
        // Initialize the partition cache
        this._updatePartitionCache();
    }

    _generateLayer(target: Region, control: Polytope, generator: string): Region {
        const lss = this.system.lss;
        let layer;
        if (generator === "PreR")  {
            layer = lss.preR(lss.xx, control, target);
        } else if (generator === "Pre") {
            layer = lss.pre(lss.xx, control, target);
        } else throw new NotImplementedError(
            "layer generator '" + generator + "' does not exist"
        );
        // Keep target in layer polytope, it is no problem if a trace jumps
        // more than one layer inward
        return layer.union(target).simplify();
    }

    // Collect and merge the partitions from all subproblems
    _updatePartitionCache(): void {
        const partitions = new Map();
        for (let problem of this._problems) {
            for (let [state, region] of problem.partitions) {
                const existing = partitions.get(state);
                partitions.set(state, (existing == null ? region : existing.union(region)));
            }
        }
        this._partitions = new Map();
        for (let [state, region] of partitions) {
            const rest = state.polytope.remove(region).simplify();
            this._partitions.set(state, region.union(rest));
        }
    }

    iterate(n?: number): void {
        for (let problem of this._problems) {
            problem.iterate(n == null ? 1 : n);
        }
        this._updatePartitionCache();
    }

    partition(x: State): Region {
        const partition = this._partitions.get(x);
        return (partition == null) ? x.polytope : partition;
    }

}

