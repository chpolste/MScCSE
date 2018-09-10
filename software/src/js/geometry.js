// @flow
"use strict";

/* Convex polytopes in 1 and 2 dimensions.

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
// Halfspaces: counterclockwise by angle wrt normal [-1, 0]
// /!\ This is carefully tuned so that canonical sets of halfspaces can be
//     combined into a canonical set with a single merge operation.

// Halfspace comparator for use with sort()
function halfspaceOrdering2D(g: Halfspace, h: Halfspace): number {
    return angleOrder(g.normal) - angleOrder(h.normal);
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

// Is the turn described by the points p, q, r counterclockwise?
function isCCWTurn(p: Vector, q: Vector, r: Vector): boolean {
    return (p[0] - r[0]) * (q[1] - r[1]) - (p[1] - r[1]) * (q[0] - r[0]) > 0;
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

HalfspaceInequality contains a parser of textual inequality representation,
which requires some helpers.
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

// Anything that contains halfspaces should provide this interface.
export interface HalfspaceContainer {
    +dim: number;
    +halfspaces: Halfspace[]; // ordered (depends on dim) and non-redundant
}

// Implement the HalfspaceContainer interface for convenience when used as
// function arguments.
export interface Halfspace extends HalfspaceContainer {
    +normal: Vector; // normalized to length 1
    +offset: number;
    +isTrivial: boolean;
    +isInfeasible: boolean;
    flip(): Halfspace;
    contains(p: Vector): boolean;
    isSameAs(other: Halfspace): boolean;
    translate(v: Vector): Halfspace;
    applyRight(m: Matrix): Halfspace;
    serialize(): JSONHalfspace;
}

export type JSONHalfspace = { normal: number[], offset: number };

// A halfspace represented by the inequality: normal · x <= offset. Due to the
// limitations of floating point arithmetic and using TOL for comparisons, no
// distinction between < and <= is made.
export class HalfspaceInequality implements Halfspace {

    +dim: number;
    +normal: Vector;
    +offset: number;

    // No further processing of input arguments. Use static methods to
    // construct a HalfspaceInequality from a textual or non-normalized
    // representation.
    constructor(normal: Vector, offset: number): void {
        this.normal = normal;
        this.offset = offset;
        this.dim = normal.length;
    }

    static normalized(normal: Vector, offset: number): HalfspaceInequality {
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
        return new HalfspaceInequality(normal.map(x => x / norm), offset / norm);
    }

    // Parse expressions such as "x + 4y < 3".
    static parse(text: string, variables: string): HalfspaceInequality {
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
        return HalfspaceInequality.normalized(normal, offset);
    }

    get isInfeasible(): boolean {
        return this.offset === -Infinity;
    }

    get isTrivial(): boolean {
        return this.offset === Infinity;
    }

    // In order to fulfil the HalfspaceContainer interface
    get halfspaces(): Halfspace[] {
        return [this];
    }

    flip(): HalfspaceInequality {
        return new HalfspaceInequality(this.normal.map(x => -x), -this.offset);
    }

    contains(point: Vector): boolean {
        linalg.assertEqualDims(this.dim, point.length);
        return linalg.dot(this.normal, point) - this.offset < TOL;
    }

    isSameAs(other: Halfspace): boolean {
        return linalg.areClose(this.normal, other.normal) && Math.abs(this.offset - other.offset) < TOL;
    }

    // Move Halfspace by the given vector. Project vector onto normal than
    // modify offset by the projection's length.
    translate(v: Vector): HalfspaceInequality {
        return HalfspaceInequality.normalized(this.normal, this.offset + linalg.dot(this.normal, v));
    }

    // Apply a matrix from the right to the normal vector. This may change the
    // dimensionality of the halfspace.
    applyRight(m: Matrix): HalfspaceInequality {
        return HalfspaceInequality.normalized(linalg.applyRight(m, this.normal), this.offset);
    }

    // JSON-compatible serialization and deserialization
    serialize(): JSONHalfspace {
        return { normal: this.normal, offset: this.offset };
    }

}

export function deserializeHalfspace(json: JSONHalfspace): Halfspace {
    return new HalfspaceInequality(json.normal, json.offset);
}



/* Convex Polytopes */

