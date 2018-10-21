// @flow

let assert = require("assert");
let geometry = require("../../src/js/geometry.js");
let linalg = require("../../src/js/linalg.js");



describe("geometry.HalfspaceIneqation.parse", function () {

    let parse = geometry.HalfspaceInequality.parse;

    it("accepts 2D halfspace in various formats", function () {
        let hs = geometry.HalfspaceInequality.normalized([1, 2], 1);
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


describe("geometry.HalfspaceInequality in 1 dimension", function () {
    
    let hs = new geometry.HalfspaceInequality([1], 0.5);

    it("normalized", function () {
        let hsn = geometry.HalfspaceInequality.normalized([2], 1);
        assert.equal(hsn.dim, hs.dim);
        assert.equal(hsn.offset, hs.offset);
        assert.deepEqual(hsn.normal, hs.normal);
        assert.equal(linalg.norm2(hsn.normal), 1);
    });

    it("normalized breaks offset === 0 ties in favor of trivial", function () {
        let h = geometry.HalfspaceInequality.normalized([0], 0);
        assert(h.isTrivial);
    });

    it("isInfeasible", function () {
        let h = geometry.HalfspaceInequality.normalized([0], -3);
        assert(h.isInfeasible);
        assert(!hs.isInfeasible);
    });

    it("isTrivial", function () {
        let h = geometry.HalfspaceInequality.normalized([0], 3);
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
        let halfspaces = [new geometry.HalfspaceInequality([-1], 1),
                          new geometry.HalfspaceInequality([-1], 1 + geometry.TOL/2),
                          new geometry.HalfspaceInequality([-1], 4),
                          new geometry.HalfspaceInequality([1], 1)];
        assert(poly.isSameAs(geometry.Interval.noredund(halfspaces)));
    });

    it("noredund yields empty for unbounded", function () {
        let halfspaces = [new geometry.HalfspaceInequality([-1], 1)];
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

    it("intersect with flipped halfspaces yields empty", function () {
        for (let halfspace of poly.halfspaces) {
            assert(poly.intersect(halfspace.flip()).isEmpty);
        }
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

    it("intersect with halfspace", function () {
        let halfspace = new geometry.HalfspaceInequality([-1], 0.5);
        let poly2 = geometry.Interval.hull([[-0.5], [1]]);
        assert(poly.intersect(halfspace).isSameAs(poly2));
        let poly3 = geometry.Interval.hull([[-0.5], [-1]]);
        assert(poly.intersect(halfspace.flip()).isSameAs(poly3));
    });

    it("remove self yields empty", function () {
        let diff = poly.remove(poly);
        assert(diff.length == 0, diff.length + " polys returned instead of 0.");
    });

    it("remove with overlap", function () {
        let poly2 = poly.translate([1.8]);
        let poly3 = poly.translate([-1.7]);
        let diff0 = geometry.Interval.hull([[-0.7], [0.8]]);
        let diff = poly.remove(poly2, poly3);
        assert(diff.length == 1, diff.length + " polys returned instead of 1.");
        assert(diff0.isSameAs(diff[0]));
        assert(diff[0].isSameAs(diff0));
    });

    it("remove without intersection", function () {
        let poly2 = geometry.Interval.hull([[5], [10]]);
        let diff = poly.remove(poly2);
        assert(diff.length == 1, diff.length + " polys returned instead of 1.");
        assert(diff[0].isSameAs(poly));
        assert(poly.isSameAs(diff[0]));
        diff = poly2.remove(poly);
        assert(diff.length == 1, diff.length + " polys returned instead of 1.");
        assert(diff[0].isSameAs(poly2));
        assert(poly2.isSameAs(diff[0]));
    });

    it("remove middle", function () {
        let poly2 = geometry.Interval.hull([[-0.5], [0.5]]);
        let diff = poly.remove(poly2);
        assert(diff.length >= 2, diff.length + " polys returned instead of 2.");
    });

    it("split once", function () {
        let poly2 = geometry.Interval.hull([[0], [1]]);
        let poly3 = geometry.Interval.hull([[0], [-1]]);
        let split = poly.split(new geometry.HalfspaceInequality([1], 0));
        assert(split.length == 2);
        assert(split[0].isSameAs(poly2) || split[1].isSameAs(poly2));
        assert(split[0].isSameAs(poly3) || split[1].isSameAs(poly3));
        assert(!split[0].isSameAs(split[1]));
    });

    it("split twice", function () {
        assert.equal(poly.split(new geometry.HalfspaceInequality([1], 0.4),
                                new geometry.HalfspaceInequality([-1], 0.5)).length, 3);
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

    it("intersect with flipped halfplanes yields empty", function () {
        for (let halfplane of poly.halfspaces) {
            assert(poly.intersect(halfplane.flip()).isEmpty);
        }
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
        assert(diff.length == 0, diff.length + " polys returned instead of 0.");
    });

    it("remove with tall extension", function () {
        let poly2 = geometry.Polygon.hull([[0, 0], [1, 0], [1, 2], [0, 2]]);
        let diff0 = geometry.Polygon.hull([[0, 1], [1, 1], [1, 2], [0, 2]]);
        let diff = poly2.remove(poly);
        assert(diff.length == 1, diff.length + " polys returned instead of 1.");
        assert(diff0.isSameAs(diff[0]));
        assert(diff[0].isSameAs(diff0));
    });

    it("remove with wide extension", function () {
        let poly2 = geometry.Polygon.hull([[0, 0], [2, 0], [2, 1], [0, 1]]);
        let diff0 = geometry.Polygon.hull([[1, 0], [2, 0], [2, 1], [1, 1]]);
        let diff = poly2.remove(poly);
        assert(diff.length == 1, diff.length + " polys returned instead of 1.");
        assert(diff0.isSameAs(diff[0]));
        assert(diff[0].isSameAs(diff0));
    });

    it("remove with overlap", function () {
        let poly2 = poly.translate([0.8, 0]);
        let poly3 = poly.translate([0, 0.8]);
        let diff0 = geometry.Polygon.hull([[0, 0], [0.8, 0], [0.8, 0.8], [0, 0.8]]);
        let diff = poly.remove(poly2, poly3);
        assert(diff.length == 1, diff.length + " polys returned instead of 1.");
        assert(diff0.isSameAs(diff[0]));
        assert(diff[0].isSameAs(diff0));
    });

    it("remove without intersection", function () {
        let poly2 = geometry.Polygon.hull([[1, 1], [2, 1], [1, 2]]);
        let diff = poly.remove(poly2);
        assert(diff.length == 1, diff.length + " polys returned instead of 1.");
        assert(diff[0].isSameAs(poly));
        assert(poly.isSameAs(diff[0]));
        diff = poly2.remove(poly);
        assert(diff.length == 1, diff.length + " polys returned instead of 1.");
        assert(diff[0].isSameAs(poly2));
        assert(poly2.isSameAs(diff[0]));
    });

    it("remove middle", function () {
        let poly2 = geometry.Polygon.hull([[0.2, -1], [0.6, 0], [0.5, 3]]);
        let diff = poly.remove(poly2);
        assert(diff.length >= 2, diff.length + " polys returned instead of 2.");
    });

    it("split with vertical", function () {
        let poly2 = geometry.Polygon.hull([[0, 0], [0.5, 0], [0.5, 1], [0, 1]]);
        let poly3 = geometry.Polygon.hull([[0.5, 0], [1, 0], [1, 1], [0.5, 1]]);
        let split = poly.split(new geometry.HalfspaceInequality([1, 0], 0.5));
        assert(split.length == 2);
        assert(split[0].isSameAs(poly2) || split[1].isSameAs(poly2));
        assert(split[0].isSameAs(poly3) || split[1].isSameAs(poly3));
        assert(!split[0].isSameAs(split[1]));
    });

    it("split with two (almost) verticals", function () {
        let split = poly.split(new geometry.HalfspaceInequality([1, -0.1], 0.5),
                               new geometry.HalfspaceInequality([1, 0.1], 0.9));
        assert(split.length == 3);
    });

    it("split with vertical and horizontal", function () {
        assert.equal(poly.split(new geometry.HalfspaceInequality([0.1, 1], 0.4),
                                new geometry.HalfspaceInequality([1, 0], 0.5)).length, 4);
    });

});


describe("geometry problem cases", function () {

    const union = geometry.union;

    it("Polygon remove inner with angle < 0 edge case", function () {
        let inner = geometry.Polygon.hull([[-1, -1], [1, -1], [5, 1], [-1, 4]]);
        let poly1 = geometry.Polygon.hull([[-1, -1], [1, -1], [1, 1], [-1, 0.3], [0, 1.6]]);
        let poly2 = geometry.Polygon.hull([[-1, 1], [1, -1], [1, 1], [0, 0]]);
        let outer = inner.minkowski(poly1).minkowski(poly2);
        assert(!inner.intersect(outer).isEmpty);
        assert(!outer.intersect(inner).isEmpty);
        let diff = outer.remove(inner);
        assert(diff.length > 0);
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
        const supports = [
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
        ].map(vs => geometry.Polygon.hull(vs));
        // Union of supports is state
        const diff = state.remove(...supports);
        assert(union.isEmpty(diff));
        assert(union.isSameAs(union.simplify(supports), [state]));
        // This was the precise predecessor
        const prer = [
            [[-1, 1], [-1, 0.5], [-0.5, 0.5], [-0.5, 0.7000000000000001], [-0.8, 1]] ,
            [[-0.8, 1], [-0.6000000000000002, 0.8000000000000003], [-0.5, 0.8000000000000002], [-0.5, 1]] ,
            [[-0.6000000000000002, 0.8000000000000003], [-0.5, 0.7000000000000001], [-0.5, 0.8000000000000002]]
        ].map(vs => geometry.Polygon.hull(vs));
        // ... which also should be the same as the state
        assert(union.isEmpty(state.remove(...prer)));
        assert(union.isSameAs([state], prer));
        // Now reproduce the calculation of supports: intersect each support
        // polytope with the PreR. Since PreR = state = support union, this
        // should be a geometric identity operation. This failed for the last
        // polytope due to a bug in Polygon.hull which is used by simplify.
        for (let poly of supports) {
            const inter1 = union.intersect(prer, [poly]);
            const inter2 = union.intersect([poly], prer);
            assert(union.isSameAs([poly], inter1));
            assert(union.isSameAs([poly], inter2));
            assert(union.isSameAs(inter1, union.simplify(inter1)));
            assert(union.isSameAs(inter2, union.simplify(inter2)));
            assert(union.isSameAs([poly], union.simplify(inter1)));
            assert(union.isSameAs([poly], union.simplify(inter2)));
        }
    });

    it("Intersection with halfspace order float instability", function () {
        const innerHs1 = [
             new geometry.HalfspaceInequality([ -0.5547001962252289, -0.8320502943378439 ], -3.5223462460302057),
             new geometry.HalfspaceInequality([ 0.7071067811865472, 0.7071067811865479 ], 3.818376618407357),
             new geometry.HalfspaceInequality([ 0, 1 ], 3)
        ];
        const innerHs2 = [
            new geometry.HalfspaceInequality([ -0.554700196225229, -0.8320502943378436 ], -3.5223462460302053),
            new geometry.HalfspaceInequality([ 0.7071067811865475, 0.7071067811865475 ], 3.8183766184073566),
            new geometry.HalfspaceInequality([ 0, 1 ], 3)
        ];
        assert.equal(innerHs1.length, innerHs2.length);
        for (let i = 0; i < innerHs1.length; i++) {
            assert(innerHs1[i].isSameAs(innerHs2[i]));
            assert(innerHs2[i].isSameAs(innerHs1[i]));
        }

        const outerHs1 = [
            new geometry.HalfspaceInequality([ -0.7071067811865476, -0.7071067811865476 ], -3.2880465325174475),
            new geometry.HalfspaceInequality([ -0.55470019622523, -0.8320502943378432 ], -2.2188007849009224),
            new geometry.HalfspaceInequality([ 0, -1 ], 1.7000000000000017),
            new geometry.HalfspaceInequality([ 1, -2.4671622769448e-16 ], 6.749999999999998),
            new geometry.HalfspaceInequality([ 0.7071067811865498, 0.7071067811865451 ], 6.116473657263642),
            new geometry.HalfspaceInequality([ 0.554700196225228, 0.8320502943378444 ], 5.436061923007241),
            new geometry.HalfspaceInequality([ 0, 1 ], 3.5999999999999974)
        ];
        const outerHs2 = [
            new geometry.HalfspaceInequality([ -0.7071067811865475, -0.7071067811865475 ], -3.288046532517447),
            new geometry.HalfspaceInequality([ -0.5547001962252296, -0.8320502943378435 ], -2.2188007849009197),
            new geometry.HalfspaceInequality([ 0, -1 ], 1.6999999999999977),
            new geometry.HalfspaceInequality([ 1, -1.5700924586837752e-16 ], 6.749999999999998),
            new geometry.HalfspaceInequality([ 0.7071067811865475, 0.7071067811865475 ], 6.1164736572636285),
            new geometry.HalfspaceInequality([ 0.5547001962252285, 0.8320502943378442 ], 5.436061923007242),
            new geometry.HalfspaceInequality([ 0, 1 ], 3.599999999999997)
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

});


describe("geometry.union", function () {

    const union = geometry.union;

    let poly1 = geometry.Polygon.hull([[0, 0], [1, 0], [0, 1]]);
    let poly2 = geometry.Polygon.hull([[2, 0], [2, 1], [1, 0], [0, 1]]);
    let interval = geometry.Interval.hull([[0], [1], [-3]]);

    it("isEmpty", function () {
        let empty = geometry.Polygon.empty();
        assert(union.isEmpty([]));
        assert(union.isEmpty([empty]));
        assert(union.isEmpty([empty, empty, empty]));
        assert(!union.isEmpty([poly1]));
        assert(!union.isEmpty([empty, empty, poly1, empty]));
    });

    it("extent", function () {
        assert.deepEqual(union.extent([poly1]), [[0, 1], [0, 1]]);
        assert.deepEqual(union.extent([poly2]), [[0, 2], [0, 1]]);
        assert.deepEqual(union.extent([poly1, poly2]), [[0, 2], [0, 1]]);
        assert.deepEqual(union.extent([poly2, poly1]), [[0, 2], [0, 1]]);
    });

    it("boundingBox", function () {
        let bbox = geometry.Polygon.hull([[0, 0], [2, 0], [0, 1], [2, 1]]);
        assert(union.boundingBox([poly1, poly2]).isSameAs(bbox));
        assert(union.boundingBox([poly2, poly1]).isSameAs(bbox));
        assert.throws(() => union.boundingBox([poly1, interval]));
    });

    it("minkowski with one element yields same as polytope method", function () {
        let mink = union.minkowski([poly1], poly1);
        assert.equal(mink.length, 1);
        assert(mink[0].isSameAs(poly1.minkowski(poly1)));
    });

    it("pontryagin with one element yields same as polytope method", function () {
        let poly3 = geometry.Polygon.hull([[0, 0], [0.1, 0.1], [0, 0.1], [0.1, 0]]);
        let pont = union.pontryagin([poly1], poly3);
        assert.equal(pont.length, 1);
        assert(pont[0].isSameAs(poly1.pontryagin(poly3)));
    });

    it("simplify merges a union of intervals", function () {
        let i = geometry.Interval.hull([[0], [1]]);
        let ref = geometry.Interval.hull([[-1], [2]]);
        let s1 = union.simplify([i, i.translate([1]), i.translate([-1])]);
        let s2 = union.simplify([i.translate([1]), i, i.translate([-1])]);
        let s3 = union.simplify([i.translate([1]), i.translate([-1]), i]);
        assert.equal(s1.length, 1);
        assert.equal(s2.length, 1);
        assert.equal(s3.length, 1);
        assert(s1[0].isSameAs(ref));
        assert(s2[0].isSameAs(ref));
        assert(s3[0].isSameAs(ref));
    });

});

