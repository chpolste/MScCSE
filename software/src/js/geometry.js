// @flow
"use strict";

/* Convex polytopic geometry in 1 and 2 dimensions.

References:
- Baotić, M. (2009). Polytopic Computations in Constrained Optimal Control.
  Automatika, Journal for Control, Measurement, Electronics, Computing and
  Communications, 50, 119–134.
- Kundu, S. (1987). A new O(n·log n) algorithm for computing the intersection
  of convex polygons. Pattern Recognition, 20(4), 419–424.

*/

import type { Vector, Matrix } from "./linalg.js";
import type { ASTNode } from "./parser.js";

import * as linalg from "./linalg.js";
import { arr, iter, NotImplementedError, ValueError } from "./tools.js";
import { ASTParser, ParseError } from "./parser.js";


// Reuse float-comparison tolerance from linalg
export const TOL = linalg.TOL;

// Cartesian product (no guaranteed ordering), e.g.
//     cartesian([0, 1], [2, 3], [4, 5]) = [[0, 2, 4], [0, 2, 5], [0, 3, 4], ...]
// Will not work correctly if T is a list (flattens as an intermediate step).
function cartesian<T>(...tuples: [T, T][]): T[][] {
    let cart = [[]];
    for (let tuple of tuples) {
        cart = [].concat(...cart.map(xs => tuple.map(y => xs.concat([y]))));
    }
    return cart;
}


/* 2D helpers */

// Canonical ordering in 2D:
// Vertices: ascending x then descending y
// Halfspaces: counterclockwise by angle wrt normal [-1, 0] with angleCCW
//             behaviour as tiebreaker
// /!\ This is carefully tuned so that canonical sets of halfspaces can be
//     combined into a canonical set with a single merge operation.

// Halfspace comparator for use with sort()
function halfspaceOrdering2D(g: Halfspace, h: Halfspace): number {
    const gOrder = angleOrder(g.normal);
    const hOrder = angleOrder(h.normal);
    return gOrder == hOrder ? angleCCW(g.normal, h.normal) - Math.PI : gOrder - hOrder;
}

// CCW angle wrt to [-1, 0]. Only used for sorting, so no remapping to [0, 2π)
// required like for angleCCW
function angleOrder(v) {
    const angle = Math.atan2(v[1], v[0]);
    return angle === Math.PI ? angle - 2 * Math.PI : angle;
}

// Counterclockwise angle between two vectors, mapped to the interval [0, 2π).
// https://stackoverflow.com/questions/14066933/
function angleCCW(g, h) {
    const det = g[0] * h[1] - g[1] * h[0];
    const dot = g[0] * h[0] + g[1] * h[1];
    let angle = Math.atan2(det, dot);
    if (angle < 0) {
        angle = angle + 2 * Math.PI;
    }
    // Because of float arithmetic, (angle + 2 * Math.PI) for angle < 0 can
    // still be 2 * Math.PI if angle is very small
    return angle === 2 * Math.PI ? 0 : angle;
}

// Vertex comparator for use with sort()
function vertexOrdering2D(p: Vector, q: Vector): number {
    return p[0] == q[0] ? q[1] - p[1] : p[0] - q[0];
}

// Is the turn described by the points p, q, r counterclockwise? The zero
// parameter can be set to 0 for a strict test or TOL for an "almost test"
// (sorts out close points and almost straight segments).
function isCCWTurn(p: Vector, q: Vector, r: Vector, zero: number): boolean {
    return (p[0] - r[0]) * (q[1] - r[1]) - (p[1] - r[1]) * (q[0] - r[0]) > zero;
}

// The pop-part of the convex hull algorithm in 2D. Mutates the input.
// Extracted because pattern is used 5 times in Polygon.hull.
function reduceHullPart(hull: Vector[], p: Vector, zero: number) {
    while (hull.length > 1 && !isCCWTurn(hull[hull.length - 2], hull[hull.length - 1], p, zero)) {
        hull.pop();
    }
}

// Intersection point of the edges of two halfspaces. Returns null if edges are
// parallel and therefore do not intersect. Float-tolerant.
function halfplaneIntersection(g: Halfspace, h: Halfspace): ?Vector {
    const [g0, g1] = g.normal;
    const [h0, h1] = h.normal;
    const det = g0 * h1 - g1 * h0;
    if (Math.abs(det) < TOL) {
        return null;
    } else {
        return [(h1 * g.offset - g1 * h.offset) / det, (g0 * h.offset - h0 * g.offset) / det];
    }
}


/* Parser helpers

Halfspace contains a parser of textual inequality representation, which
requires some helpers.
*/

const hsieParse = ASTParser(/\+|-|([0-9\.]+\s*\*?\s*[a-z]?)|[0-9\.]+|[a-z]/, [
    { op: "+", precedence: 20, associativity: -1 },
    { op: "-", precedence: 20, associativity: -1 },
    { op: "+", precedence: 50, associativity:  0 },
    { op: "-", precedence: 50, associativity:  0 }
]);

