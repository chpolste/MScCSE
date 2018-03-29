// @flow

let assert = require("assert");
let geometry = require("../../src/js/geometry.js");
let linalg = require("../../src/js/linalg.js");



describe("geometry.HalfspaceIneqation.parse", function () {

    let parse = geometry.HalfspaceInequation.parse;

    it("accepts 2D halfspace in various formats", function () {
        let hs = geometry.HalfspaceInequation.normalized([1, 2], 1);
        assert(hs.isSameAs(parse("x + 2y < 1", "xy")));
        assert(hs.isSameAs(parse("x + 2y <= 1", "xy")));
        assert(hs.isSameAs(parse("1 > x + 2y", "xy")));
        assert(hs.isSameAs(parse("2y < 1 - x", "xy")));
        assert(hs.isSameAs(parse("2a < 1 - b", "ba")));
        assert(hs.isSameAs(parse("0 < 1 - x - y -1y", "xy")));
        assert(hs.isSameAs(parse("- 1 + 1.0x+ 2y < 0", "xy")));
    });

    it("rejects invalid input", function () {
        assert.throws(() => parse("", "y"));
        assert.throws(() => parse("2 < 5", ""));
        assert.throws(() => parse("23 < 2", "xy"));
        assert.throws(() => parse("x < x", "x"));
        assert.throws(() => parse("12 x -- y < 3", "xy"));
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


describe("geometry.HalfspaceInequation in 1 dimension", function () {
    
    let hs = new geometry.HalfspaceInequation([1], 0.5);

    it("normalized", function () {
        let hsn = geometry.HalfspaceInequation.normalized([2], 1);
        assert.equal(hsn.dim, hs.dim);
        assert.equal(hsn.offset, hs.offset);
        assert.deepEqual(hsn.normal, hs.normal);
        assert.equal(linalg.norm2(hsn.normal), 1);
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
        let halfspaces = [new geometry.HalfspaceInequation([-1], 1),
                          new geometry.HalfspaceInequation([-1], 1 + geometry.TOL/2),
                          new geometry.HalfspaceInequation([-1], 4),
                          new geometry.HalfspaceInequation([1], 1)];
        assert(poly.isSameAs(geometry.Interval.noredund(halfspaces)));
    });

    it("noredund yields empty for unbounded", function () {
        let halfspaces = [new geometry.HalfspaceInequation([-1], 1)];
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

    it("dilate", function () {
        let mink = geometry.Interval.hull([[2], [-2]]);
        assert(poly.dilate(poly).isSameAs(mink));
    });

    it("erode", function () {
        // TODO
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
        let halfspace = new geometry.HalfspaceInequation([-1], 0.5);
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
        let split = poly.split(new geometry.HalfspaceInequation([1], 0));
        assert(split.length == 2);
        assert(split[0].isSameAs(poly2) || split[1].isSameAs(poly2));
        assert(split[0].isSameAs(poly3) || split[1].isSameAs(poly3));
        assert(!split[0].isSameAs(split[1]));
    });

    it("split twice", function () {
        assert.equal(poly.split(new geometry.HalfspaceInequation([1], 0.4),
                                new geometry.HalfspaceInequation([-1], 0.5)).length, 3);
    });

});


describe("geometry.Polygon with square", function () {

    const poly = new geometry.Polygon([[0, 0], [1, 0], [1, 1], [0, 1]], null);

    it("dim", function () {
        assert.equal(poly.dim, 2);
    });

    it("isSameAs", function () {
        assert(poly.isSameAs(new geometry.Polygon([[0, 0], [1, 0], [1, 1], [0, 1]], null)));
        assert(poly.isSameAs(new geometry.Polygon([[1, 0], [1, 1], [0, 1], [0, 0]], null)));
        assert(poly.isSameAs(new geometry.Polygon([[0, 0], [1, 0], [1, 1], [0, 1]], null)));
        assert(poly.isSameAs(new geometry.Polygon([[0, 1], [0, 0], [1, 0], [1, 1]], null)));
        assert(!poly.isSameAs(new geometry.Polygon([[0, 1], [0, 0], [1, 0]], null)));
        assert(!poly.isSameAs(new geometry.Polygon([[1, 0], [1, 1], [0, 1], [0.1, 0]], null)));
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

    it("dilate", function () {
        let mink = geometry.Polygon.hull([[0, 0], [2, 2], [2, 0], [0, 2]]);
        assert(poly.dilate(poly).isSameAs(mink));
    });

    it("erode", function () {
        // TODO
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
        let split = poly.split(new geometry.HalfspaceInequation([1, 0], 0.5));
        assert(split.length == 2);
        assert(split[0].isSameAs(poly2) || split[1].isSameAs(poly2));
        assert(split[0].isSameAs(poly3) || split[1].isSameAs(poly3));
        assert(!split[0].isSameAs(split[1]));
    });

    it("split with two (almost) verticals", function () {
        let split = poly.split(new geometry.HalfspaceInequation([1, -0.1], 0.5),
                               new geometry.HalfspaceInequation([1, 0.1], 0.9));
        assert(split.length == 3);
    });

    it("split with vertical and horizontal", function () {
        assert.equal(poly.split(new geometry.HalfspaceInequation([0.1, 1], 0.4),
                                new geometry.HalfspaceInequation([1, 0], 0.5)).length, 4);
    });

});


describe("geometry problem cases", function () {

    it("Polygon remove inner with angle < 0 edge case", function () {
        let inner = geometry.Polygon.hull([[-1, -1], [1, -1], [5, 1], [-1, 4]]);
        let poly1 = geometry.Polygon.hull([[-1, -1], [1, -1], [1, 1], [-1, 0.3], [0, 1.6]]);
        let poly2 = geometry.Polygon.hull([[-1, 1], [1, -1], [1, 1], [0, 0]]);
        let outer = inner.dilate(poly1).dilate(poly2);
        assert(!inner.intersect(outer).isEmpty);
        assert(!outer.intersect(inner).isEmpty);
        let diff = outer.remove(inner);
        assert(diff.length > 0);
    });

});


describe("geometry.union", function () {

    let poly1 = geometry.Polygon.hull([[0, 0], [1, 0], [0, 1]]);
    let poly2 = geometry.Polygon.hull([[2, 0], [2, 1], [1, 0], [0, 1]]);
    let interval = geometry.Interval.hull([[0], [1], [-3]]);

    it("extent", function () {
        assert.deepEqual(geometry.union.extent([poly1]), [[0, 1], [0, 1]]);
        assert.deepEqual(geometry.union.extent([poly2]), [[0, 2], [0, 1]]);
        assert.deepEqual(geometry.union.extent([poly1, poly2]), [[0, 2], [0, 1]]);
        assert.deepEqual(geometry.union.extent([poly2, poly1]), [[0, 2], [0, 1]]);
    });

    it("boundingBox", function () {
        let bbox = geometry.Polygon.hull([[0, 0], [2, 0], [0, 1], [2, 1]]);
        assert(geometry.union.boundingBox([poly1, poly2]).isSameAs(bbox));
        assert(geometry.union.boundingBox([poly2, poly1]).isSameAs(bbox));
        assert.throws(() => geometry.union.boundingBox([poly1, interval]));
    });

});