// Interface for convex polytopes of all dimensions
export interface ConvexPolytope extends HalfspaceContainer{

    /* Properties */

    // Vertices in canonical order
    +vertices: Vector[];
    // Halfspaces in canonical order
    +halfspaces: Halfspace[];
    // All polytopes that are not full-dimensional are considered to be empty.
    +isEmpty: boolean;
    +volume: number;
    +centroid: Vector;
    // Axis-aligned minimum bounding box
    +boundingBox: ConvexPolytope;
    // Axis-aligned extent of the polytope
    +extent: [number, number][];

    /* Predicates */

    // Polytope equality test
    isSameAs(ConvexPolytope): boolean;
    // Is the point inside the polytope?
    contains(Vector): boolean;
    // Do all points of the polytope fulfil the linear predicate?
    fulfils(Halfspace): boolean;

    /* Probability */

    // A random point from inside the polytope, based on a uniform distribution
    sample(): Vector;

    /* Geometric transformations */

    // Polytope translated by vector v
    translate(Vector): ConvexPolytope;
    // Reflection with respect to the origin
    invert(): ConvexPolytope;
    // Apply matrix from the left to every vertex
    apply(Matrix): ConvexPolytope;
    // Apply matrix from the right to every halfspace normal. For invertible
    // matrices, applyRight is identical to calling apply with the inverse of
    // the matrix.
    applyRight(Matrix): ConvexPolytope;

    /* Polytope-polytope operations */

    // Minkowski sum as defined by Baotić (2009)
    minkowski(ConvexPolytope): ConvexPolytope;
    // Pontryagin difference as defined by Baotić (2009). Note that pontryagin
    // is in general not the inverse of minkowski (e.g. consider the Pontryagin
    // difference between a square and a triangle).
    pontryagin(ConvexPolytope): ConvexPolytope;
    // Split the convex polytope along the boundaries of the given halfspaces
    // and return the partition.
    split(...Halfspace[]): ConvexPolytopeUnion;
    // Intersection
    intersect(...HalfspaceContainer[]): ConvexPolytope;
    // Difference
    remove(...HalfspaceContainer[]): ConvexPolytopeUnion;

    /* JSON-compatible serialization */
    serialize(): JSONConvexPolytope;

    /* Internals */

    // No processing of args in the constructor, therefore canonical form of
    // vertices/halfspaces must be provided. Use the alternative static method
    // constructors intersection, hull and empty to create convex polytopes
    // from non-canonical input.
    constructor(?Vector[], ?Halfspace[]): void;
    // Derive H-representation from V-representation and store in _halfspaces
    _HtoV(): void;
    // Derive V-representation from H-representation and store in _vertices
    _VtoH(): void;

}

export type JSONVertices = number[][];
export type JSONConvexPolytope = { dim: number, vertices: JSONVertices };

// Interface declaring the static methods of a convex polytope type
interface ConvexPolytopeType {
    // Return an empty polytope
    empty(): ConvexPolytope;
    // Convex hull of a set of points
    hull(Vector[]): ConvexPolytope;
    // intersection takes any collection of halfspaces, noredund expects
    // halfspaces to be in proper order and without infeasible/trivial ones
    intersection(Halfspace[]): ConvexPolytope;
    noredund(Halfspace[]): ConvexPolytope;
    // JSON deserialization
    deserialize(JSONVertices): ConvexPolytope;
}