function hsieSplit(text: string): [ASTNode, string, ASTNode] {
    // Capture group in splitting regex preserves comparison operator
    const parts = text.split(/\s*([<>]=?)\s*/);
    if (parts.length != 3) throw new ParseError(
        "not a valid inequality (requires exactly one of <=, <, >, >=)"
    );
    // No distinction between < and <= and > and >=
    return [hsieParse(parts[0]), parts[1][0], hsieParse(parts[2])];
}

const hsieNumVarPattern = /^((?:\d+(?:\.\d+)?)|(?:\.\d+))?\s*\*?\s*([a-z])?$/;
// Transform AST into flattened list of terms by recursive descent.
function hsieTerms(node: ASTNode, flip: boolean): { "coefficient": number, "variable": string }[] {
    if (typeof node === "string") {
        const match = node.match(hsieNumVarPattern);
        if (match == null) throw new ParseError("unrecognized term " + node);
        return [{
            coefficient: (flip ? -1 : 1) * (match[1] == null ? 1 : parseFloat(match[1])),
            variable: match[2] == null ? "" : match[2]
        }];
    } else if (node.op === "-" || node.op === "+") {
        const isMinus = node.op === "-";
        const isUnary = node.args.length === 1;
        // Flip sign of first term only for unary minus
        const out = hsieTerms(node.args[0], isUnary && isMinus ? !flip : flip);
        // Add terms of second argument for binary operators
        if (!isUnary) out.push(...hsieTerms(node.args[1], isMinus ? !flip : flip));
        return out;
    } else {
        throw new ParseError("unexpected operator " + node.op);
    }
}


/* Halfspaces */

export type JSONHalfspace = { normal: number[], offset: number };
// A halfspace represented by the inequality: normal · x <= offset. Due to the
// limitations of floating point arithmetic and using TOL for comparisons, no
// distinction between < and <= is made.
export class Halfspace {

    +dim: number;
    +normal: Vector; // length 1
    +offset: number;

    // No further processing of input arguments. Use static methods to
    // construct a Halfspace from a textual or non-normalized representation.
    constructor(normal: Vector, offset: number): void {
        this.normal = normal;
        this.offset = offset;
        this.dim = normal.length;
    }

    static normalized(normal: Vector, offset: number): Halfspace {
        let norm = linalg.norm2(normal);
        if (norm < TOL) {
            // Trivial/Infeasible inequalities. Break ties (offset === 0) by
            // assuming inequality is always fulfilled (in the spirit of <=).
            // These special cases must be considered to enable changes of
            // dimensionality with applyRight. E.g. if [[1, 2]] is applied from
            // the right to the normal vector parallel to [[2], [-1]], the
            // result is either the entire lower dimension (if offset >= 0) or
            // empty (if offset < 0).
            offset = offset === 0 ? Infinity : Math.sign(offset) * Infinity
            norm = 1;
        }
        return new Halfspace(normal.map(x => x / norm), offset / norm);
    }

    // Parse expressions such as "x + 4y < 3".
    static parse(text: string, variables: string): Halfspace {
        const [lhs, comp, rhs] = hsieSplit(text);
        const terms = hsieTerms(lhs, comp === ">").concat(hsieTerms(rhs, comp === "<"));
        let offset = 0;
        let normal = new Array(variables.length);
        normal.fill(0);
        for (let term of terms) {
            if (term.variable === "") {
                offset -= term.coefficient;
            } else {
                const idx = variables.indexOf(term.variable);
                if (idx < 0) throw new ParseError("unexpected variable '" + term.variable + "'");
                normal[idx] += term.coefficient;
            }
        }
        return Halfspace.normalized(normal, offset);
    }

    static deserialize(json: JSONHalfspace): Halfspace {
        return new Halfspace(json.normal, json.offset);
    }

    // Empty "halfspace"
    get isInfeasible(): boolean {
        return this.offset === -Infinity;
    }

    // "Halfspace" is really the entire space it is embedded in
    get isTrivial(): boolean {
        return this.offset === Infinity;
    }

    flip(): Halfspace {
        return new Halfspace(this.normal.map(x => -x), -this.offset);
    }

    contains(point: Vector): boolean {
        linalg.assertEqualDims(this.dim, point.length);
        return linalg.dot(this.normal, point) - this.offset < TOL;
    }

    isSameAs(other: Halfspace): boolean {
        return linalg.areClose(this.normal, other.normal) && Math.abs(this.offset - other.offset) < TOL;
    }

    // Move Halfspace by the given vector
    translate(v: Vector): Halfspace {
        // Project vector onto normal than modify offset by the projection's
        // length.
        return Halfspace.normalized(this.normal, this.offset + linalg.dot(this.normal, v));
    }

    // Apply a matrix from the right to the normal vector. This may change the
    // dimensionality of the halfspace.
    applyRight(m: Matrix): Halfspace {
        return Halfspace.normalized(linalg.applyRight(m, this.normal), this.offset);
    }

