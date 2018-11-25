// @flow

let assert = require("assert");
let geometry = require("../../src/js/geometry.js");
let linalg = require("../../src/js/linalg.js");



describe("geometry.HalfspaceIneqation.parse", function () {

    let parse = geometry.Halfspace.parse;

    it("accepts 2D halfspace in various formats", function () {
        let hs = geometry.Halfspace.normalized([1, 2], 1);
        assert(hs.isSameAs(parse("x + 2y < 1", "xy")));
        assert(hs.isSameAs(parse("x + 2y <= 1", "xy")));
        assert(hs.isSameAs(parse("1 > x + 2y", "xy")));
        assert(hs.isSameAs(parse("2y < 1 - x", "xy")));
        assert(hs.isSameAs(parse("2a < 1 - b", "ba")));
        assert(hs.isSameAs(parse("0 < 1 - x - y -1y", "xy")));
        assert(hs.isSameAs(parse("- 1 + 1.0x+ 2y < 0", "xy")));
    });

    it("accepts trivial/infeasible inputs", function () {
        assert(parse("2 < 5", "").isTrivial);
        assert(parse("2 < 5", "x").isTrivial);
        assert(parse("5 < 2", "").isInfeasible);
        assert(parse("5 < 2", "y").isInfeasible);
        assert(parse("23 < 2", "xy").isInfeasible);
        // Ties are broken towards trivial
        assert(parse("x < x", "x").isTrivial);
    });

    it("rejects invalid input", function () {
        assert.throws(() => parse("", "y"));
        assert.throws(() => parse("14 a < 2x", "xy"));
        assert.throws(() => parse("1.x < 5", "x"));
        assert.throws(() => parse("13 x - 3y", "xy"));
        assert.throws(() => parse("16 z < x < 12 y", "xyz"));
    });

    it("determines dimension correctly even with missing variables", function () {
        assert.equal(parse("3z < 0", "z").dim, 1)
        assert.equal(parse("3y < 0", "xy").dim, 2)
        assert.equal(parse("3z < 0", "xyz").dim, 3)
        assert.equal(parse("3x + 2.0*z < 0", "xyz").dim, 3)
        assert.equal(parse("3x  < 0+ 2.0*z", "xyz").dim, 3)
    });

});


describe("geometry.Halfspace in 1 dimension", function () {
    
    let hs = new geometry.Halfspace([1], 0.5);

    it("normalized", function () {
        let hsn = geometry.Halfspace.normalized([2], 1);
        assert.equal(hsn.dim, hs.dim);
        assert.equal(hsn.offset, hs.offset);
        assert.deepEqual(hsn.normal, hs.normal);
        assert.equal(linalg.norm2(hsn.normal), 1);
    });

    it("normalized breaks offset === 0 ties in favor of trivial", function () {
        let h = geometry.Halfspace.normalized([0], 0);
        assert(h.isTrivial);
    });

    it("isInfeasible", function () {
        let h = geometry.Halfspace.normalized([0], -3);
        assert(h.isInfeasible);
        assert(!hs.isInfeasible);
    });

    it("isTrivial", function () {
        let h = geometry.Halfspace.normalized([0], 3);
        assert(h.isTrivial);
        assert(!hs.isTrivial);
    });

    it("flip", function () {
        let hsf = hs.flip();
        assert.equal(hsf.dim, 1);
        assert.equal(hsf.offset, -0.5);
        assert.deepEqual(hsf.normal, [-1]);
    });

    it("contains", function () {
        assert(hs.contains([0]));
        assert(hs.contains([-2]));
        assert(hs.contains([0.5]));
        assert(!hs.contains([1]));
        assert(!hs.contains([23]));
        assert.throws(() => hs.contains([1, 2]));
    });

    it("isSameAs", function () {
        assert(hs.isSameAs(hs));
    });

    it("translate", function () {
        let hsa = hs.translate([1]);
        assert.equal(hsa.offset, 1.5);
        assert.deepEqual(hsa.normal, hs.normal);
        let hsb = hs.translate([-0.5]);
        assert.equal(hsb.offset, 0);
        assert.deepEqual(hsb.normal, hs.normal);
    });

    it("applyRight with identity", function () {
        let hsa = hs.applyRight([[1]]);
        assert.deepEqual(hsa.normal, hs.normal);
        assert.equal(hsa.offset, hs.offset)
        assert.equal(hsa.dim, hs.dim)
    });

    it("applyRight with scaling", function () {
        let hsb = hs.applyRight([[2]]);
        assert.deepEqual(hsb.normal, hs.normal);
        assert.equal(hsb.offset, 0.25)
        assert.equal(hsb.dim, hs.dim)
    });

    it("applyRight with changing dimension", function () {
        let hsc = hs.applyRight([[0, 2]]);
        assert.deepEqual(hsc.normal, [0, 1]);
        assert.equal(hsc.offset, 0.25)
        assert.equal(hsc.dim, 2)
    });

});


