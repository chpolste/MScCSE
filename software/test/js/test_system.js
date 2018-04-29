// @flow

let assert = require("assert");
let geometry = require("../../src/js/geometry.js");
let linalg = require("../../src/js/linalg.js");
let system = require("../../src/js/system.js");


describe("Svoreňová et al. (2017): illustrative example system", function () {

    let lss = new system.LSS(
        [[1, 0], [0, 1]], // A
        [[1, 0], [0, 1]], // B
        geometry.Polygon.hull([[0, 0], [4, 0], [4, 2], [0, 2]]), // state space
        geometry.Polygon.hull([[-0.1, -0.1], [-0.1, 0.1], [0.1, -0.1], [0.1, 0.1]]), // random space
        [geometry.Polygon.hull([[-1, -1], [-1, 1], [1, -1], [1, 1]])] // control space
    );

    let sys = new system.AbstractedLSS(lss, [geometry.HalfspaceInequation.parse("x > 2", "xy")]);

    it("has 6 states", function () {
        assert.equal(sys.states.length, 6);
    });

    it("has 0 satisfying states", function () {
        assert.equal(sys.states.filter(s => s.isSatisfying).length, 0);
    });

    it("has 2 undecided states", function () {
        assert.equal(sys.states.filter(s => s.isUndecided).length, 2);
    });

    it("has 18 actions", function () {
        assert.equal(sys.states.map(s => s.actions.length).reduce((x, y) => x + y, 0), 18);
    });

    it("outside states have no actions", function () {
        sys.states.filter(s => s.isOutside).map(
            s => assert.equal(s.actions.length, 0)
        )
    });

    it("union of action polytopes of each state is entire control space", function () {
        for (let state of sys.states.filter(s => !s.isOutside)) {
            let actionPolytopes = [];
            for (let action of state.actions) {
                actionPolytopes.push(...action.controls);
            }
            assert(geometry.union.isSameAs(actionPolytopes, lss.controlSpace));
        }
    });

    it("action polytopes of each state do not overlap", function () {
        for (let state of sys.states) {
            for (let action1 of state.actions) {
                for (let action2 of state.actions) {
                    if (action1 === action2) continue;
                    assert(geometry.union.isEmpty(geometry.union.intersect(action1.controls, action2.controls)));
                }
            }
        }
    });

});


describe("Svoreňová et al. (2017): double integrator system", function () {

    let lss = new system.LSS(
        [[1, 1], [0, 1]], // A
        [[0.5], [1]], // B
        geometry.Polygon.hull([[-5, 3], [-5, -3], [5, 3], [5, -3]]), // state space
        geometry.Polygon.hull([[-0.1, -0.1], [-0.1, 0.1], [0.1, -0.1], [0.1, 0.1]]), // random space
        [geometry.Interval.hull([[-1], [1]])] // control space
    );

    let sys = new system.AbstractedLSS(lss, [
        geometry.HalfspaceInequation.parse("-1 < x", "xy"),
        geometry.HalfspaceInequation.parse("x < 1", "xy"),
        geometry.HalfspaceInequation.parse("-1 < y", "xy"),
        geometry.HalfspaceInequation.parse("y < 1", "xy")
    ]);

    it("has 13 states", function () {
        assert.equal(sys.states.length, 13);
    });

    it("has 0 satisfying states", function () {
        assert.equal(sys.states.filter(s => s.isSatisfying).length, 0);
    });

    it("has 9 undecided states", function () {
        assert.equal(sys.states.filter(s => s.isUndecided).length, 9);
    });

    it("has 27 actions", function () {
        assert.equal(sys.states.map(s => s.actions.length).reduce((x, y) => x + y, 0), 27);
    });

    it("outside states have no actions", function () {
        sys.states.filter(s => s.isOutside).map(
            s => assert.equal(s.actions.length, 0)
        )
    });

    it("union of action polytopes of each state is entire control space", function () {
        for (let state of sys.states.filter(s => !s.isOutside)) {
            let actionPolytopes = [];
            for (let action of state.actions) {
                actionPolytopes.push(...action.controls);
            }
            assert(geometry.union.isSameAs(actionPolytopes, lss.controlSpace));
        }
    });

    it("action polytopes of each state do not overlap", function () {
        for (let state of sys.states) {
            for (let action1 of state.actions) {
                for (let action2 of state.actions) {
                    if (action1 === action2) continue;
                    assert(geometry.union.isEmpty(geometry.union.intersect(action1.controls, action2.controls)));
                }
            }
        }
    });

});