/* Abstract base class for convex polytopes 

Contains dimension-independent implementations. Contains stubs to implement the
ConvexPolytope interface, so that `this` can be used inside methods without
flow complaining (no other way to specify abstract methods). However, this
means that flow will not detect missing methods in the subtypes.

Specification by either halfspaces or vertices is sufficient, the other
representation is computed (and cached) automatically by the getters (which
depend on _VtoH and HtoV for conversion).
*/

class AbstractConvexPolytope implements ConvexPolytope {

    _vertices: ?Vector[];
    _halfspaces: ?Halfspace[];
    +dim: number;

    // Methods that have to be implemented by subtypes (abstract methods):
    _VtoH() { throw new NotImplementedError() };
    _HtoV() { throw new NotImplementedError() };
    get volume() { throw new NotImplementedError() };
    get centroid() { throw new NotImplementedError() };

    constructor(vertices: ?Vector[], halfspaces: ?Halfspace[]): void {
        if (this.constructor === "AbstractConvexPolytope") {
            throw new TypeError("must not instanciate AbstractConvexPolytope");
        }
        this._vertices = vertices;
        this._halfspaces = halfspaces;
    }

    // Cached access to V-representation
    get vertices(): Vector[] {
        if (this._vertices != null) {
            return this._vertices;
        } else {
            this._HtoV();
            return this.vertices;
        }
    }

    // Cached access to H-representation
    get halfspaces(): Halfspace[] {
        if (this._halfspaces != null) {
            return this._halfspaces;
        } else {
            this._VtoH();
            return this.halfspaces;
        }
    }

    get isEmpty(): boolean {
        return (this._vertices != null && this._vertices.length <= this.dim)
            || (this._halfspaces != null && this._halfspaces.length <= this.dim)
            || Math.abs(this.volume) < TOL;
    }

    get boundingBox(): ConvexPolytope {
        let bbox = cartesian(...this.extent);
        return polytopeType(this.dim).hull(bbox);
    }

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

    // Test if two polytopes are identical by comparing vertices. Because of
    // canonical ordering vertices can be directly compared in order.
    isSameAs(other: ConvexPolytope): boolean {
        let thisVertices = this.vertices;
        let otherVertices = other.vertices;
        if (this.dim !== other.dim || thisVertices.length !== otherVertices.length) {
            return false;
        }
        for (let i = 0; i < thisVertices.length; i++) {
            if (!linalg.areClose(thisVertices[i], otherVertices[i])) {
                return false;
            }
        }
        return true;
    }

    contains(p: Vector): boolean {
        linalg.assertEqualDims(this.dim, p.length);
        return iter.and(this.halfspaces.map(h => h.contains(p)));
    }

    fulfils(predicate: Halfspace): boolean {
        linalg.assertEqualDims(this.dim, predicate.dim);
        return iter.and(this.vertices.map(v => predicate.contains(v)));
    }

    // Generic implementation is rejection based sampling
    // TODO: this is not guaranteed to terminate
    sample(): Vector {
        const extent = this.extent;
        let point;
        do {
            point = this.extent.map(([l, u]) => l + (u - l) * Math.random());
        } while (!this.contains(point));
        return point;
    }

    translate(v: Vector): ConvexPolytope {
        // TODO: is hull really necessary? Translation should not change the
        // proper order of vertices...
        linalg.assertEqualDims(v.length, this.dim);
        return polytopeType(this.dim).hull(this.vertices.map(x => linalg.add(x, v)));
        //return polytopeType(this.dim).noredund(this.halfspaces.map(h => h.translate(v)));
    }

    invert(): ConvexPolytope {
        return polytopeType(this.dim).hull(this.vertices.map(v => v.map(x => -x)));
    }

    apply(m: Matrix): ConvexPolytope {
        linalg.assertEqualDims(m[0].length, this.dim);
        return polytopeType(m.length).hull(this.vertices.map(v => linalg.apply(m, v)));
    }

    applyRight(m: Matrix): ConvexPolytope {
        linalg.assertEqualDims(m.length, this.dim);
        return polytopeType(m[0].length).intersection(this.halfspaces.map(h => h.applyRight(m)));
    }