describe("geometry.Interval", function () {

    const poly = new geometry.Interval([[-1], [1]], null);

    it("dim", function () {
        assert.equal(poly.dim, 1);
    });

    it("isSameAs", function () {
        assert(poly.isSameAs(poly));
        assert(poly.isSameAs(new geometry.Interval([[-1], [1]], null)));
        assert(!poly.isSameAs(new geometry.Interval([[-2], [1]], null)));
    });

    it("hull", function () {
        assert(poly.isSameAs(geometry.Interval.hull(poly.vertices)));
        assert(poly.isSameAs(geometry.Interval.hull([[-1], [0.5], [1], [-0.2], [0], [1 + geometry.TOL/2]])));
        assert(geometry.Interval.hull([[-1], [-1 + geometry.TOL/2], [-1]]).isEmpty);
    });

    it("noredund", function () {
        assert(poly.isSameAs(geometry.Interval.noredund(poly.halfspaces)));
        let halfspaces = [new geometry.Halfspace([-1], 1),
                          new geometry.Halfspace([-1], 1 + geometry.TOL/2),
                          new geometry.Halfspace([-1], 4),
                          new geometry.Halfspace([1], 1)];
        assert(poly.isSameAs(geometry.Interval.noredund(halfspaces)));
    });

    it("noredund yields empty for unbounded", function () {
        let halfspaces = [new geometry.Halfspace([-1], 1)];
        assert(geometry.Interval.noredund(halfspaces).isEmpty);
    });

    it("contains own vertices", function () {
        for (let vertex of poly.vertices) {
            assert(poly.contains(vertex));
        }
    });

    it("contains random points", function () {
        for (let i = 0; i < 1000; i++) {
            assert(poly.contains([Math.random() * 2 - 1]))
        }
    });

    it("volume", function () {
        assert.equal(poly.volume, 2);
        assert(poly.volume >= 0);
    });

    it("centroid", function () {
        assert.deepEqual(poly.centroid, [0]);
    });

    it("boundingBox", function () {
        // boundingBox is identity for all intervals
        assert(poly.isSameAs(poly.boundingBox));
    });

    it("isEmpty", function () {
        assert(!poly.isEmpty);
        assert(geometry.Interval.hull([[0], [geometry.TOL/2]]).isEmpty)
    });

    it("sample", function () {
        for (let i = 0; i < 1000; i++) {
            const sample = poly.sample();
            assert.equal(sample.length, 1);
            assert(poly.contains(sample));
        }
    });

    it("translate with identity", function () {
        assert(poly.isSameAs(poly.translate([0])));
    });

    it("translate", function () {
        let poly2 = geometry.Interval.hull([[2], [4]]);
        assert(poly2.isSameAs(poly.translate([3])));
        let poly3 = geometry.Interval.hull([[-2], [-4]]);
        assert(poly3.isSameAs(poly.translate([-3])));
    });

    it("apply with identity", function () {
        assert(poly.isSameAs(poly.apply([[1]])));
    });

    it("apply with dimension change is empty", function () {
        assert(poly.apply([[1], [3]]).isEmpty);
    });

    it("apply with mirroring", function () {
        assert(poly.isSameAs(poly.apply([[-1]])));
    });

    it("applyRight with identity", function () {
        assert(poly.isSameAs(poly.applyRight([[1]])));
    });

    it("applyRight with mirroring", function () {
        assert(poly.isSameAs(poly.applyRight([[-1]])));
    });

    it("applyRight with dimension change is empty", function () {
        assert(poly.applyRight([[1, 4]]).isEmpty);
    });

    it("minkowski", function () {
        let mink = geometry.Interval.hull([[2], [-2]]);
        assert(poly.minkowski(poly).isSameAs(mink));
    });

    it("pontryagin", function () {
        let pont = geometry.Interval.hull([[0.5], [-0.5]]);
        assert(poly.pontryagin(pont).isSameAs(pont));
    });

    it("intersect with self is identity", function () {
        assert(poly.isSameAs(poly.intersect(poly)));
    });

    it("intersect yields empty", function () {
        let poly2 = geometry.Interval.hull([[5], [24]]);
        assert(poly.intersect(poly2).isEmpty);
        assert(poly2.intersect(poly).isEmpty);
    });

    it("intersect at border yields empty", function () {
        let poly2 = geometry.Interval.hull([[1], [4]]);
        assert(poly.intersect(poly2).isEmpty);
        assert(poly2.intersect(poly).isEmpty);
    });

    it("intersect with inner", function () {
        let poly2 = geometry.Interval.hull([[0.3], [0.9]]);
        assert(poly.intersect(poly2).isSameAs(poly2));
        assert(poly2.intersect(poly).isSameAs(poly2));
    });

    it("intersect with outer", function () {
        let poly2 = geometry.Interval.hull([[-4], [10]]);
        assert(poly.intersect(poly2).isSameAs(poly));
        assert(poly2.intersect(poly).isSameAs(poly));
    });

    it("remove self yields empty", function () {
        let diff = poly.remove(poly);
        assert(diff.isEmpty);
        assert.equal(diff.polytopes.length, 0);
    });

    it("remove with overlap", function () {
        let poly2 = poly.translate([1.8]);
        let poly3 = poly.translate([-1.7]);
        let diff0 = geometry.Interval.hull([[-0.7], [0.8]]);
        let diff = poly.remove(geometry.Union.from([poly2, poly3]));
        assert(!diff.isEmpty);
        assert.equal(diff.polytopes.length, 1);
        assert(diff.isSameAs(diff0));
        assert(diff0.isSameAs(diff));
    });

    it("remove without intersection", function () {
        let poly2 = geometry.Interval.hull([[5], [10]]);
        let diff = poly.remove(poly2);
        assert(!diff.isEmpty);
        assert.equal(diff.polytopes.length, 1);
        assert(diff.isSameAs(poly));
        diff = poly2.remove(poly);
        assert(!diff.isEmpty);
        assert.equal(diff.polytopes.length, 1);
        assert(diff.isSameAs(poly2));
        assert(poly2.isSameAs(diff));
    });

    it("remove middle", function () {
        let poly2 = geometry.Interval.hull([[-0.5], [0.5]]);
        let diff = poly.remove(poly2);
        assert(!diff.isEmpty);
        assert.equal(diff.polytopes.length, 2);
    });

    it("split once", function () {
        let poly2 = geometry.Interval.hull([[0], [1]]);
        let poly3 = geometry.Interval.hull([[0], [-1]]);
        let [part1, part2] = poly.split(new geometry.Halfspace([1], 0));
        assert(part1.isSameAs(poly2) || part2.isSameAs(poly2));
        assert(part1.isSameAs(poly3) || part2.isSameAs(poly3));
        assert(!part1.isSameAs(part2));
    });

    it("split with own halfspaces yields self and empty", function () {
        for (let halfspace of poly.halfspaces) {
            const [p1, p2] = poly.split(halfspace);
            assert(p1.isSameAs(poly));
            assert(p2.isEmpty);
            const [p3, p4] = poly.split(halfspace.flip());
            assert(p3.isEmpty);
            assert(p4.isSameAs(poly));
        }
    });

});