    // JSON-compatible serialization and deserialization
    serialize(): JSONHalfspace {
        return { normal: this.normal, offset: this.offset };
    }

}



/* Convex Polytopes */

// Polytopic region
export type Region = Polytope | Union;

// JSON serializations
export type JSONPolytope = { dim: number, vertices: number[][] };

// Dimension-independent implementations
export class Polytope {

    +dim: number;
    // Lazyly evaluated properties
    _vertices: ?Vector[];
    _halfspaces: ?Halfspace[];
    _isEmpty: ?boolean;

    // Specification by either halfspaces or vertices is sufficient, the other
    // representation is computed (and cached) automatically by the getters.
    constructor(vertices: ?Vector[], halfspaces: ?Halfspace[]): void {
        if (this.constructor.name === "Polytope") {
            throw new TypeError("must not instanciate Polytope");
        }
        this._vertices = vertices;
        this._halfspaces = halfspaces;
        this._isEmpty = null;
    }

    // Get the subclass for a specific dimension of polytope
    static ofDim(dim: number): Class<Polytope> {
        if (dim === 1) return Interval;
        if (dim === 2) return Polygon;
        throw new NotImplementedError();
    }

    // Convex hull of a set of points
    static hull(ps: Vector[]): Polytope { throw new NotImplementedError(); }
    // intersection takes an array of halfspaces and returns the polytope that
    // is bounded by these (returns empty if polytope is unbounded)
    static intersection(hs: Halfspace[]): Polytope { throw new NotImplementedError(); }
    // Like intersection but noredund expects halfspaces to already be in
    // canonical order and without infeasible/trivial ones
    static noredund(hs: Halfspace[]): Polytope { throw new NotImplementedError(); }
    // Empty polytope
    static empty(): Polytope { throw new NotImplementedError(); }

    // JSON serialization
    static deserialize(json: JSONPolytope): Polytope {
        if (json.dim === 1) return new Interval(json.vertices, null);
        if (json.dim === 2) return new Polygon(json.vertices, null);
        throw new NotImplementedError();
    }

    // Consistent iteration for polytopes of Region. Guarantees [] as a return
    // value if region is empty.
    get polytopes(): Polytope[] {
        return this.isEmpty ? [] : [this];
    }

    // Cached access to V-representation
    get vertices(): Vector[] {
        if (this._vertices != null) return this._vertices;
        this._HtoV();
        return this.vertices;
    }

    // Cached access to H-representation
    get halfspaces(): Halfspace[] {
        if (this._halfspaces != null) return this._halfspaces;
        this._VtoH();
        return this.halfspaces;
    }

    // isEmpty test is cached
    get isEmpty(): boolean {
        if (this._isEmpty != null) return this._isEmpty;
        // All polytopes that are not full-dimensional are considered to be empty.
        this._isEmpty = (this._vertices != null && this._vertices.length <= this.dim)
                || (this._halfspaces != null && this._halfspaces.length <= this.dim)
                || this.volume < TOL;
        return this._isEmpty;
    }

    get volume(): number { throw new NotImplementedError(); }
    get centroid(): Vector { throw new NotImplementedError(); }

    // Axis-aligned minimum bounding box
    get boundingBox(): Polytope {
        let bbox = cartesian(...this.extent);
        return this.constructor.hull(bbox);
    }

    // Axis-aligned extent
    get extent(): [number, number][] {
        let mins = new Array(this.dim);
        mins.fill(Infinity);
        let maxs = new Array(this.dim);
        maxs.fill(-Infinity);
        for (let vertex of this.vertices) {
            vertex.map((x, i) => {
                if (x < mins[i]) {
                    mins[i] = x;
                }
                if (x > maxs[i]) {
                    maxs[i] = x;
                }
            });
        }
        return arr.zip2(mins, maxs);
    }

    // Polytope equality test
    isSameAs(other: Region): boolean {
        if (other instanceof Union) {
            return other.isSameAs(this);
        } else {
            const vs = this.vertices;
            const ws = other.vertices;
            if (this.dim !== other.dim || vs.length !== ws.length) {
                return false;
            }
            // Test if two polytopes are identical by comparing vertices. Because
            // of canonical ordering vertices can be directly compared in order.
            for (let i = 0; i < vs.length; i++) {
                if (!linalg.areClose(vs[i], ws[i])) return false;
            }
            return true;
        }
    }

    covers(other: Region): boolean {
        if (this.isEmpty) return other.isEmpty;
        return other.remove(this).isEmpty;
    }

    // Does the given point lie inside the polytope?
    contains(p: Vector): boolean {
        linalg.assertEqualDims(this.dim, p.length);
        return iter.every(this.halfspaces.map(h => h.contains(p)));
    }

    // Does the polytope intersect the given region?
    intersects(other: Region): boolean {
        for (let p of other.polytopes) {
            if (!this.intersect(p).isEmpty) return true;
        }
        return false;
    }

    // Do all points of the polytope fulfil the linear predicate?
    fulfils(predicate: Halfspace): boolean {
        linalg.assertEqualDims(this.dim, predicate.dim);
        return iter.every(this.vertices.map(v => predicate.contains(v)));
    }

