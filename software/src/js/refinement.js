// @flow
"use strict";

import type { AnalysisResults, AnalysisResult } from "./game.js";
import type { Region } from "./geometry.js";
import type { Objective, AutomatonStateLabel } from "./logic.js";
import type { AbstractedLSS, State, Action } from "./system.js";

import { Polytope, Union } from "./geometry.js";
import { iter, NotImplementedError } from "./tools.js";


// After every refinement step, the partition is divided into "done" and "rest"
// parts. The former will not be refined further by subsequent refinement
// steps, while the latter might be.
export type RefinementPartition = { done: Region, rest: Region };

// ...
export type RefineryActionPick = "best" | "random";
export type RefinerySimplification = "none" | "convexify";
export type RefinerySettings = {
    actionPick: RefineryActionPick,
    simplification: RefinerySimplification
};


export class Refinery {

    +_system: AbstractedLSS;
    +_objective: Objective;
    +_results: AnalysisResults;
    +_settings: RefinerySettings;
    // Defaults for standard implementations of settings helpers
    __pickActionBestParameters: [number, number, number];

    constructor(system: AbstractedLSS, objective: Objective,
                results: AnalysisResults, settings: RefinerySettings): void {
        this._system = system;
        this._objective = objective;
        this._results = results;
        this._settings = settings;
        // Best action pick weights. Order: [yes, no, maybe].
        this.__pickActionBestParameters = [1, -1, 0];
    }

    // Partition the system state x in automaton states qs using the given
    // refinement steps
    static execute(steps: Refinery[], x: State, qs: AutomatonStateLabel[]): Region {
        let rest = x.polytope;
        // Apply all refinement steps for every given automaton state
        for (let q of qs) {
            let done = Union.empty(rest.dim);
            for (let step of steps) {
                const partition = step.partition(x, q, rest);
                // null-return: refinery does not want to partition the state
                if (partition == null) continue;
                // Collect parts
                done = partition.done.union(done);
                rest = partition.rest;
                // Nothing left to refine?
                if (rest.isEmpty) break;
            }
            // Reset rest to entire polytope as parts marked as done in some
            // automaton state will generally not also be done in another
            rest = rest.union(done);
        }
        return rest;
    }

    // Collection of built-in refineries for module export
    static builtIns(): { [string]: Class<Refinery> } {
        return {
            "Negative Attractor": NegativeAttrRefinery,
            "Positive Robust Predecessor": PositivePreRRefinery,
            "Positive Robust Attractor": PositiveAttrRRefinery
        };
    }

    // TODO: turn this into a more general "approximation" setting even if it
    // has to be implemented individually by each refinery
    _simplify(region: Region, rest: Region): Region {
        if (this._settings.simplification === "convexify") {
            return region.hull().intersect(rest).simplify();
        } else {
            return region.simplify();
        }
    }

    // Action pick helpers

    // Select an action for a transition from system state x when transitioning
    // to automaton state qNext according to the refinery settings
    _pickAction(x: State, qNext: AutomatonStateLabel): ?Action {
        const pick = this._settings.actionPick;
        const actions = x.actions;
        // Nothing to pick if state has no actions
        if (actions.length === 0) return null;
        // Best action estimate
        if (pick === "best") return this.__pickActionBest(x, qNext);
        // By default, choose action randomly
        return actions[Math.floor(Math.random() * actions.length)];
    }

    // Default implementation for action pick setting "best". Estimate which
    // action is "best" by looking at the overlap of each action's posterior
    // with yes/maybe/no states. The overlap areas are combined into a score
    // and the action with the highest score is returned. The weights used in
    // the score calculation can be adjusted with __pickActionBestParameters.
    __pickActionBest(x: State, qNext: AutomatonStateLabel): ?Action {
        const [cYes, cNo, cMaybe] = this.__pickActionBestParameters;
        const actions = x.actions;
        const regionPos = this._getStateRegion("yes", qNext);
        const regionNeg = this._getStateRegion("no", qNext);
        let best = null;
        let bestScore = -Infinity;
        for (let action of actions) {
            const post = x.post(action.controls);
            const postVol = post.volume;
            const ratioPos = regionPos.intersect(post).volume / postVol;
            const ratioNeg = regionNeg.intersect(post).volume / postVol;
            const ratioMaybe = 1 - ratioPos - ratioNeg;
            const score = cYes * ratioPos + cNo * ratioNeg + cMaybe * ratioMaybe;
            if (score > bestScore) {
                best = action;
                bestScore = score;
            }
        }
        return best;
    }

    // Convenience accessors

    _getStates(which: "yes"|"no"|"maybe", q: AutomatonStateLabel): Iterable<State> {
        return iter.filter((state) => this._getResult(state)[which].has(q), this._system.states.values());
    }

    _getStateRegion(which: "yes"|"no"|"maybe", q: AutomatonStateLabel): Region {
        const polys = [];
        for (let x of this._getStates(which, q)) {
            polys.push(x.polytope);
        }
        return polys.length === 0 ? this._getEmpty() : Union.from(polys);
    }