    minkowski(other: ConvexPolytope): ConvexPolytope {
        linalg.assertEqualDims(this.dim, other.dim);
        let points = [];
        for (let v of this.vertices) {
            for (let w of other.vertices) {
                points.push(linalg.add(v, w));
            }
        }
        return polytopeType(this.dim).hull(points);
    }

    pontryagin(other: ConvexPolytope): ConvexPolytope {
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
        return polytopeType(this.dim).noredund(halfspaces);
    }

    split(...halfspaces: Halfspace[]): ConvexPolytopeUnion {
        // Must test variadic arg for undefined (https://github.com/facebook/flow/issues/3648)
        if (halfspaces == null || halfspaces.length == 0) {
            return [this];
        }
        const rest = halfspaces.splice(1);
        const split1 = this.intersect(halfspaces[0]).split(...rest).filter(h => !h.isEmpty);
        const split2 = this.intersect(halfspaces[0].flip()).split(...rest).filter(h => !h.isEmpty);
        return split1.concat(split2)
    }

    // Intersection of convex polytopes is trivial in H-representation: put all
    // halfspaces together and reduce to minimal (canonical) form.
    intersect(...others: HalfspaceContainer[]): ConvexPolytope {
        if (others == null || others.length == 0) {
            return polytopeType(this.dim).empty();
        }
        const halfspaces = this.halfspaces.slice();
        for (let other of others) {
            linalg.assertEqualDims(this.dim, other.dim);
            halfspaces.push(...other.halfspaces);
        }
        return polytopeType(this.dim).intersection(halfspaces);
    }

    // Set difference, yields a union of convex polytopes (in general).
    // Implementation of the regiondiff algorithm by Baotić (2009).
    remove(...others?: HalfspaceContainer[]): ConvexPolytopeUnion {
        if (others == null || others.length == 0) {
            return [this];
        }
        // Find a polytope in others that intersects and therefore requires
        // removal
        let k = 0;
        while (this.intersect(others[k]).isEmpty) {
            k++;
            if (k == others.length) {
                return [this];
            }
        }
        const region = [];
        let poly = this;
        // Use the halfspaces of the polytope that is removed to cut the
        // remainder into convex polytopes, then continue removal recursively
        // with the remaining elements in other.
        for (let halfspace of others[k].halfspaces) {
            const polyCandidate = poly.intersect(halfspace.flip());
            if (!polyCandidate.isEmpty) {
                if (k < others.length - 1) {
                    region.push(...polyCandidate.remove(...others.slice(k+1)));
                } else {
                    region.push(polyCandidate);
                }
            }
            poly = poly.intersect(halfspace);
        }
        return region;
    }

    serialize(): JSONConvexPolytope {
        return { dim: this.dim, vertices: this.vertices };
    }

}



/* 1-dimensional convex polytope (interval) */

export class Interval extends AbstractConvexPolytope implements ConvexPolytope {

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

    static deserialize(json: JSONVertices): Interval {
        return new Interval(json, null);
    }

    get volume(): number {
        const [left, right] = this.vertices;
        return right[0] - left[0];
    }

    get centroid(): Vector {
        const [l, r] = this.vertices;
        return [(l[0] + r[0]) / 2];
    }

    // Every interval is its own bounding box.
    get boundingBox(): Interval {
        return this;
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
            new HalfspaceInequality([-1], -left[0]),
            new HalfspaceInequality([1], right[0])
        ];
    }

}



/* 2-dimensional convex polytope (polygon) */

export class Polygon extends AbstractConvexPolytope implements ConvexPolytope {
    
    constructor(vertices: ?Vector[], halfspaces: ?Halfspace[]): void {
        super(vertices, halfspaces);
        this.dim = 2;
    }

    static empty(): Polygon {
        return new Polygon([], []);
    }

