// @flow
"use strict";

import type { Refinery } from "./refinement.js";

import * as fs from "fs";
// $FlowFixMe
import { performance } from "perf_hooks";

import { TwoPlayerProbabilisticGame, AnalysisResults } from "./game.js";
import { Halfspace, Interval, Polygon } from "./geometry.js";
import { parseProposition, Objective } from "./logic.js";
import { objectives } from "./presets.js";
import { TransitionRefinery, NegativeAttrRefinery, PositiveRobustRefinery,
         SelfLoopRefinery, SafetyRefinery } from "./refinement.js";
import { SnapshotTree } from "./snapshot.js";
import { LSS } from "./system.js";
import { iter, just, n2s, t2s } from "./tools.js";


export function run(sessionPath: string, logPath: string) {

    const xx = Polygon.hull([[-5, -3], [-5, 3], [5, -3], [5, 3]]);
    const ww = Polygon.hull([[-0.1, -0.1], [-0.1, 0.1], [0.1, -0.1], [0.1, 0.1]]);
    const uu = Interval.hull([[-1], [1]]);

    const A = [[1, 1], [0, 1]];
    const B = [[0.5], [1]];

    const p1 = Halfspace.normalized([-1,  0], 1);
    const p2 = Halfspace.normalized([ 1,  0], 1);
    const p3 = Halfspace.normalized([ 0, -1], 1);
    const p4 = Halfspace.normalized([ 0,  1], 1);

    // LSS
    const lss = new LSS(A, B, xx, ww, uu);
    let sys = lss.decompose([p1, p2, p3, p4], ["p1", "p2", "p3", "p4"]);
    let ana = null;

    // Objective
    const varphi = parseProposition("p1 & p2 & p3 & p4");
    const obj = new Objective(objectives["Reachability"], [varphi], true);

    // Snapshots
    const snaps = new SnapshotTree();

    // Log entries
    const log = [];

    function step(name: string, getRefineries: ?((() => Refinery)[]), includeGraph: boolean): void {
        const t0 = performance.now();
        if (getRefineries != null) {
            for (let getRefinery of getRefineries) {
                const refinery = getRefinery();
                const partition = refinery.partitionAll(sys.states.values());
                const refinementMap = sys.refine(partition);
                // Update global analysis results
                if (ana != null) {
                    ana.remap(refinementMap);
                }
            }
        }
        const t1 = performance.now();
        const game = TwoPlayerProbabilisticGame.fromProduct(sys, obj, ana);
        const t2 = performance.now();
        const results = game.analyse();
        if (ana != null) {
            results.transferFromPrevious(ana);
        }
        const t3 = performance.now();
        // Update global analysis results
        ana = results;
        // Take snapshot
        snaps.take(name, sys, ana, includeGraph);
        // Statistics
        const stats = {
            name: name,
            polys: 0,
            pcty: 0,
            pctn: 0,
            pctm: 0,
            p1s: game.p1States.size,
            p1a: iter.sum(iter.map(_ => _.actions.length, game.p1States)),
            p2s: game.p2States.size,
            p2a: iter.sum(iter.map(_ => _.actions.length, game.p2States)),
            trf: (t1 - t0) / 1000,
            tgg: (t2 - t1) / 1000,
            tan: (t3 - t2) / 1000
        };
        for (let state of sys.states.values()) {
            if (state.isOuter) continue;
            stats.polys++;
            const result = just(results.get(state.label));
            if (result.yes.has("q0"))   stats.pcty += state.polytope.volume;
            if (result.no.has("q0"))    stats.pctn += state.polytope.volume;
            if (result.maybe.has("q0")) stats.pctm += state.polytope.volume;
        }
        stats.pcty /= xx.volume;
        stats.pctn /= xx.volume;
        stats.pctm /= xx.volume;
        // Write to log
        log.push(stats);
        console.log(name + " :: " + t2s(t3 - t0) + " :: " + stats.polys + " polys :: " + n2s((1 - stats.pctm) * 100, 1) + "%");
    }

    // Initialize
    step("[1] Initialization", null, false);

    // Preparation: negative refinement
    step("[2] Negative Attractor", [
        () => new NegativeAttrRefinery(sys, obj, just(ana))
    ], false);
    step("[3] Negative Attractor", [
        () => new NegativeAttrRefinery(sys, obj, just(ana))
    ], false);
    step("[4] Negative Attractor", [
        () => new NegativeAttrRefinery(sys, obj, just(ana))
    ], true);

    const startSnap = snaps.current;

    function reset(): void {
        snaps.select(startSnap);
        sys = snaps.getSystem(startSnap);
        ana = snaps.getAnalysis(startSnap);
    }


    // Benchmark #1: positive robust refinement, single-step
    reset();
    try {
        const settings1 = {
            expandTarget: false,
            dontRefineSmall: false,
            postProcessing: "none"
        };
        step("[5] Positive Robust Single x2", [
            () => new TransitionRefinery(sys, obj, just(ana), "q0", "q1", null, settings1).iterate(2)
        ], false);
        step("[6] Positive Robust Single x2", [
            () => new TransitionRefinery(sys, obj, just(ana), "q0", "q1", null, settings1).iterate(2)
        ], false);
        step("[7] Positive Robust Single x2", [
            () => new TransitionRefinery(sys, obj, just(ana), "q0", "q1", null, settings1).iterate(2)
        ], false);
        step("[8] Positive Robust Single x2", [
            () => new TransitionRefinery(sys, obj, just(ana), "q0", "q1", null, settings1).iterate(2)
        ], false);
    } catch (e) {
        snaps.take("ERROR", sys, ana, false);
        console.log(e);
    }


    // Benchmark #2: positive robust refinement, multi-step, 2 iterations
    reset();
    try {
        const settings2 = {
            expandTarget: true,
            dontRefineSmall: false,
            postProcessing: "none"
        };
        step("[5] Positive Robust Multi x2", [
            () => new TransitionRefinery(sys, obj, just(ana), "q0", "q1", null, settings2).iterate(2)
        ], false);
        step("[6] Positive Robust Multi x2", [
            () => new TransitionRefinery(sys, obj, just(ana), "q0", "q1", null, settings2).iterate(2)
        ], false);
        step("[7] Positive Robust Multi x2", [
            () => new TransitionRefinery(sys, obj, just(ana), "q0", "q1", null, settings2).iterate(2)
        ], false);
        step("[8] Positive Robust Multi x2", [
            () => new TransitionRefinery(sys, obj, just(ana), "q0", "q1", null, settings2).iterate(2)
        ], false);
    } catch (e) {
        snaps.take("ERROR", sys, ana, false);
        console.log(e);
    }


    // Benchmark #3: positive robust refinement, multi-step, 2 iterations, small state suppression
    reset();
    try {
        const settings3 = {
            expandTarget: true,
            dontRefineSmall: true,
            postProcessing: "suppress"
        };
        step("[5] Positive Robust Multi x2 Suppress", [
            () => new TransitionRefinery(sys, obj, just(ana), "q0", "q1", null, settings3).iterate(2)
        ], false);
        step("[6] Positive Robust Multi x2 Suppress", [
            () => new TransitionRefinery(sys, obj, just(ana), "q0", "q1", null, settings3).iterate(2)
        ], false);
        step("[7] Positive Robust Multi x2 Suppress", [
            () => new TransitionRefinery(sys, obj, just(ana), "q0", "q1", null, settings3).iterate(2)
        ], false);
        step("[8] Positive Robust Multi x2 Suppress", [
            () => new TransitionRefinery(sys, obj, just(ana), "q0", "q1", null, settings3).iterate(2)
        ], false);
    } catch (e) {
        snaps.take("ERROR", sys, ana, false);
        console.log(e);
    }


    // Benchmark #4: positive robust refinement, multi-step, 8 iterations, small state suppression
    reset();
    try {
        const settings4 = {
            expandTarget: true,
            dontRefineSmall: true,
            postProcessing: "suppress"
        };
        step("[5] Positive Robust Multi x8 Suppress", [
            () => new TransitionRefinery(sys, obj, just(ana), "q0", "q1", null, settings4).iterate(8)
        ], false);
    } catch (e) {
        snaps.take("ERROR", sys, ana, false);
        console.log(e);
    }


    // Benchmark #5: positive robust refinement, PreR(100) layered multi-step, 4 iterations, small state suppression
    reset();
    try {
        const layers5 = {
            generator: "PreR",
            scaling: 1,
            range: [1, 10]
        };
        const settings5 = {
            expandTarget: true,
            dontRefineSmall: true,
            postProcessing: "suppress"
        };
        step("[5] Positive Robust Pre(100) Layer Multi x4 Suppress", [
            () => new TransitionRefinery(sys, obj, just(ana), "q0", "q1", layers5, settings5).iterate(4)
        ], false);
    } catch (e) {
        snaps.take("ERROR", sys, ana, false);
        console.log(e);
    }


    // Benchmark #6: positive robust refinement, PreR(95) layered multi-step, 4 iterations, small state suppression
    reset();
    try {
        const layers6 = {
            generator: "PreR",
            scaling: 0.95,
            range: [1, 10]
        };
        const settings6 = {
            expandTarget: true,
            dontRefineSmall: true,
            postProcessing: "suppress"
        };
        step("[5] Positive Robust Pre(95) Layer Multi x4 Suppress", [
            () => new TransitionRefinery(sys, obj, just(ana), "q0", "q1", layers6, settings6).iterate(4)
        ], false);
    } catch (e) {
        snaps.take("ERROR", sys, ana, false);
        console.log(e);
    }


    // Benchmark #7: 2x safety, 5x self-loop (pessimistic, safe-only)
    reset();
    try {
        step("[5] Neutral", [
            () => new SafetyRefinery(sys, obj, just(ana)),
            () => new SafetyRefinery(sys, obj, just(ana)),
            () => new SelfLoopRefinery(sys, obj, just(ana), true, true),
            () => new SelfLoopRefinery(sys, obj, just(ana), true, true),
            () => new SelfLoopRefinery(sys, obj, just(ana), false, true),
            () => new SelfLoopRefinery(sys, obj, just(ana), false, true),
            () => new SelfLoopRefinery(sys, obj, just(ana), false, true)
        ], false);
    } catch (e) {
        snaps.take("ERROR", sys, ana, false);
        console.log(e);
    }


    // Export log
    fs.writeFileSync(logPath, JSON.stringify(log));

    // Export session
    const session = {
        objective: obj.serialize(),
        snapshots: snaps.serialize(false)
    };
    fs.writeFileSync(sessionPath, JSON.stringify(session));

}