    _getResult(x: State): AnalysisResult {
        const result = this._results.get(x.label);
        if (result == null) throw new Error("TODO477"); // TODO
        return result;
    }

    _getEmpty(): Region {
        return Polytope.ofDim(this._system.lss.dim).empty();
    }
    
    _qNext(x: State, q: AutomatonStateLabel): ?AutomatonStateLabel {
        return this._objective.nextState(x.predicates, q);
    }

    // Implement in subclass
    partition(x: State, q: AutomatonStateLabel, rest: Region): ?RefinementPartition {
        throw new NotImplementedError();
    }

}


/* Refinement procedures */

// Remove Attractor of non-satisfying states
class NegativeAttrRefinery extends Refinery {

    +attr: Map<AutomatonStateLabel, Region>;

    constructor(system: AbstractedLSS, objective: Objective,
                results: AnalysisResults, settings: RefinerySettings): void {
        super(system, objective, results, settings);
        // Precompute attractor of "no" states for every q
        this.attr = new Map();
        const lss = system.lss;
        for (let q of objective.allStates) {
            const target = this._getStateRegion("no", q).simplify();
            this.attr.set(q, lss.attr(lss.xx, lss.uus, target));
        }
    }

    partition(x: State, q: AutomatonStateLabel, rest: Region): ?RefinementPartition {
        // Only refine maybe states
        if (!this._getResult(x).maybe.has(q)) return null;
        // Refine wrt to next automaton state
        const qNext = this._qNext(x, q);
        if (qNext == null) return null;
        // Cut attractor of "no" region out of state
        const attr = this.attr.get(qNext);
        if (attr == null) throw new Error("NAR2"); // TODO
        const done = attr.intersect(rest).simplify();
        rest = rest.remove(done).simplify();
        // Progress guarantee, don't refine the attr further
        return { done: done, rest: rest };
    }

}

// Remove Attractor of non-satisfying states
class PositivePreRRefinery extends Refinery {

    +preR: Map<AutomatonStateLabel, Region>;

    constructor(system: AbstractedLSS, objective: Objective,
                results: AnalysisResults, settings: RefinerySettings): void {
        super(system, objective, results, settings);
        // Precompute robust predecessor of "yes" states for every q
        this.preR = new Map();
        const lss = system.lss;
        for (let q of objective.allStates) {
            const target = this._getStateRegion("yes", q).simplify();
            this.preR.set(q, lss.preR(lss.xx, lss.uus, target));
        }
    }

    partition(x: State, q: AutomatonStateLabel, rest: Region): ?RefinementPartition {
        // Only refine maybe states
        if (!this._getResult(x).maybe.has(q)) return null;
        // Refine wrt to next automaton state
        const qNext = this._qNext(x, q);
        if (qNext == null) return null;
        // Cut robust predecessor of "yes" region out of state
        const preR = this.preR.get(qNext);
        if (preR == null) throw new Error("NAR2"); // TODO
        const done = preR.intersect(rest).simplify();
        rest = rest.remove(done).simplify();
        // No progress guarantee, everything can be refined further
        return { done: this._getEmpty(), rest: done.union(rest) };
    }

}

// Case 1 of the Positive AttrR refinement from Svorenova et al. (2017)
class PositiveAttrRRefinery extends Refinery {

    +yes: Map<AutomatonStateLabel, State[]>;

    constructor(system: AbstractedLSS, objective: Objective,
                results: AnalysisResults, settings: RefinerySettings): void {
        super(system, objective, results, settings);
        // Precompute robust predecessor of "yes" states for every q
        this.yes = new Map();
        for (let q of objective.allStates) {
            this.yes.set(q, Array.from(this._getStates("yes", q)));
        }
        // Look for most overlap with yes targets
        this.__pickActionBestParameters = [10, -1, 1];
    }

    partition(x: State, q: AutomatonStateLabel, rest: Region): ?RefinementPartition {
        // Only refine maybe states
        if (!this._getResult(x).maybe.has(q)) return null;
        // Refine wrt to next automaton state
        const qNext = this._qNext(x, q);
        if (qNext == null) return null;
        const xYes = this.yes.get(qNext);
        if (xYes == null || xYes.length === 0) return null;
        // Obtain an action for refining with
        const action = this._pickAction(x, qNext);
        if (action == null) return null;
        // Subdivide action polytope into smaller parts and find best part to
        // refine with (largest AttrR)
        let done = null;
        let doneVol = -Infinity;
        for (let u of action.controls.shatter().polytopes) {
            const attrR = x.attrR(u, xYes).intersect(rest);
            const vol = attrR.volume;
            if (doneVol < vol) {
                done = attrR;
                doneVol = vol;
            }
        }
        if (done == null) return null;
        done = this._simplify(done, rest);//done.simplify(); TODO
        rest = rest.remove(done).simplify();
        // Progress guarantee, don't refine the AttrR further
        return { done: done, rest: rest };
    }

}