    // A random point from inside the polytope, based on a uniform distribution
    sample(): Vector {
        // Rejection based sampling should terminate eventually
        const extent = this.extent;
        let point;
        do {
            point = this.extent.map(([l, u]) => l + (u - l) * Math.random());
        } while (!this.contains(point));
        return point;
    }

    // Polytope translated by vector v
    translate(v: Vector): Polytope {
        // TODO: is hull really necessary? Translation should not change the
        // proper order of vertices...
        linalg.assertEqualDims(v.length, this.dim);
        return this.constructor.hull(this.vertices.map(x => linalg.add(x, v)));
        //return polytopeType(this.dim).noredund(this.halfspaces.map(h => h.translate(v)));
    }

    // Reflection with respect to the origin
    invert(): Polytope {
        return this.constructor.hull(this.vertices.map(v => v.map(x => -x)));
    }

    // Apply matrix from the left to every vertex
    apply(m: Matrix): Polytope {
        linalg.assertEqualDims(m[0].length, this.dim);
        return Polytope.ofDim(m.length).hull(this.vertices.map(v => linalg.apply(m, v)));
    }

    // Apply matrix from the right to every halfspace normal. For invertible
    // matrices, applyRight is identical to calling apply with the inverse of
    // the matrix.
    applyRight(m: Matrix): Polytope {
        linalg.assertEqualDims(m.length, this.dim);
        return Polytope.ofDim(m[0].length).intersection(this.halfspaces.map(h => h.applyRight(m)));
    }

    // Minkowski sum as defined by Baotić (2009)
    minkowski(other: Polytope): Polytope {
        linalg.assertEqualDims(this.dim, other.dim);
        let points = [];
        for (let v of this.vertices) {
            for (let w of other.vertices) {
                points.push(linalg.add(v, w));
            }
        }
        return this.constructor.hull(points);
    }

    // Pontryagin difference as defined by Baotić (2009). Note that pontryagin
    // is in general not the inverse of minkowski (e.g. consider the Pontryagin
    // difference between a square and a triangle).
    pontryagin(other: Polytope): Polytope {
        linalg.assertEqualDims(this.dim, other.dim);
        const ws = other.invert().vertices;
        const halfspaces = [];
        // this.halfspaces has the proper ordering for noredund, translate does
        // not affect the halfspace normals, therefore the ordering is
        // preserved when iterating through the halfspaces in the outer loop
        for (let h of this.halfspaces) {
            for (let w of ws) {
                halfspaces.push(h.translate(w));
            }
        }
        return this.constructor.noredund(halfspaces);
    }

    shatter() { throw new NotImplementedError() };

    // Split polytope with halfspace and return both parts
    split(h: Halfspace): [Polytope, Polytope] {
        const intersection = this.constructor.intersection;
        return [
            intersection([...this.halfspaces, h]),
            intersection([...this.halfspaces, h.flip()])
        ];
    }

    // Intersection with polytope of union of polytopes. Parametric so that
    // intersection of two Polytopes yields a Polytope and intersection of
    // a Polytope with a Union yields a Union.
    intersect<T: Region>(other: T): T {
        linalg.assertEqualDims(this.dim, other.dim);
        if (other instanceof Union) {
            return other.intersect(this);
        } else {
            if (other.isEmpty || this.isEmpty) return other.constructor.empty();
            return this._intersectPolytope(other);
        }
    }

    // Intersection of convex polytopes in H-representation: put all halfspaces
    // together and reduce to minimal (canonical) form.
    _intersectPolytope<T: Polytope>(other: T): T {
        return other.constructor.intersection([...this.halfspaces, ...other.halfspaces]);
    }

    // Set difference, yields a union of convex polytopes (in general).
    // Implementation of the regiondiff algorithm by Baotić (2009).
    remove(other: Region): Region {
        const polytopes = other.polytopes;
        if (polytopes.length === 0) return this;
        // Find a polytope in other that intersects and therefore requires
        // removal
        let k = 0;
        while (this.intersect(polytopes[k]).isEmpty) {
            k++;
            if (k === polytopes.length) {
                return this;
            }
        }
        const out = [];
        let poly = this;
        // Use the halfspaces of the polytope that is removed to cut the
        // remainder into convex polytopes, then continue removal recursively
        // with the remaining elements in other.
        for (let halfspace of polytopes[k].halfspaces) {
            const [_poly, polyCandidate] = poly.split(halfspace);
            if (!polyCandidate.isEmpty) {
                if (k < polytopes.length - 1) {
                    const toRemove = new Union(this.dim, polytopes.slice(k+1), null);
                    out.push(...polyCandidate.remove(toRemove).polytopes);
                } else {
                    out.push(polyCandidate);
                }
            }
            poly = _poly;
        }
        return out.length === 1 ? out[0] : new Union(this.dim, out, null);
    }

