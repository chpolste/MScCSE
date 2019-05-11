// @flow
"use strict";

import type { Refinery } from "./refinement.js";

import * as fs from "fs";
// $FlowFixMe
import { performance } from "perf_hooks";

import { TwoPlayerProbabilisticGame, AnalysisResults } from "./game.js";
import { Halfspace, Polygon } from "./geometry.js";
import { parseProposition, Objective } from "./logic.js";
import { objectives } from "./presets.js";
import { TransitionRefinery } from "./refinement.js";
import { SnapshotTree } from "./snapshot.js";
import { LSS } from "./system.js";
import { iter, just, n2s, t2s } from "./tools.js";


export function run(sessionPath: string, logPath: string) {

    const xx = Polygon.hull([[0, 0], [4, 0], [0, 3], [4, 3]]);
    const ww = Polygon.hull([[-0.1, -0.1], [-0.1, 0.1], [0.1, -0.1], [0.1, 0.1]]);
    const uu = Polygon.hull([[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]);

    const A = [[1, 0], [0, 1]];
    const B = [[1, 0], [0, 1]];

    const r1 = Halfspace.normalized([-1,  0], -2.7);
    const r2 = Halfspace.normalized([ 1,  0], 1.3);
    const h1 = Halfspace.normalized([ 0, -1], -1.7);
    const h2 = Halfspace.normalized([ 0,  1], 1.3);

    // LSS
    const lss = new LSS(A, B, xx, ww, uu);
    let sys = lss.decompose([r1, r2, h1, h2], ["r1", "r2", "h1", "h2"]);
    let ana = null;

    // Predicates
    const room1 = parseProposition("r1");
    const room2 = parseProposition("r2");
    const walls = parseProposition("!r1 & !r2 & (h1 | h2)");

    /* CHOOSE OBJECTIVE */
    //const obj = new Objective(objectives["Reachability & Avoidance"], [room1, walls], true);
    const obj = new Objective(objectives["Safe 2-Recurrence"], [room1, room2, walls], false);

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
    step("[1] Initialization", null, true);

    let startSnap = snaps.current;

    function reset(): void {
        snaps.select(startSnap);
        sys = snaps.getSystem(startSnap);
        ana = snaps.getAnalysis(startSnap);
    }

    // Layered refinement
    try {
        const layers = {
            generator: "PreR",
            scaling: 0.95,
            range: [1, 10]
        };
        const settings = {
            expandTarget: true,
            dontRefineSmall: false,
            postProcessing: "none"
        };

        /* REACHABILITY OBJECTIVE */
        //step("[2] Reach Positive Robust Pre(95) Layer Multi x4 Suppress", [
            //() => new TransitionRefinery(sys, obj, just(ana), "q0", "q1", layers, settings).iterate(4)
        //], false);

        /* SAFE 2-RECURRENCE OBJECTIVE */
        step("[2] Recur Positive Robust Pre(95) Layer Multi x4 Suppress", [
            () => new TransitionRefinery(sys, obj, just(ana), "q1", "q2", layers, settings).iterate(4),
            () => new TransitionRefinery(sys, obj, just(ana), "q2", "q0", layers, settings).iterate(4)
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