describe("geometry.Polygon with square", function () {

    const poly = new geometry.Polygon([[0, 1], [0, 0], [1, 0], [1, 1]], null);

    it("transformations between vertices and halfspaces are consistent", function () {
        let fromVtoH = new geometry.Polygon(null, poly.halfspaces);
        let fromHtoV = new geometry.Polygon(fromVtoH.vertices, null);
        assert(poly.isSameAs(fromHtoV));
        assert.deepEqual(poly.vertices, fromHtoV.vertices);
    });

    it("dim", function () {
        assert.equal(poly.dim, 2);
    });

    it("isSameAs", function () {
        assert(poly.isSameAs(geometry.Polygon.hull([[0, 0], [1, 0], [1, 1], [0, 1]])));
        assert(poly.isSameAs(geometry.Polygon.hull([[1, 0], [1, 1], [0, 1], [0, 0]])));
        assert(poly.isSameAs(geometry.Polygon.hull([[0, 0], [1, 0], [1, 1], [0, 1]])));
        assert(poly.isSameAs(geometry.Polygon.hull([[0, 1], [0, 0], [1, 0], [1, 1]])));
        assert(!poly.isSameAs(geometry.Polygon.hull([[0, 1], [0, 0], [1, 0]])));
        assert(!poly.isSameAs(geometry.Polygon.hull([[1, 0], [1, 1], [0, 1], [0.1, 0]])));
    });

    it("hull", function () {
        assert(poly.isSameAs(geometry.Polygon.hull(poly.vertices)));
        assert(poly.isSameAs(geometry.Polygon.hull([[1, 0], [1, 1], [0, 0], [0, 1]])));
        assert(poly.isSameAs(geometry.Polygon.hull([[1, 1], [1, geometry.TOL/2], [0, 0], [0, 1]])));
        assert(geometry.Polygon.hull([[0, 0], [0, 1], [0, 1], [0, 0.5]]).isEmpty);
        assert.throws(() => geometry.Polygon.hull([[1], [2, 3], [1, 0], [4, 5]]));
        assert.throws(() => geometry.Polygon.hull([[1], [2], [1], [4]]));
    });

    it("noredund", function () {
        assert(poly.isSameAs(geometry.Polygon.noredund(poly.halfspaces)));
    });

    it("noredund yields empty for unbounded", function () {
        assert(geometry.Polygon.noredund(poly.halfspaces.slice(1)).isEmpty);
    });

    it("contains own vertices", function () {
        for (let vertex of poly.vertices) {
            assert(poly.contains(vertex));
        }
    });

    it("contains random points", function () {
        for (let i = 0; i < 1000; i++) {
            assert(poly.contains([Math.random(), Math.random()]))
        }
    });

    it("volume", function () {
        assert.equal(poly.volume, 1);
    });

    it("centroid", function () {
        assert.deepEqual(poly.centroid, [0.5, 0.5]);
    });

    it("boundingBox", function () {
        // Square is axis aligned so boundingBox is identity
        assert(poly.isSameAs(poly.boundingBox));
    });

    it("isEmpty", function () {
        assert(!poly.isEmpty);
        assert(poly.applyRight([[0, 1], [0, 1]]).isEmpty);
        assert(poly.apply([[geometry.TOL, 0], [0, geometry.TOL]]).isEmpty);
    });

    it("sample", function () {
        for (let i = 0; i < 1000; i++) {
            const sample = poly.sample();
            assert.equal(sample.length, 2);
            assert(poly.contains(sample));
        }
    });

    it("translate with identity", function () {
        assert(poly.isSameAs(poly.translate([0, 0])));
    });

    it("translate", function () {
        let poly2 = geometry.Polygon.hull([[1, 2], [2, 2], [1, 3], [2, 3]]);
        assert(poly2.isSameAs(poly.translate([1, 2])));
    });

    it("apply with identity", function () {
        assert(poly.isSameAs(poly.apply([[1, 0], [0, 1]])));
    });

    it("apply with rotation", function () {
        let rotation = [[-1, 0], [0, -1]];
        let rotatedPoly = geometry.Polygon.hull([[0, 0], [-1, 0], [-1, -1], [0, -1]]);
        assert(rotatedPoly.isSameAs(poly.apply(rotation)));
    });

    it("apply with mirroring", function () {
        let mirror = [[-1, 0], [0, 1]];
        let mirroredPoly = geometry.Polygon.hull([[0, 0], [0, 1], [-1, 1], [-1, 0]]);
        assert(mirroredPoly.isSameAs(poly.apply(mirror)));
    });

    it("apply with dimension change", function () {
        let poly2 = geometry.Interval.hull([[0], [3]]);
        assert(poly.apply([[1, 2]]).isSameAs(poly2));
    });

    it("applyRight with identity", function () {
        assert(poly.isSameAs(poly.applyRight([[1, 0], [0, 1]])));
    });

    it("applyRight with rotation", function () {
        let rotation = linalg.inv([[-1, 0], [0, -1]]);
        let rotatedPoly = geometry.Polygon.hull([[0, 0], [-1, 0], [-1, -1], [0, -1]]);
        assert(rotatedPoly.isSameAs(poly.applyRight(rotation)));
    });

    it("applyRight with mirroring", function () {
        let mirror = linalg.inv([[-1, 0], [0, 1]]);
        let mirroredPoly = geometry.Polygon.hull([[0, 0], [0, 1], [-1, 1], [-1, 0]]);
        assert(mirroredPoly.isSameAs(poly.applyRight(mirror)));
    });

    it("applyRight with dimension change", function () {
        let poly2 = geometry.Interval.hull([[0], [0.5]]);
        assert(poly.applyRight([[1], [2]]).isSameAs(poly2));
    });

    it("minkowski", function () {
        let mink = geometry.Polygon.hull([[0, 0], [2, 2], [2, 0], [0, 2]]);
        assert(poly.minkowski(poly).isSameAs(mink));
    });

    it("pontryagin", function () {
        let pont = geometry.Polygon.hull([[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]]);
        let pontTri = geometry.Polygon.hull([[0, 0], [0.5, 0], [0, 0.5]]);
        assert(poly.pontryagin(pont).isSameAs(pont));
        assert(poly.pontryagin(pontTri).isSameAs(pont));
    });

    it("intersect with self is identity", function () {
        assert(poly.isSameAs(poly.intersect(poly)));
    });

    it("intersect yields empty", function () {
        let poly2 = geometry.Polygon.hull([[-2, -2], [-1, -2], [-2, -1]]);
        assert(poly.intersect(poly2).isEmpty);
        assert(poly2.intersect(poly).isEmpty);
    });

    it("intersect at border yields empty", function () {
        let poly2 = geometry.Polygon.hull([[1, 0], [1.5, 0.5], [1, 1]]);
        assert(poly.intersect(poly2).isEmpty);
        assert(poly2.intersect(poly).isEmpty);
    });

    it("intersect at corner yields empty", function () {
        let poly2 = geometry.Polygon.hull([[1, 1], [2, 1], [2, 2]]);
        assert(poly.intersect(poly2).isEmpty);
        assert(poly2.intersect(poly).isEmpty);
    });

    it("intersect with inner", function () {
        let poly2 = geometry.Polygon.hull([[0.2, 0.2], [0.5, 0.2], [0.2, 0.5]]);
        assert(poly.intersect(poly2).isSameAs(poly2));
        assert(poly2.intersect(poly).isSameAs(poly2));
    });

    it("intersect with outer", function () {
        let poly2 = geometry.Polygon.hull([[-1, -1], [2, -0.5], [3, 4], [-4, 10]]);
        assert(poly.intersect(poly2).isSameAs(poly));
        assert(poly2.intersect(poly).isSameAs(poly));
    });

    it("intersect with overlap", function () {
        let poly2 = geometry.Polygon.hull([[-1, -1], [0.5, -1], [0.5, 3], [-1, 2]]);
        let result = geometry.Polygon.hull([[0, 0], [0.5, 0], [0.5, 1], [0, 1]]);
        assert(poly.intersect(poly2).isSameAs(result));
        assert(poly2.intersect(poly).isSameAs(result));
    });

    it("remove self yields empty", function () {
        let diff = poly.remove(poly);
        assert(diff.isEmpty);
    });

    it("remove with tall extension", function () {
        let poly2 = geometry.Polygon.hull([[0, 0], [1, 0], [1, 2], [0, 2]]);
        let diff0 = geometry.Polygon.hull([[0, 1], [1, 1], [1, 2], [0, 2]]);
        let diff = poly2.remove(poly);
        assert(!diff.isEmpty);
        assert.equal(diff.polytopes.length, 1);
        assert(diff0.isSameAs(diff));
        assert(diff.isSameAs(diff0));
    });

    it("remove with wide extension", function () {
        let poly2 = geometry.Polygon.hull([[0, 0], [2, 0], [2, 1], [0, 1]]);
        let diff0 = geometry.Polygon.hull([[1, 0], [2, 0], [2, 1], [1, 1]]);
        let diff = poly2.remove(poly);
        assert(!diff.isEmpty);
        assert.equal(diff.polytopes.length, 1);
        assert(diff0.isSameAs(diff));
        assert(diff.isSameAs(diff0));
    });

    it("remove with overlap", function () {
        let poly2 = poly.translate([0.8, 0]);
        let poly3 = poly.translate([0, 0.8]);
        let diff0 = geometry.Polygon.hull([[0, 0], [0.8, 0], [0.8, 0.8], [0, 0.8]]);
        let diff = poly.remove(geometry.Union.from([poly2, poly3]));
        assert(!diff.isEmpty);
        assert.equal(diff.polytopes.length, 1);
        assert(diff0.isSameAs(diff));
        assert(diff.isSameAs(diff0));
    });

    it("remove without intersection", function () {
        let poly2 = geometry.Polygon.hull([[1, 1], [2, 1], [1, 2]]);
        let diff = poly.remove(poly2);
        assert(!diff.isEmpty);
        assert.equal(diff.polytopes.length, 1);
        assert(diff.isSameAs(poly));
        assert(poly.isSameAs(diff));
        // other way around
        diff = poly2.remove(poly);
        assert(!diff.isEmpty);
        assert.equal(diff.polytopes.length, 1);
        assert(!diff.isSameAs(poly));
        assert(!poly.isSameAs(diff));
        assert(diff.isSameAs(poly2));
        assert(poly2.isSameAs(diff));
    });

    it("remove middle", function () {
        let poly2 = geometry.Polygon.hull([[0.2, -1], [0.6, 0], [0.5, 3]]);
        let diff = poly.remove(poly2);
        assert(!diff.isEmpty);
        assert(diff.polytopes.length >= 2);
    });

    it("split with vertical", function () {
        let poly2 = geometry.Polygon.hull([[0, 0], [0.5, 0], [0.5, 1], [0, 1]]);
        let poly3 = geometry.Polygon.hull([[0.5, 0], [1, 0], [1, 1], [0.5, 1]]);
        let [part1, part2] = poly.split(new geometry.Halfspace([1, 0], 0.5));
        assert(part1.isSameAs(poly2) || part2.isSameAs(poly2));
        assert(part1.isSameAs(poly3) || part2.isSameAs(poly3));
        assert(!part1.isSameAs(part2));
    });

    it("split with own halfspaces yields self and empty", function () {
        for (let halfspace of poly.halfspaces) {
            const [p1, p2] = poly.split(halfspace);
            assert(p1.isSameAs(poly));
            assert(p2.isEmpty);
            const [p3, p4] = poly.split(halfspace.flip());
            assert(p3.isEmpty);
            assert(p4.isSameAs(poly));
        }
    });

    // TODO

});


