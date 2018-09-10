let assert = require("assert");
let rewire = require("rewire");
let geom = rewire("../../src/js/geometry.js");


describe("geometry internals", function () {

    const angleCCW = geom.__get__("angleCCW");

    it("angleCCW maps to [0, 2π)", function () {
        assert.equal(angleCCW([-1,  0], [-1, -0]), 0);
        assert.equal(angleCCW([-1, -0], [-1,  0]), 0);
        // Problem cases from previous bugs
        const probs = [
            [[ -0.8944271909999159, -0.44721359549995804 ], [ -0.894427190999916  , -0.447213595499958  ]],
            [[  0.4472135954999579,  0.8944271909999159  ], [  0.44721359549995787,  0.8944271909999159 ]]
        ];
        for (let [v, w] of probs) {
            const vw = angleCCW(v, w);
            const wv = angleCCW(w, v);
            assert(vw >= 0);
            assert(vw < geom.TOL);
            assert(wv >= 0);
            assert(wv < geom.TOL);
        }
    });

    it("angleCCW yields counterclockwise angle", function () {
        assert.equal(angleCCW([ 1,  0], [ 1,  0]), 0);
        assert.equal(angleCCW([ 1,  0], [ 1, -0]), 0);
        assert.equal(angleCCW([ 1, -0], [ 1, -0]), 0);
        assert.equal(angleCCW([ 1, -0], [ 1,  0]), 0);
        assert.equal(angleCCW([ 1,  0], [ 0,  1]), Math.PI / 2);
        assert.equal(angleCCW([ 1,  0], [-1,  0]), Math.PI);
        assert.equal(angleCCW([ 1,  0], [ 0, -1]), 3 * Math.PI / 2);
    });

    it ("angleCCW yields (2π - angle) for reverse argument order", function () {
        for (let i = 0; i <= 10000; i++) {
            const v1 = [2 * Math.random() - 1, 2 * Math.random() - 1];
            const v2 = [2 * Math.random() - 1, 2 * Math.random() - 1];
            const a12 = angleCCW(v1, v2);
            const a21 = angleCCW(v2, v1);
            // The exception is angle = 0, for which both argument orders return 0
            assert(2 * Math.PI - a12 - a21 < geom.TOL || (a12 === 0 && a21 === 0));
        }
        // Problem case: very close angles
        const h1 = new geom.HalfspaceInequality([-1, 0], -1);
        const h2 = new geom.HalfspaceInequality([-1, 2.1981294421572875e-15], -1);
        assert(angleCCW(h2.normal, h1.normal) < geom.TOL);
        assert(2 * Math.PI - angleCCW(h1.normal, h2.normal) < geom.TOL);
    });

    it("halfplaneIntersection", function () {
        let h1 = geom.HalfspaceInequality.normalized([1, 0], 0);
        let h2 = geom.HalfspaceInequality.normalized([0, 1], 0);
        let h3 = geom.HalfspaceInequality.normalized([1, 0], 1);
        let h4 = geom.HalfspaceInequality.normalized([0, 1], 1);
        let halfplaneIntersection = geom.__get__("halfplaneIntersection");
        assert.deepEqual(halfplaneIntersection(h1, h2), [0, 0]);
        assert.deepEqual(halfplaneIntersection(h2, h1), [0, 0]);
        assert.deepEqual(halfplaneIntersection(h3, h2), [1, 0]);
        assert.deepEqual(halfplaneIntersection(h1, h4), [0, 1]);
        assert.equal(halfplaneIntersection(h1, h1), null);
        assert.equal(halfplaneIntersection(h1, h3), null);
        assert.equal(halfplaneIntersection(h2, h4), null);
    });

    it("cartesian", function () {
        let cartesian = geom.__get__("cartesian");
        assert.deepEqual(cartesian([1], [2], [3]), [[1, 2, 3]]);
        assert.deepEqual(cartesian([1], [2], [3, 4]), [[1, 2, 3], [1, 2, 4]]);
        assert.deepEqual(cartesian([1], [2, 4], [3]), [[1, 2, 3], [1, 4, 3]]);
        assert.deepEqual(cartesian([1, 4], [2], [3]), [[1, 2, 3], [4, 2, 3]]);
    });

});