    static hull(ps: Vector[]): Polygon {
        ps.map(p => linalg.assertEqualDims(p.length, 2));
        // Sort a copy of points by x-coordinate (ascending, y as fallback).
        const points = ps.slice().sort(vertexOrdering2D);
        // Lower part of convex hull: start with leftmost point and pick
        // vertices such that each angle between 3 vertices makes
        // a counterclockwise angle.
        const ls = [];
        for (let i = 0; i < points.length; i++) {
            while (ls.length > 1 && (!isCCWTurn(ls[ls.length - 2], ls[ls.length - 1], points[i])
                                     || linalg.areClose(ls[ls.length - 1], points[i]))) {
                ls.pop();
            }
            ls.push(points[i]);
        }
        // Upper part of convex hull: like lower part but start from right
        const us = [];
        for (let i = points.length - 1; i >= 0; i--) {
            while (us.length > 1 && (!isCCWTurn(us[us.length - 2], us[us.length - 1], points[i])
                                     || linalg.areClose(us[us.length - 1], points[i]))) {
                us.pop();
            }
            us.push(points[i]);
        }
        // Ends of each part are start of other
        ls.pop();
        us.pop();
        return new Polygon(ls.length + us.length < 3 ? [] : ls.concat(us), null);
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

    static deserialize(json: JSONVertices): Polygon {
        return new Polygon(json, null);
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

    // Custom intersect implementation for 2D: make use of absolute canonical
    // ordering and use merge to achieve linear computational complexity
    intersect(...others: HalfspaceContainer[]): ConvexPolytope {
        if (others == null || others.length === 0) {
            return polytopeType(this.dim).empty();
        // Because HalfspaceContainers must maintain proper ordering of
        // halfspaces, all that's necessary to produce a joint set of
        // halfspaces with proper ordering is one merge step.
        } else if (others.length === 1) {
            linalg.assertEqualDims(this.dim, others[0].dim);
            return polytopeType(this.dim).noredund(
                arr.merge(halfspaceOrdering2D, this.halfspaces, others[0].halfspaces)
            );
        // TODO: implement n-way merge
        } else {
            return super.intersect(...others);
        }
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
                return HalfspaceInequality.normalized([w[1] - v[1], v[0] - w[0]], v[0]*w[1] - w[0]*v[1]);
            }, this._vertices);
        }
    }

}


// Mapping: dimension -> ConvexPolytope type (required for polytope
// transformations that result in a change of dimensionality). This list also
// enforces that the types above fulfil the ConvexPolytopeType interface.
const _PolytopeTypes: (?ConvexPolytopeType)[] = [null, Interval, Polygon];

export function polytopeType(dim: number): ConvexPolytopeType {
    const polytopeType = _PolytopeTypes[dim];
    if (polytopeType == null) {
        throw new NotImplementedError();
    } else {
        return polytopeType;
    }
}

export function deserializePolytope(json: JSONConvexPolytope): ConvexPolytope {
    return polytopeType(json.dim).deserialize(json.vertices);
}



/* Union operations */

// Unions of convex polytopes are represented by a list of polytopes instead of
// a dedicated type.
export type JSONConvexPolytopeUnion = JSONConvexPolytope[];
export type ConvexPolytopeUnion = ConvexPolytope[];