    // JSON serialization
    serialize(): JSONPolytope {
        return { dim: this.dim, vertices: this.vertices };
    }

    // Union with polytope as only member
    toUnion(): Union {
        return new Union(this.dim, [this], true);
    }

    union(other: Region): Union {
        return Union.from([this, ...other.polytopes]);
    }

    // Fill halfspace cache based on vertices
    _VtoH() { throw new NotImplementedError() };
    // Fill vertices cache based on halfspaces
    _HtoV() { throw new NotImplementedError() };

    // Compatibility with Union interface
    get isDisjunct(): boolean { return true; }
    disjunctify(): Polytope { return this; }
    simplify(): Polytope { return this; }
    hull(): Polytope { return this; }

}


// One-dimensional convex polytope
export class Interval extends Polytope {

    constructor(vertices: ?Vector[], halfspaces: ?Halfspace[]): void {
        super(vertices, halfspaces);
        this.dim = 1;
    }

    static hull(ps: Vector[]): Interval {
        ps.map(p => linalg.assertEqualDims(p.length, 1));
        // Find the left- and rightmost vertices
        let leftIdx = 0;
        let rightIdx = 0;
        for (let idx = 1; idx < ps.length; idx++) {
            if (ps[idx][0] < ps[leftIdx][0]) {
                leftIdx = idx;
            }
            if (ps[idx][0] > ps[rightIdx][0]) {
                rightIdx = idx;
            }
        }
        if (ps.length < 2 || linalg.areClose(ps[leftIdx], ps[rightIdx])) {
            return Interval.empty();
        } else {
            return new Interval([ps[leftIdx].slice(), ps[rightIdx].slice()], null);
        }
    }

    static intersection(halfspaces: Halfspace[]): Interval {
        return Interval.noredund(halfspaces);
    }

    static noredund(halfspaces: Halfspace[]): Interval {
        const hs = [];
        // Sort out trivial halfspaces or return empty if an infeasible
        // halfspace is encountered.
        for (let h of halfspaces) {
            linalg.assertEqualDims(h.dim, 1);
            if (h.isInfeasible) {
                return Interval.empty();
            } else if (!h.isTrivial) {
                hs.push(h);
            }
        }
        // Find rightmost halfspace with normal to the left and leftmost
        // halfspace with normal to the right.
        let leftIdx = -1;
        let rightIdx = -1;
        for (let idx = 0; idx < hs.length; idx++) {
            if (hs[idx].normal[0] < 0 && (leftIdx < 0 || hs[idx].offset < hs[leftIdx].offset)) {
                leftIdx = idx;
            }
            if (hs[idx].normal[0] > 0 && (rightIdx < 0 || hs[idx].offset < hs[rightIdx].offset)) {
                rightIdx = idx;
            }
        }
        if (leftIdx < 0 || rightIdx < 0 || hs[rightIdx].offset + hs[leftIdx].offset < TOL) {
            return Interval.empty();
        } else {
            return new Interval(null, [hs[leftIdx], hs[rightIdx]]);
        }
    }

    static empty(): Interval {
        return new Interval([], []);
    }

    get volume(): number {
        const vs = this.vertices;
        if (vs.length === 0) return 0;
        return vs[1][0] - vs[0][0];
    }

    get centroid(): Vector {
        const [l, r] = this.vertices;
        return [(l[0] + r[0]) / 2];
    }

    // Every interval is its own bounding box.
    get boundingBox(): Interval {
        return this;
    }

    shatter(): Union {
        const vertices = this.vertices;
        const centroid = this.centroid;
        return new Union(this.dim, [
            Interval.hull([centroid, vertices[0]]),
            Interval.hull([centroid, vertices[1]])
        ], true);
    }

    _HtoV(): void {
        if (this._halfspaces == null) {
            throw new ValueError();
        }
        this._vertices = [[-this._halfspaces[0].offset], [this._halfspaces[1].offset]]
    }

    _VtoH(): void {
        if (this._vertices == null) {
            throw new ValueError();
        }
        const [left, right] = this._vertices;
        this._halfspaces = [
            new Halfspace([-1], -left[0]),
            new Halfspace([1], right[0])
        ];
    }

}


// Two-dimensional convex polytope
export class Polygon extends Polytope {
    
    constructor(vertices: ?Vector[], halfspaces: ?Halfspace[]): void {
        super(vertices, halfspaces);
        this.dim = 2;
    }

    static empty(): Polygon {
        return new Polygon([], []);
    }

