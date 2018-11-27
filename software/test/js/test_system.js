// @flow

let assert = require("assert");
let tools = require("../../src/js/tools.js");
let geometry = require("../../src/js/geometry.js");
let linalg = require("../../src/js/linalg.js");
let system = require("../../src/js/system.js");

const imap = tools.iter.map;
const ifilter = tools.iter.filter;
const icount = tools.iter.count;
const Union = geometry.Union;

function actionPolytopesCoverControlSpace(sys) {
    return function () {
        for (let state of ifilter(s => !s.isOuter, sys.states.values())) {
            const actionPolytopes = [];
            for (let action of state.actions) {
                actionPolytopes.push(...action.controls.polytopes);
            }
            assert(actionPolytopes.length > 0);
            const actions = Union.from(actionPolytopes);
            assert(!actions.isEmpty);
            assert(actions.isSameAs(sys.lss.uus));
            assert(sys.lss.uus.isSameAs(actions));
        }
    }
}

function actionPolytopesDoNotOverlap(sys) {
    return function () {
        for (let state of sys.states.values()) {
            for (let action1 of state.actions) {
                for (let action2 of state.actions) {
                    if (action1 === action2) continue;
                    assert(!action1.controls.intersects(action2.controls));
                    assert(!action2.controls.intersects(action1.controls));
                }
            }
        }
    }
}

function actionSupportsArePreP(sys) {
    return function () {
        for (let state of sys.states.values()) {
            for (let action of state.actions) {
                const preR = sys.preR(action.origin, action.controls, action.targets);
                // PreR has to cover the entire origin polytope
                assert(state.polytope.isSameAs(preR));
                assert(preR.isSameAs(state.polytope));
                const supportPolys = [];
                for (let support of action.supports) {
                    supportPolys.push(...support.origins.polytopes);
                    // Origin is subset of PreR
                    assert(support.origins.intersects(preR));
                    assert(preR.intersects(support.origins));
                    assert(!support.origins.intersects(state.polytope.remove(preR)));
                    assert(!state.polytope.remove(preR).intersects(support.origins));
                    // Every target is reachable
                    for (let target of support.targets) {
                        let pre = action.origin.pre(action.controls, [target]);
                        assert(support.origins.intersects(pre));
                        assert(pre.intersects(support.origins));
                    }
                }
                // Supports have to cover entire origin polytope
                assert(supportPolys.length > 0);
                const support = Union.from(supportPolys);
                assert(state.polytope.isSameAs(support));
                assert(support.isSameAs(state.polytope));
            }
        }
    }
}

describe("Svoreňová et al. (2017): illustrative example system", function () {

    const lss = new system.LSS(
        [[1, 0], [0, 1]], // A
        [[1, 0], [0, 1]], // B
        geometry.Polygon.hull([[0, 0], [4, 0], [4, 2], [0, 2]]), // state space
        geometry.Polygon.hull([[-0.1, -0.1], [-0.1, 0.1], [0.1, -0.1], [0.1, 0.1]]), // random space
        geometry.Polygon.hull([[-1, -1], [-1, 1], [1, -1], [1, 1]]).toUnion() // control space
    );

    const sys = lss.decompose([geometry.Halfspace.parse("x > 2", "xy")]);

    it("has 6 states", function () {
        assert.equal(sys.states.size, 6);
    });

    it("has 18 actions", function () {
        let n = 0;
        for (let s of sys.states.values()) {
            n += s.actions.length;
        }
        assert.equal(n, 18);
    });

    it("outer states have no actions", function () {
        for (let state of sys.states.values()) {
            if (!state.polytope.intersects(sys.lss.xx)) {
                assert(state.isOuter);
                assert.equal(state.actions.length, 0);
            }
        }
    });

    it("union of action polytopes of each state is entire control space", actionPolytopesCoverControlSpace(sys));
    it("action polytopes of each state do not overlap", actionPolytopesDoNotOverlap(sys));
    it("supports of each action fulfil PreP properties", actionSupportsArePreP(sys));

});


describe("Svoreňová et al. (2017): double integrator system", function () {

    const lss = new system.LSS(
        [[1, 1], [0, 1]], // A
        [[0.5], [1]], // B
        geometry.Polygon.hull([[-5, 3], [-5, -3], [5, 3], [5, -3]]), // state space
        geometry.Polygon.hull([[-0.1, -0.1], [-0.1, 0.1], [0.1, -0.1], [0.1, 0.1]]), // random space
        geometry.Interval.hull([[-1], [1]]) // control space
    );

    const sys = lss.decompose([
        geometry.Halfspace.parse("-1 < x", "xy"),
        geometry.Halfspace.parse("x < 1", "xy"),
        geometry.Halfspace.parse("-1 < y", "xy"),
        geometry.Halfspace.parse("y < 1", "xy")
    ]);

    it("has 13 states", function () {
        assert.equal(sys.states.size, 13);
    });

    it("has 27 actions", function () {
        let n = 0;
        for (let s of sys.states.values()) {
            n += s.actions.length;
        }
        assert.equal(n, 27);
    });

    it("outer states have no actions", function () {
        for (let state of sys.states.values()) {
            if (!state.polytope.intersects(sys.lss.xx)) {
                assert(state.isOuter);
                assert.equal(state.actions.length, 0);
            }
        }
    });

    it("union of action polytopes of each state is entire control space", actionPolytopesCoverControlSpace(sys));
    it("action polytopes of each state do not overlap", actionPolytopesDoNotOverlap(sys));
    it("supports of each action fulfil PreP properties", actionSupportsArePreP(sys));

});

