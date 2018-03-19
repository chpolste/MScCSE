let assert = require("assert");
let rewire = require("rewire");
let geom = rewire("../../src/js/geometry.js");


describe("geom internals", function () {

    it("angleCCW maps to [0, 2π)", function () {
        let angleCCW = geom.__get__("angleCCW");
        assert.equal(angleCCW([-1,  0], [-1, -0]), 0);
        assert.equal(angleCCW([-1, -0], [-1,  0]), 0);
        let angle = angleCCW([ 0.4472135954999579, 0.8944271909999159 ], [ 0.44721359549995787, 0.8944271909999159 ]);
        assert(angle >= 0);
        assert(angle < geom.TOL);
        angle = angleCCW([ 0.44721359549995787, 0.8944271909999159 ], [ 0.4472135954999579, 0.8944271909999159 ])
        assert(angle >= 0);
        assert(angle < geom.TOL);
    });

    it("halfplaneIntersection", function () {
        let h1 = geom.HalfspaceInequation.normalized([1, 0], 0);
        let h2 = geom.HalfspaceInequation.normalized([0, 1], 0);
        let h3 = geom.HalfspaceInequation.normalized([1, 0], 1);
        let h4 = geom.HalfspaceInequation.normalized([0, 1], 1);
        let halfplaneIntersection = geom.__get__("halfplaneIntersection");
        assert.deepEqual(halfplaneIntersection(h1, h2), [0, 0]);
        assert.deepEqual(halfplaneIntersection(h2, h1), [0, 0]);
        assert.deepEqual(halfplaneIntersection(h3, h2), [1, 0]);
        assert.deepEqual(halfplaneIntersection(h1, h4), [0, 1]);
        assert.equal(halfplaneIntersection(h1, h1), null);
        assert.equal(halfplaneIntersection(h1, h3), null);
        assert.equal(halfplaneIntersection(h2, h4), null);
    });

    it("trapezoidalIntegrate", function () {
        let trapezoidalIntegrate = geom.__get__("trapezoidalIntegrate");
        assert.equal(trapezoidalIntegrate([0, 1], [1, 1]), 1);
        assert.equal(trapezoidalIntegrate([1, 1], [0, 1]), -1);
        assert.equal(trapezoidalIntegrate([0, 1], [2, 1]), 2);
    });

    it("cartesian", function () {
        let cartesian = geom.__get__("cartesian");
        assert.deepEqual(cartesian([1], [2], [3]), [[1, 2, 3]]);
        assert.deepEqual(cartesian([1], [2], [3, 4]), [[1, 2, 3], [1, 2, 4]]);
        assert.deepEqual(cartesian([1], [2, 4], [3]), [[1, 2, 3], [1, 4, 3]]);
        assert.deepEqual(cartesian([1, 4], [2], [3]), [[1, 2, 3], [4, 2, 3]]);
    });

});