    // Algorithm based on
    // https://en.wikibooks.org/wiki/Algorithm_Implementation/Geometry/Convex_hull/Monotone_chain
    static hull(ps: Vector[]): Polygon {
        ps.map(p => linalg.assertEqualDims(p.length, 2));
        // Sort a copy of points by x-coordinate (ascending, y as fallback).
        const points = ps.slice().sort(vertexOrdering2D);
        // Lower part of convex hull: start with leftmost point and pick
        // vertices such that each angle between 3 vertices makes
        // a counterclockwise angle.
        const ls = [];
        for (let i = 0; i < points.length; i++) {
            reduceHullPart(ls, points[i], 0);
            ls.push(points[i]);
        }
        // Upper part of convex hull: like lower part but start from right
        const us = [];
        for (let i = points.length - 1; i >= 0; i--) {
            reduceHullPart(us, points[i], 0);
            us.push(points[i]);
        }
        // Polygon needs at least 3 vertices (because ends of each part are
        // start of other, test with 5)
        if (ls.length + us.length < 5) {
            return Polygon.empty();
        }
        // Hull might still contain close points or sections that are straight
        // with respect to TOL. Reduce the hull to canonical form by removing
        // such points.
        const vs = [];
        // Omit end from ls and us
        for (let i = 0; i < ls.length - 1; i++) {
            reduceHullPart(vs, ls[i], TOL);
            vs.push(ls[i]);
        }
        for (let i = 0; i < us.length - 1; i++) {
            reduceHullPart(vs, us[i], TOL);
            vs.push(us[i]);
        }
        // Reduce wrap-around at the end
        reduceHullPart(vs, vs[0], TOL);
        // Reduce wrap-around at the start
        while (vs.length > 1 && !isCCWTurn(vs[vs.length - 1], vs[0], vs[1], TOL)) {
            // vs[0] must be removed, either delete it by shifting or replace it
            // with the last element (which is then popped) if necessary to
            // preserve canonical ordering
            if (vertexOrdering2D(vs[vs.length - 1], vs[1]) < 0) {
                vs[0] = vs.pop();
            } else {
                vs.shift();
            }
        }
        // Return empty if less than 3 vertices remain after reduction
        return vs.length < 3 ? Polygon.empty() : new Polygon(vs, null);
    }

    static intersection(halfspaces: Halfspace[]): Polygon {
        const hs = [];
        // Sort out trivial halfspaces or return empty if an infeasible
        // halfspace is encountered.
        for (let h of halfspaces) {
            linalg.assertEqualDims(h.dim, 2);
            if (h.isInfeasible) {
                return Polygon.empty();
            }
            hs.push(h);
        }
        // Order halfspaces properly for noredund
        return Polygon.noredund(hs.sort(halfspaceOrdering2D));
    }

    // noredund expects cleaned input, i.e. a list of halfplanes in canonical
    // order and removes the redundant halfplanes. To obatain a polytope from
    // a non-canonical collection of halfspaces, use intersection. The
    // redundancy-removal algorithm is a custom development but has
    // similarities with that described by Kundu (1987).
    static noredund(halfplanes: Halfspace[]): Polygon {
        // Build a tight loop of halfspaces
        const loop = [];
        const cuts = [];
        let idx = 0;
        while (idx < halfplanes.length) {
            const next = halfplanes[idx];
            // Skip trivial halfplanes
            if (next.isTrivial) {
                idx++;
                continue;
            }
            // Empty loop: add the halfspace to start one
            if (loop.length == 0) {
                loop.push(next);
                idx++;
                continue;
            }
            // Loop contains halfplane(s): case distinction
            const last = loop[loop.length - 1];
            const angle = angleCCW(last.normal, next.normal);
            // Case 1: angle between last inserted and next halfplane is larger
            // than 180°. The there is an "open end", the region is not finite.
            if (angle > Math.PI - TOL) {
                return Polygon.empty();
            }
            const nextCut = halfplaneIntersection(last, next);
            // Case 2 : the next halfplane is parallel to the last inserted.
            // Case 2a: the inequality constant of the last is larger than the
            //          one of the next halfplane, i.e. it is less specific.
            //          Remove it and try adding the next halfplane again.
            // Case 2b: the next halfplane is less specific, skip it.
            if (nextCut == null) {
                if (last.offset > next.offset) {
                    cuts.pop();
                    loop.pop();
                } else {
                    idx++;
                }
                continue;
            }
            // Case 3: the last cut is not contained in the halfplane or the last
            //         cut is extremely close to the new one. The last halfplane is
            //         therefore redundant and removed. Try inserting the current
            //         one again (there might be multiple redundants).
            if (cuts.length > 0 && (!next.contains(cuts[cuts.length - 1])
                                    || linalg.areClose(nextCut, cuts[cuts.length - 1]))) {
                cuts.pop();
                loop.pop();
                continue;
            }
            // Case 4: the next halfplane defines a new edge of the polygon.
            cuts.push(nextCut);
            loop.push(next);
            idx++;
        }
        // Because it is not known if the first or last halfplane of the loop is
        // part of the final polygon, the ends may be redundant and have to be
        // trimmed. Multiple trimming criteria:
        let lidx = 0;
        let ridx = loop.length;
        while (ridx - lidx >= 3) {
            const angle = angleCCW(loop[ridx - 1].normal, loop[lidx].normal);
            // Ends don't close loop, polygon is unbounded
            if (angle > Math.PI - TOL) {
                return Polygon.empty();
            }
            // Determine cut of loop ends.
            const endCut = halfplaneIntersection(loop[lidx], loop[ridx - 1]);
            // No cut, loop ends are parallel. Pick more specific halfplane.
            if (endCut == null) {
                if (loop[lidx].offset > loop[ridx - 1].offset) {
                    lidx++;
                } else {
                    ridx--;
                }
            // Cut is not in 2nd to last halfplane of right end or close to last
            // cut of right end. Remove the last halfplane of the right end.
            } else if (!loop[ridx - 2].contains(endCut) || linalg.areClose(cuts[ridx - 2], endCut)) {
                ridx--;
            // Cut is not in 2nd to last halfplane of left end or close to last
            // cut of left end. Remove the last halfplane of the left end.
            } else if (!loop[lidx + 1].contains(endCut) || linalg.areClose(cuts[lidx], endCut)) {
                lidx++;
            // No trimming required.
            } else {
                break;
            }
        }
        // Return the leftover loop, if it still is a bounded region
        const out = ridx - lidx < 3 || angleCCW(loop[ridx - 1].normal, loop[lidx].normal) > Math.PI - TOL
                  ? []
                  : loop.slice(lidx, ridx);
        return new Polygon(null, out);
    }