describe("geometry problem cases", function () {

    it("Polygon remove inner with angle < 0 edge case", function () {
        let inner = geometry.Polygon.hull([[-1, -1], [1, -1], [5, 1], [-1, 4]]);
        let poly1 = geometry.Polygon.hull([[-1, -1], [1, -1], [1, 1], [-1, 0.3], [0, 1.6]]);
        let poly2 = geometry.Polygon.hull([[-1, 1], [1, -1], [1, 1], [0, 0]]);
        let outer = inner.minkowski(poly1).minkowski(poly2);
        assert(!inner.intersect(outer).isEmpty);
        assert(!outer.intersect(inner).isEmpty);
        let diff = outer.remove(inner);
        assert(!diff.isEmpty);
    });

    // Due to the perturbations, the [-0.5, 0.7] points are close but not
    // next to each other when ordered by x-coordinate. This caused hull to
    // yield wrong results when isCCWTurn was still using TOL instead of 0
    // which was not appropriate anymore after commit 1d8c394.
    it("Polygon.hull with close points", function () {
        const vs = [
            [ -0.7000000000000004, 0.8000000000000005 ],
            [ -0.5999999999999999, 0.7 ],
            [ -0.5000000000000001, 0.7 ],
            [ -0.6000000000000004, 0.8000000000000004 ],
            [ -0.6000000000000001, 0.8000000000000005 ],
            [ -0.5, 0.7000000000000003 ],
            [ -0.5, 0.8000000000000003 ]
        ];
        const hull = geometry.Polygon.hull(vs);
        const ref = geometry.Polygon.hull([[-0.7, 0.8], [-0.6, 0.7], [-0.5, 0.7], [-0.5, 0.8]]);
        assert(hull.isSameAs(ref));
        assert(ref.isSameAs(hull));
    });

    // This is related to the previous test case, but the assertions are
    // more high-level instead of directly targeting the problem. Since
    // a few different operations of polytopes and union are used here,
    // keep this test.
    it("Action support computation-like operations", function () {
        const state = geometry.Polygon.hull([[-1, 1], [-1, 0.5], [-0.5, 0.5], [-0.5, 1]]);
        const supports = geometry.Union.from([
            [[-1, 0.6000000000000001], [-1, 0.5], [-0.8999999999999999, 0.5]] ,
            [[-1, 0.8000000000000002], [-1, 0.7000000000000001], [-0.8, 0.7000000000000001], [-0.9000000000000001, 0.8000000000000003]] ,
            [[-1, 0.9], [-1, 0.8000000000000002], [-0.9000000000000001, 0.8000000000000003]] ,
            [[-1, 1], [-1, 0.9], [-0.9000000000000001, 0.8000000000000003], [-0.7000000000000002, 0.8000000000000003], [-0.9, 1]] ,
            [[-1.0000000000000002, 0.7000000000000001], [-0.9000000000000002, 0.5], [-0.6, 0.5], [-0.8, 0.7000000000000001]] ,
            [[-0.8, 0.7000000000000001], [-0.6, 0.5], [-0.5, 0.5], [-0.5, 0.6000000000000001], [-0.6000000000000001, 0.7000000000000001]] ,
            [[-1, 0.6999999999999996], [-1, 0.6000000000000001], [-0.9000000000000005, 0.5000000000000006]] ,
            [[-0.9000000000000001, 0.8000000000000003], [-0.8, 0.7000000000000001], [-0.6000000000000001, 0.7000000000000001], [-0.7000000000000002, 0.8000000000000003]] ,
            [[-0.9, 1], [-0.7000000000000002, 0.8000000000000003], [-0.5000000000000002, 0.8000000000000002], [-0.6000000000000001, 1]] ,
            [[-0.6000000000000002, 1.0000000000000004], [-0.5, 0.7999999999999998], [-0.5, 0.9]] ,
            [[-0.6, 1], [-0.5, 0.9], [-0.5, 1]] ,
            [[-0.6000000000000001, 0.7000000000000001], [-0.5, 0.6000000000000001], [-0.5, 0.7000000000000001]] ,
            [[-0.7000000000000002, 0.8000000000000003], [-0.6000000000000001, 0.7000000000000001], [-0.5, 0.7000000000000001], [-0.5, 0.8000000000000002]]
        ].map(vs => geometry.Polygon.hull(vs)));
        // Union of supports is state
        const diff = state.remove(supports);
        assert(diff.isEmpty);
        assert(state.isSameAs(supports));
        assert(supports.isSameAs(state));
        assert(supports.simplify().isSameAs(supports));
        assert(supports.simplify().isSameAs(state));
        // This was the precise predecessor
        const prer = geometry.Union.from([
            [[-1, 1], [-1, 0.5], [-0.5, 0.5], [-0.5, 0.7000000000000001], [-0.8, 1]] ,
            [[-0.8, 1], [-0.6000000000000002, 0.8000000000000003], [-0.5, 0.8000000000000002], [-0.5, 1]] ,
            [[-0.6000000000000002, 0.8000000000000003], [-0.5, 0.7000000000000001], [-0.5, 0.8000000000000002]]
        ].map(vs => geometry.Polygon.hull(vs)));
        // ... which also should be the same as the state
        assert(state.remove(prer).isEmpty);
        assert(state.isSameAs(prer));
        // Now reproduce the calculation of supports: intersect each support
        // polytope with the PreR. Since PreR = state = support union, this
        // should be a geometric identity operation. This failed for the last
        // polytope due to a bug in Polygon.hull which is used by simplify.
        for (let poly of supports.polytopes) {
            const inter1 = prer.intersect(poly);
            const inter2 = poly.intersect(prer);
            assert(poly.isSameAs(inter1));
            assert(poly.isSameAs(inter2));
            assert(inter1.isSameAs(inter1.simplify()));
            assert(inter2.isSameAs(inter2.simplify()));
            assert(poly.isSameAs(inter1.simplify()));
            assert(poly.isSameAs(inter2.simplify()));
        }
    });

    it("Intersection with halfspace order float instability", function () {
        const innerHs1 = [
             new geometry.Halfspace([ -0.5547001962252289, -0.8320502943378439 ], -3.5223462460302057),
             new geometry.Halfspace([ 0.7071067811865472, 0.7071067811865479 ], 3.818376618407357),
             new geometry.Halfspace([ 0, 1 ], 3)
        ];
        const innerHs2 = [
            new geometry.Halfspace([ -0.554700196225229, -0.8320502943378436 ], -3.5223462460302053),
            new geometry.Halfspace([ 0.7071067811865475, 0.7071067811865475 ], 3.8183766184073566),
            new geometry.Halfspace([ 0, 1 ], 3)
        ];
        assert.equal(innerHs1.length, innerHs2.length);
        for (let i = 0; i < innerHs1.length; i++) {
            assert(innerHs1[i].isSameAs(innerHs2[i]));
            assert(innerHs2[i].isSameAs(innerHs1[i]));
        }

        const outerHs1 = [
            new geometry.Halfspace([ -0.7071067811865476, -0.7071067811865476 ], -3.2880465325174475),
            new geometry.Halfspace([ -0.55470019622523, -0.8320502943378432 ], -2.2188007849009224),
            new geometry.Halfspace([ 0, -1 ], 1.7000000000000017),
            new geometry.Halfspace([ 1, -2.4671622769448e-16 ], 6.749999999999998),
            new geometry.Halfspace([ 0.7071067811865498, 0.7071067811865451 ], 6.116473657263642),
            new geometry.Halfspace([ 0.554700196225228, 0.8320502943378444 ], 5.436061923007241),
            new geometry.Halfspace([ 0, 1 ], 3.5999999999999974)
        ];
        const outerHs2 = [
            new geometry.Halfspace([ -0.7071067811865475, -0.7071067811865475 ], -3.288046532517447),
            new geometry.Halfspace([ -0.5547001962252296, -0.8320502943378435 ], -2.2188007849009197),
            new geometry.Halfspace([ 0, -1 ], 1.6999999999999977),
            new geometry.Halfspace([ 1, -1.5700924586837752e-16 ], 6.749999999999998),
            new geometry.Halfspace([ 0.7071067811865475, 0.7071067811865475 ], 6.1164736572636285),
            new geometry.Halfspace([ 0.5547001962252285, 0.8320502943378442 ], 5.436061923007242),
            new geometry.Halfspace([ 0, 1 ], 3.599999999999997)
        ];
        assert.equal(outerHs1.length, outerHs2.length);
        for (let i = 0; i < outerHs1.length; i++) {
            assert(outerHs1[i].isSameAs(outerHs2[i]));
            assert(outerHs2[i].isSameAs(outerHs1[i]));
        }

        const innerPoly1 = geometry.Polygon.intersection(innerHs1);
        const innerPoly2 = geometry.Polygon.intersection(innerHs2);
        const outerPoly1 = geometry.Polygon.intersection(outerHs1);
        const outerPoly2 = geometry.Polygon.intersection(outerHs2);

        const innerPolyHs1 = innerPoly1.halfspaces;
        const innerPolyHs2 = innerPoly2.halfspaces;
        assert.equal(innerPolyHs1.length, innerPolyHs2.length);
        for (let i = 0; i < innerPolyHs1.length; i++) {
            assert(innerPolyHs1[i].isSameAs(innerPolyHs2[i]));
            assert(innerPolyHs2[i].isSameAs(innerPolyHs1[i]));
        }

        const outerPolyHs1 = outerPoly1.halfspaces;
        const outerPolyHs2 = outerPoly2.halfspaces;
        assert.equal(outerPolyHs1.length, outerPolyHs2.length);
        for (let i = 0; i < outerPolyHs1.length; i++) {
            assert(outerPolyHs1[i].isSameAs(outerPolyHs2[i]));
            assert(outerPolyHs2[i].isSameAs(outerPolyHs1[i]));
        }

        const interPoly1 = innerPoly1.intersect(outerPoly1);
        const interPoly2 = innerPoly2.intersect(outerPoly2);
        assert(interPoly1.isSameAs(interPoly2));

        const interPoly1reverse = outerPoly1.intersect(innerPoly1);
        const interPoly2reverse = outerPoly2.intersect(innerPoly2);
        assert(interPoly1reverse.isSameAs(interPoly2reverse));
    });

    it("Polygon.hull and Polygon.intersection are equivalent", function () {
        const vertices = [
            [-5.75, 1.5],
            [-5.75, 1.2999999999999998],
            [-2.6, 1.2999999999999998],
            [-2.45, 1.6],
            [-2.45, 1.7999999999999998],
            [-3.2, 3.3],
            [-4.8500000000000005, 3.3],
            // This point lies on the edge of the previous and first point:
            [-5.6000000000000005, 1.7999999999999998]
        ];
        const poly = geometry.Polygon.hull(vertices);
        const poly2 = geometry.Polygon.intersection(poly.halfspaces);
        assert.equal(poly.vertices.length, 7);
        assert.equal(poly.vertices.length, poly2.vertices.length);
    });

    it("Polygon.hull removes straight sections", function () {
        const vs = [ [ -1, 1 ], [ -1, 0.5 ], [ -0.5, 0.5 ], [ -0.5, 1 ] ];
        const ws = [ [ -1.0000000000000002, 0.7000000000000001 ], [ -1, 0.5 ], [ -0.5, 0.5 ], [ -0.5, 1 ], [ -1, 1 ] ];
        const vPoly = geometry.Polygon.hull(vs);
        const wPoly = geometry.Polygon.hull(ws);
        assert(vPoly.isSameAs(wPoly));
        assert(wPoly.isSameAs(vPoly));
    });

    it("Polygon.hull works for Kettner et al. edge case", function () {
        // Taken from: https://github.com/mikolalysenko/robust-arithmetic-notes
        const vs = [ [24.00000000000005, 24.000000000000053],
            [54.85, 6],
            [24.000000000000068, 24.000000000000071],
            [54.850000000000357, 61.000000000000121],
            [24, 6],
            [6, 6]
        ];
        const vPoly = geometry.Polygon.hull(vs);
        assert(!vPoly.isEmpty);
        assert.equal(vPoly.vertices.length, 3);
    });

});


