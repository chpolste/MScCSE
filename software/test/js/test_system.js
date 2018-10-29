// @flow

let assert = require("assert");
let tools = require("../../src/js/tools.js");
let geometry = require("../../src/js/geometry.js");
let linalg = require("../../src/js/linalg.js");
let system = require("../../src/js/system.js");

const imap = tools.iter.map;
const ifilter = tools.iter.filter;
const icount = tools.iter.count;


function actionPolytopesCoverControlSpace(sys) {
    return function () {
        for (let state of ifilter(s => !s.isOuter, sys.states.values())) {
            let actionPolytopes = [];
            for (let action of state.actions) {
                actionPolytopes.push(...action.controls);
            }
            assert(geometry.union.isSameAs(actionPolytopes, sys.lss.uus));
        }
    }
}

function actionPolytopesDoNotOverlap(sys) {
    return function () {
        for (let state of sys.states.values()) {
            for (let action1 of state.actions) {
                for (let action2 of state.actions) {
                    if (action1 === action2) continue;
                    assert(!geometry.union.doIntersect(action1.controls, action2.controls));
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
                assert(geometry.union.isSameAs([state.polytope], preR));
                const supportPolys = [];
                for (let support of action.supports) {
                    supportPolys.push(...support.origins);
                    // Origin is subset of PreR
                    assert(geometry.union.doIntersect(support.origins, preR));
                    assert(!geometry.union.doIntersect(support.origins, state.polytope.remove(...preR)));
                    // Every target is reachable
                    for (let target of support.targets) {
                        let pre = action.origin.pre(action.controls, [target]);
                        assert(geometry.union.doIntersect(support.origins, pre));
                    }
                }
                // Supports have to cover entire origin polytope
                assert(geometry.union.isSameAs([state.polytope], supportPolys));
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
        [geometry.Polygon.hull([[-1, -1], [-1, 1], [1, -1], [1, 1]])] // control space
    );

    const sys = lss.decompose([geometry.HalfspaceInequality.parse("x > 2", "xy")]);

    it("has 6 states", function () {
        assert.equal(sys.states.size, 6);
    });

    it("has 0 satisfying states", function () {
        assert.equal(icount(ifilter(s => s.isSatisfying, sys.states.values())), 0);
    });

    it("has 2 undecided states", function () {
        assert.equal(icount(ifilter(s => s.isUndecided, sys.states.values())), 2);
    });

    it("has 18 actions", function () {
        let n = 0;
        for (let s of sys.states.values()) {
            n += s.actions.length;
        }
        assert.equal(n, 18);
    });

    it("outside states have no actions", function () {
        imap(s => assert.equal(s.actions.length, 0), ifilter(s => s.isOuter, sys.states.values()));
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
        [geometry.Interval.hull([[-1], [1]])] // control space
    );

    const sys = lss.decompose([
        geometry.HalfspaceInequality.parse("-1 < x", "xy"),
        geometry.HalfspaceInequality.parse("x < 1", "xy"),
        geometry.HalfspaceInequality.parse("-1 < y", "xy"),
        geometry.HalfspaceInequality.parse("y < 1", "xy")
    ]);

    it("has 13 states", function () {
        assert.equal(sys.states.size, 13);
    });

    it("has 0 satisfying states", function () {
        assert.equal(icount(ifilter(s => s.isSatisfying, sys.states.values())), 0);
    });

    it("has 9 undecided states", function () {
        assert.equal(icount(ifilter(s => s.isUndecided, sys.states.values())), 9);
    });

    it("has 27 actions", function () {
        let n = 0;
        for (let s of sys.states.values()) {
            n += s.actions.length;
        }
        assert.equal(n, 27);
    });

    it("outside states have no actions", function () {
        imap(s => assert.equal(s.actions.length, 0), ifilter(s => s.isOuter, sys.states.values()));
    });

    it("union of action polytopes of each state is entire control space", actionPolytopesCoverControlSpace(sys));
    it("action polytopes of each state do not overlap", actionPolytopesDoNotOverlap(sys));
    it("supports of each action fulfil PreP properties", actionSupportsArePreP(sys));

});