    // https://en.wikipedia.org/wiki/Centroid#Of_a_polygon
    get volume(): number {
        return 0.5 * iter.sum(arr.cyc2map((a, b) => a[0]*b[1] - b[0]*a[1], this.vertices));
    }

    // https://en.wikipedia.org/wiki/Centroid#Of_a_polygon
    get centroid(): Vector {
        const vol = this.volume;
        const x = iter.sum(arr.cyc2map((a, b) => (a[0] + b[0]) * (a[0]*b[1] - b[0]*a[1]), this.vertices));
        const y = iter.sum(arr.cyc2map((a, b) => (a[1] + b[1]) * (a[0]*b[1] - b[0]*a[1]), this.vertices));
        return [x / 6 / vol, y / 6 / vol];
    }

    shatter(): Union {
        const centroid = this.centroid;
        return new Union(this.dim, arr.cyc2map(
            (v, w) => Polygon.hull([centroid, v, w]), this.vertices
        ), true);
    }

    // Custom intersect implementation for 2D: make use of absolute canonical
    // ordering and use merge to achieve linear computational complexity
    _intersectPolytope<T: Polytope>(other: T): T {
        // Because Polytopes maintain canonical ordering of halfspaces, all
        // that's necessary to produce a joint set of halfspaces with canonical
        // ordering is one merge step.
        return other.constructor.noredund(arr.merge(halfspaceOrdering2D, this.halfspaces, other.halfspaces));
    }

    _HtoV(): void {
        if (this._halfspaces == null) {
            throw new ValueError();
        } else {
            // To maintain consistency between canonical vertex and halfspace
            // ordering, the intersection between the first and last halfspace
            // must be the first vertex. Therefore cyc2mapl is used.
            this._vertices = arr.cyc2mapl(function (v, w) {
                const cut = halfplaneIntersection(v, w);
                if (cut == null) {
                    throw {};
                } else {
                    return cut;
                }
            }, this._halfspaces);
        }
    }

    _VtoH(): void {
        if (this._vertices == null) {
            throw new ValueError();
        } else {
            // Turn each edge into a halfspace. Use cyc2map to obtain
            // halfspaces in proper canonical order.
            this._halfspaces = arr.cyc2map(function (v, w) {
                return Halfspace.normalized([w[1] - v[1], v[0] - w[0]], v[0]*w[1] - w[0]*v[1]);
            }, this._vertices);
        }
    }

}



/* Union of convex polytopes */

export type JSONUnion = { dim: number, polytopes: JSONPolytope[] };

export class Union {

    +dim: number;
    +polytopes: Polytope[];
    +isEmpty: boolean;
    // Cached properties
    _isDisjunct: ?boolean; // yes, no, unknown

    constructor(dim: number, polytopes: Polytope[], isDisjunct: ?boolean): void {
        this.dim = dim;
        // polytopes property guarantees [] value if region is empty
        this.polytopes = polytopes.filter(_ => !_.isEmpty);
        this.isEmpty = this.polytopes.length === 0;
        this._isDisjunct = this.polytopes.length < 2 || isDisjunct;
    }

    static from(polytopes: Polytope[]): Union {
        if (polytopes.length < 1) throw new ValueError(
            "Unable to determine dimension from empty set of polytopes"
        );
        const dim = polytopes[0].dim;
        polytopes.forEach(_ => linalg.assertEqualDims(_.dim, dim));
        return new Union(dim, polytopes, null);
    }

    static empty(dim: number): Union {
        return new Union(dim, [], true);
    }

    static deserialize(json: JSONUnion): Union {
        return new Union(json.dim, json.polytopes.map(Polytope.deserialize), null);
    }

    get isDisjunct(): boolean {
        return this._isDisjunct != null && this._isDisjunct; // TODO: find out if null
    }