describe("geometry.Union", function () {

    const Interval = geometry.Interval;
    const Polygon = geometry.Polygon;
    const Union = geometry.Union;

    const i1 = Interval.hull([[0], [1], [-3]]);
    const i2 = Interval.hull([[0], [3]]);
    const i3 = Interval.hull([[-3], [3]]);
    const ie = Interval.empty();

    const p1 = Polygon.hull([[0, 0], [1, 0], [0, 1]]);
    const p2 = Polygon.hull([[2, 0], [2, 1], [1, 0], [0, 1]]);
    const pe = Polygon.empty();

    it("Union.from only accepts polygons of same dimension", function () {
        assert(!Union.from([p1]).isEmpty);
        assert(!Union.from([p1, p2]).isEmpty);
        assert(!Union.from([i1, i2, i1]).isEmpty);
        assert(!Union.from([p1, p2]).isEmpty);
        assert.throws(() => Union.from([p1, i1]));
        assert.throws(() => Union.from([p1, i2, p2]));
        assert.throws(() => Union.from([pe, pe, ie]));
    });

    it("isEmpty", function () {
        assert(Union.from([ie]).isEmpty);
        assert(Union.from([pe]).isEmpty);
        assert(Union.from([ie, ie]).isEmpty);
        assert(Union.from([pe, pe, pe]).isEmpty);
        assert(!Union.from([p1]).isEmpty);
        assert(!Union.from([p1, pe]).isEmpty);
        assert(!Union.from([ie, i1, ie, ie, i2]).isEmpty);
    });

    it("isDisjunct is true for single-member union", function () {
        assert(ie.toUnion().isDisjunct);
        assert(pe.toUnion().isDisjunct);
        assert(i1.toUnion().isDisjunct);
        assert(p2.toUnion().isDisjunct);
        assert(Union.from([i1]).isDisjunct);
        assert(Union.from([p2]).isDisjunct);
    });
    // TODO: more isDisjunct testing

    it("volume of single-member union is same as member volume", function () {
        assert.equal(ie.toUnion().volume, ie.volume);
        assert.equal(i1.toUnion().volume, i1.volume);
        assert.equal(pe.toUnion().volume, pe.volume);
        assert.equal(p1.toUnion().volume, p1.volume);
    });

    it("boundingBox", function () {
        const bbox = geometry.Polygon.hull([[0, 0], [2, 0], [0, 1], [2, 1]]);
        assert(Union.from([p1, p2]).boundingBox.isSameAs(bbox));
        assert(Union.from([p2, p1]).boundingBox.isSameAs(bbox));
    });

    it("extent", function () {
        assert.deepEqual(p1.toUnion().extent, [[0, 1], [0, 1]]);
        assert.deepEqual(p2.toUnion().extent, [[0, 2], [0, 1]]);
        assert.deepEqual(Union.from([p1, p2]).extent, [[0, 2], [0, 1]]);
        assert.deepEqual(Union.from([p2, p1]).extent, [[0, 2], [0, 1]]);
    });

    it("isSameAs with single member", function () {
        assert(i1.isSameAs(i1.toUnion()));
        assert(p1.isSameAs(p1.toUnion()));
        assert(i1.toUnion().isSameAs(i1));
        assert(p1.toUnion().isSameAs(p1));
        assert(i1.toUnion().isSameAs(i1.toUnion()));
        assert(p1.toUnion().isSameAs(p1.toUnion()));
        // TODO: neg
    });

    it("isSameAs with multiple members", function () {
        assert(Union.from([i1, i2]).isSameAs(i3));
        assert(Union.from([i2, i1]).isSameAs(i3));
        assert(Union.from([i1, i2, i2]).isSameAs(i3));
        assert(Union.from([i1, i1, i2]).isSameAs(i3));
        assert(Union.from([i1, i2]).isSameAs(i3.toUnion()));
        assert(Union.from([i1, i2]).isSameAs(Union.from([i1, i2])));
        assert(Union.from([i1, i2]).isSameAs(Union.from([i2, i1])));
        assert(Union.from([i1, i2]).isSameAs(Union.from([i2, i1, i1, i2])));
        assert(!Union.from([i1, i2]).isSameAs(i1));
        assert(!Union.from([i1, i2]).isSameAs(i2.toUnion()));
    });

    it("isSameAs with empty", function () {
        assert(ie.toUnion().isSameAs(ie));
        assert(ie.isSameAs(ie.toUnion()));
        assert(ie.toUnion().isSameAs(ie.toUnion()));
        assert(pe.toUnion().isSameAs(pe));
        assert(pe.isSameAs(pe.toUnion()));
        assert(pe.toUnion().isSameAs(pe.toUnion()));
        assert(Union.from([ie, ie]).isSameAs(ie));
        assert(Union.from([ie, ie]).isSameAs(ie.toUnion()));
        assert(Union.from([ie, ie]).isSameAs(Union.from([ie, ie])));
        assert(Union.from([ie, ie]).isSameAs(Union.from([ie, ie, ie])));
    });

    it("covers", function () {
        assert(i3.toUnion().covers(i1));
        assert(i3.toUnion().covers(i2));
        assert(i3.toUnion().covers(i3));
        assert(i3.toUnion().covers(i1.toUnion()));
        assert(i3.toUnion().covers(i2.toUnion()));
        assert(i3.toUnion().covers(i3.toUnion()));
        assert(i3.toUnion().covers(Union.from([i1, i2])));
        assert(i3.toUnion().covers(Union.from([i2, i1])));
        assert(i3.toUnion().covers(Union.from([i2, i1, i1])));
        assert(Union.from([i1, i2]).covers(i3));
        assert(Union.from([i1, i2]).covers(Union.from([i1, i2])));
        assert(Union.from([i1, i2]).covers(Union.from([i1, i2, i1])));
        assert(Union.from([i1, i2]).covers(Union.from([i2, i2, i1])));
        assert(!p1.toUnion().covers(p2));
        assert(!p1.toUnion().covers(p2.toUnion()));
    });

    it("intersects", function () {
        assert(i3.toUnion().intersects(i1));
        assert(i3.toUnion().intersects(i2));
        assert(i3.toUnion().intersects(i3));
        assert(i3.toUnion().intersects(i1.toUnion()));
        assert(i3.toUnion().intersects(i2.toUnion()));
        assert(i3.toUnion().intersects(i3.toUnion()));
        assert(i3.toUnion().intersects(Union.from([i1, i2])));
        assert(i3.toUnion().intersects(Union.from([i2, i1])));
        assert(i3.toUnion().intersects(Union.from([i2, i1, i1])));
        assert(Union.from([i1, i2]).intersects(i3));
        assert(Union.from([i1, i2]).intersects(Union.from([i1, i2])));
        assert(Union.from([i1, i2]).intersects(Union.from([i1, i2, i1])));
        assert(Union.from([i1, i2]).intersects(Union.from([i2, i2, i1])));
        assert(!p1.toUnion().intersects(p2));
        assert(!p1.toUnion().intersects(p2.toUnion()));
    });

    it("intersects with empty", function () {
        assert(!pe.toUnion().intersects(pe));
        assert(!pe.toUnion().intersects(pe.toUnion()));
        assert(!pe.toUnion().intersects(p1));
        assert(!pe.toUnion().intersects(p2));
        assert(!pe.toUnion().intersects(p1.toUnion()));
        assert(!pe.toUnion().intersects(p2.toUnion()));
        assert(!pe.toUnion().intersects(Union.from([p1, p2])));
        assert(!Union.from([pe, pe, pe]).intersects(Union.from([p1, p2])));
    });

    it("contains", function () {
        assert(i3.toUnion().contains([-3]));
        assert(i3.toUnion().contains([-1]));
        assert(i3.toUnion().contains([0]));
        assert(i3.toUnion().contains([3]));
        assert(!i3.toUnion().contains([3.0001]));
        assert(!i3.toUnion().contains([4]));
        assert(Union.from([i1, i2]).toUnion().contains([-3]));
        assert(Union.from([i1, i2]).toUnion().contains([-1]));
        assert(Union.from([i1, i2]).toUnion().contains([0]));
        assert(Union.from([i1, i2]).toUnion().contains([3]));
        assert(Union.from([i1, i2, ie, i2]).toUnion().contains([0]));
        assert(!pe.toUnion().contains([0, 0]));
    });

    it("fulfils", function () {
        // TODO
    });

    it("sample", function () {
        const u = Union.from([p1, p2]);
        for (let i = 0; i < 1000; i++) {
            assert(u.contains(u.sample()));
        }
    });

    it("translate", function () {
        assert(Union.from([i1, i2]).translate([2.3]).isSameAs(i3.translate([2.3])));
    });

    it("invert", function () {
        assert(Union.from([i1, i2]).invert().isSameAs(i3.invert()));
    });

    it("apply", function () {
        assert(Union.from([i1, i2]).apply([[2.3]]).isSameAs(i3.apply([[2.3]])));
        assert(Union.from([i1, i2]).apply([[2.3], [-1]]).isSameAs(i3.apply([[2.3], [-1]])));
    });

    it("applyRight", function () {
        assert(Union.from([i1, i2]).applyRight([[2.3]]).isSameAs(i3.applyRight([[2.3]])));
    });

    it("minkowski with one element yields same as polytope method", function () {
        const mink = Union.from([p1]).minkowski(p1);
        assert(!mink.isEmpty);
        assert.equal(mink.polytopes.length, 1);
        assert(mink.isSameAs(p1.minkowski(p1)));
    });

    it("pontryagin with one element yields same as polytope method", function () {
        const p3 = geometry.Polygon.hull([[0, 0], [0.1, 0.1], [0, 0.1], [0.1, 0]]);
        let pont = Union.from([p1]).pontryagin(p3);
        assert(!pont.isEmpty);
        assert.equal(pont.polytopes.length, 1);
        assert(pont.isSameAs(p1.pontryagin(p3)));
    });

    it("intersect", function () {
        // TODO
    });

    it("remove", function () {
        // TODO
    });

    it("union", function () {
        // TODO
    });

    it("hull", function () {
        // TODO
    });

    it("disjunctify", function() {
        // TODO
    });

    it("simplify merges a union of intervals", function () {
        let i = geometry.Interval.hull([[0], [1]]);
        let ref = geometry.Interval.hull([[-1], [2]]);
        let s1 = Union.from([i, i.translate([1]), i.translate([-1])]).simplify();
        let s2 = Union.from([i.translate([1]), i, i.translate([-1])]).simplify();
        let s3 = Union.from([i.translate([1]), i.translate([-1]), i]).simplify();
        assert.equal(s1.polytopes.length, 1);
        assert.equal(s2.polytopes.length, 1);
        assert.equal(s3.polytopes.length, 1);
        assert(s1.isSameAs(ref));
        assert(s2.isSameAs(ref));
        assert(s3.isSameAs(ref));
    });

    it("toUnion", function() {
        // TODO
    });


});