export const union = {

    isEmpty(xs: ConvexPolytopeUnion): boolean {
        return iter.and(xs.map(x => x.isEmpty));
    },

    extent(xs: ConvexPolytopeUnion): [number, number][] {
        if (xs.length < 1) {
            throw new ValueError("Union is empty, cannot determine dim");
        }
        return xs.map(x => x.extent).reduce((ext, cur) => {
            linalg.assertEqualDims(ext.length, cur.length);
            return arr.zip2map((a, b) => [
                a[0] < b[0] ? a[0] : b[0],
                a[1] < b[1] ? b[1] : a[1]
            ], ext, cur);
        });
    },

    boundingBox(xs: ConvexPolytopeUnion): ConvexPolytope {
        return polytopeType(xs[0].dim).hull(cartesian(...union.extent(xs)));
    },

    hull(xs: ConvexPolytopeUnion): ConvexPolytope {
        if (union.isEmpty(xs)) {
            throw new ValueError("Union is empty, cannot determine dim");
        }
        return polytopeType(xs[0].dim).hull([].concat(...xs.map(x => x.vertices)));
    },

    covers(xs: ConvexPolytopeUnion, ys: ConvexPolytopeUnion): boolean {
        return union.isEmpty(union.remove(ys, xs));
    },

    isSameAs(xs: ConvexPolytopeUnion, ys: ConvexPolytopeUnion): boolean {
        return union.covers(xs, ys) && union.covers(ys, xs);
    },

    disjunctify(xs: ConvexPolytopeUnion): ConvexPolytopeUnion {
        // Sort by volume in ascending order and then take from the large end
        // first. This should favour the removal of small polytopes.
        const xxs = xs.slice().sort((x, y) => x.volume - y.volume);
        const out = [];
        while (xxs.length > 0) {
            const xx = xxs.pop();
            out.push(...xx.remove(...out));
        }
        return out.filter(p => !p.isEmpty);
    },

    simplify(xs: ConvexPolytopeUnion): ConvexPolytopeUnion {
        if (xs.length <= 1) {
            return xs;
        }
        const hull = [union.hull(xs)];
        if (union.covers(xs, hull)) {
            return hull;
        }
        // TODO: merging of individual polytopes?
        return union.disjunctify(xs);
    },

    intersect(xs: ConvexPolytopeUnion, ys: ConvexPolytopeUnion): ConvexPolytopeUnion {
        const out = [];
        for (let x of xs) {
            for (let y of ys) {
                const intersection = x.intersect(y);
                if (!intersection.isEmpty) {
                    out.push(intersection);
                }
            }
        }
        return out;
    },

    doIntersect(xs: ConvexPolytopeUnion, ys: ConvexPolytopeUnion): boolean {
        for (let x of xs) {
            for (let y of ys) {
                if (!x.intersect(y).isEmpty) {
                    return true;
                }
            }
        }
        return false;
    },

    remove(xs: ConvexPolytopeUnion, ys: ConvexPolytopeUnion): ConvexPolytopeUnion {
        const out = [];
        for (let x of xs) {
            out.push(...x.remove(...ys));
        }
        return out;
    },

    // Minkowski sum can be distributed to each individual polytope of the
    // union, then remove the overlapping parts that occur multiple times.
    minkowski(xs: ConvexPolytopeUnion, y: ConvexPolytope): ConvexPolytopeUnion {
        return union.disjunctify(xs.map(x => x.minkowski(y)));
    },

    // Pontryagin difference is not distributable like Minkowski sum. The
    // problem lies with shared sections of edges of neighbouring polytopes.
    // Instead, apply Minkowksi sum to the complement, what remains is the
    // Pontryagin difference of the union.
    pontryagin(xs: ConvexPolytopeUnion, y: ConvexPolytope): ConvexPolytopeUnion {
        // Since unbounded polygons are not representable by this library, use
        // bbox as a substitute for the complement
        const bbox = union.boundingBox(xs);
        const complement = bbox.remove(...xs);
        // Apply Pontryagin difference also to bbox or else edges in xs that
        // are shared with bbox are not properly handled (necessary due to bbox
        // use for complement)
        return bbox.pontryagin(y).remove(...union.minkowski(complement, y.invert()));
    },

    serialize(xs: ConvexPolytopeUnion): JSONConvexPolytope[] {
        return xs.map(x => x.serialize());
    },

    deserialize(json: JSONConvexPolytope[]): ConvexPolytopeUnion {
        return json.map(deserializePolytope);
    }

};