    get volume(): number {
        const polytopes = this.isDisjunct ? this.polytopes : this.disjunctify().polytopes;
        return iter.sum(polytopes.map(_ => _.volume));
    }

    get boundingBox(): Polytope {
        return Polytope.ofDim(this.dim).hull(cartesian(...this.extent));
    }

    get extent(): [number, number][] {
        return this.polytopes.map(_ => _.extent).reduce((ext, cur) => {
            return arr.zip2map((a, b) => [
                a[0] < b[0] ? a[0] : b[0],
                a[1] < b[1] ? b[1] : a[1]
            ], ext, cur);
        });
    }

    isSameAs(other: Region): boolean {
        return this.covers(other) && other.covers(this);
    }

    covers(other: Region): boolean {
        if (this.isEmpty) return other.isEmpty;
        return other.remove(this).isEmpty;
    }

    intersects(other: Region): boolean {
        for (let p of this.polytopes) {
            if (p.intersects(other)) return true;
        }
        return false;
    }

    contains(v: Vector): boolean {
        for (let p of this.polytopes) {
            if (p.contains(v)) return true;
        }
        return false;
    }

    fulfils(h: Halfspace): boolean {
        return iter.every(this.polytopes.map(_ => _.fulfils(h)));
    }

    sample(): Vector {
        if (this.polytopes.length >= 1) { // TODO
            return this.polytopes[0].sample();
        }
        throw new NotImplementedError();
        // disjunctify
        // choose polygon weighted by volume
        // sample from polygon
    }

    translate(v: Vector): Union {
        return new Union(this.dim, this.polytopes.map(_ => _.translate(v)), this._isDisjunct);
    }

    invert(): Union {
        return new Union(this.dim, this.polytopes.map(_ => _.invert()), this._isDisjunct);
    }

    apply(m: Matrix): Union {
        return new Union(this.dim, this.polytopes.map(_ => _.apply(m)), this._isDisjunct);
    }

    applyRight(m: Matrix): Union {
        return new Union(this.dim, this.polytopes.map(_ => _.applyRight(m)), this._isDisjunct);
    }

    minkowski(other: Polytope): Union {
        // Minkowski sum can be distributed to each individual polytope but
        // there may be overlaps afterwards.
        return new Union(this.dim, this.polytopes.map(_ => _.minkowski(other)), null);
    }

    pontryagin(other: Polytope): Region {
        // Pontryagin difference is not distributable like Minkowski sum. The
        // problem lies with shared edge sections of neighbouring polytopes.
        // Instead, apply Minkowksi sum to the complement, what remains is the
        // Pontryagin difference of the union. Since unbounded polygons are not
        // representable by this library, use the bounding box as a substitute
        // for the complement.
        const bbox = this.boundingBox;
        const complement = bbox.remove(this);
        // Apply Pontryagin difference also to bbox or else edges in xs that
        // are shared with bbox are not properly handled.
        return bbox.pontryagin(other).remove(complement.minkowski(other.invert()));
    }

    shatter(): Union {
        const pieces = [];
        for (let x of this.polytopes) {
            pieces.push(...x.shatter().polytopes);
        }
        return new Union(this.dim, pieces, this._isDisjunct);
    }

    intersect(other: Region): Region {
        const out = [];
        for (let x of this.polytopes) {
            for (let y of other.polytopes) {
                const intersection = x.intersect(y);
                if (!intersection.isEmpty) {
                    out.push(intersection);
                }
            }
        }
        // If this was not disjunct before intersection, it might be after
        return out.length === 1 ? out[0] : new Union(this.dim, out, this._isDisjunct ? true : null);
    }

    remove(other: Region): Union {
        const out = [];
        for (let p of this.polytopes) {
            out.push(...p.remove(other).polytopes);
        }
        // If this was not disjunct before removal, it might be after
        return new Union(this.dim, out, this._isDisjunct ? true : null);
    }

    union(other: Region): Union {
        return Union.from([...this.polytopes, ...other.polytopes]);
    }

    hull(): Polytope {
        const vertices = [];
        for (let polytope of this.polytopes) {
            vertices.push(...polytope.vertices);
        }
        return Polytope.ofDim(this.dim).hull(vertices);
    }

    disjunctify(): Union {
        // Sort by volume in ascending order and then take from the large end
        // first. This should favour the removal of small polytopes.
        const ps = this.polytopes.slice().sort((x, y) => x.volume - y.volume);
        const out = [];
        while (ps.length > 0) {
            const p = ps.pop();
            out.push(...p.remove(new Union(this.dim, out, true)).polytopes);
        }
        return new Union(this.dim, out, true);
    }

    simplify(): Region {
        if (this.polytopes.length === 1) {
            return this.polytopes[0];
        }
        const hull = this.hull();
        if (this.covers(hull)) {
            return hull;
        }
        // TODO: merging of individual polytopes?
        return this.disjunctify();
    }

    toUnion(): Union {
        return this;
    }

    serialize(): JSONUnion {
        return { dim: this.dim, polytopes: this.polytopes.map(_ => _.serialize()) };
    }

}

