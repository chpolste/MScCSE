// @flow
"use strict";

/* Convex polytopes in 1 and 2 dimensions.

References:
- Baotić, M. (2009). Polytopic Computations in Constrained Optimal Control.
  Automatika, Journal for Control, Measurement, Electronics, Computing and
  Communications, 50, 119–134.

*/

import type { Vector, Matrix } from "./linalg.js";

import * as linalg from "./linalg.js";
import { zip2map, cyc2map, NotImplementedError, ValueError, ParseError } from "./tools.js";


// Reuse float-comparison tolerance from linalg
export const TOL = linalg.TOL;

// Cartesian product (no guaranteed ordering), e.g.
//     cartesian([0, 1], [2, 3], [4, 5]) = [[0, 2, 4], [0, 2, 5], [0, 3, 4], ...]
// Will not work correctly if T is a list (flattens as an intermediate step).
function cartesian<T>(...tuples: T[][]): T[][] {
    let cart = [[]];
    for (let tuple of tuples) {
        cart = [].concat(...cart.map(xs => tuple.map(y => xs.concat([y]))));
    }
    return cart;
}


/* 2D helpers */

// Counterclockwise angle between two vectors, normalized to range [0, 2π).
function angleCCW(v: Vector, w: Vector): number {
    let angle = Math.atan2(w[1], w[0]) - Math.atan2(v[1], v[0]);
    // Because atan2 delivers range [-π, π] (both inclusive), some
    // post-processing of the interval is necessary:
    if (angle < -TOL) {
        return angle + 2 * Math.PI;
    } else if (angle < 0 || angle == 2 * Math.PI) {
        return 0;
    } else {
        return angle;
    }
}

// Is the turn described by the points p, q, r counterclockwise?
function isCCWTurn(p: Vector, q: Vector, r: Vector): boolean {
    return (p[0] - r[0]) * (q[1] - r[1]) - (p[1] - r[1]) * (q[0] - r[0]) >= TOL;
}

function halfplaneIntersection(g: Halfspace, h: Halfspace): ?Vector {
    let [g0, g1] = g.normal;
    let [h0, h1] = h.normal;
    let det = g0 * h1 - g1 * h0;
    if (Math.abs(det) < TOL) {
        return null;
    } else {
        return [(h1 * g.offset - g1 * h.offset) / det, (g0 * h.offset - h0 * g.offset) / det];
    }
}


/* Parser helpers

HalfspaceInequation contains a parser of textual inequation representation,
which requires some helpers.
*/

function splitInequation(text: string): [string, string, string] {
    let parts = text.split(/\s*([<>]=?)\s*/);
    if (parts.length != 3) {
        throw new ParseError("not a valid inequation (requires one of <=, <, >, >=)");
    }
    // No distinction between < and <= and > and >= (float arithmetic with TOL)
    return [parts[0], parts[1][0], parts[2]];
}

interface Term { variable: string, coefficient: number }

function splitTerms(text: string): Term[] {
    let tokens = text.split(/\s*([\+-])\s*/).filter(token => token.length > 0);
    let terms = [];
    let sign = 0;
    if (tokens[0] != "-") {
        sign = 1;
    }
    for (let token of tokens) {
        if (sign == 0) {
            if (token == "+") {
                sign = 1;
            } else if (token == "-") {
                sign = -1;
            } else {
                throw new ParseError("unexpected token '" + token + "'");
            }
        } else {
            let term = parseTerm(token);
            term.coefficient = sign * term.coefficient;
            terms.push(term);
            sign = 0;
        }
    }
    return terms;
}

const _varRegex = /^([a-zA-Z])$/;
const _numRegex = /^((?:\d+(?:\.\d+)?)|(?:\.\d+))$/;
const _numvarRegex = /^((?:\d+(?:\.\d+)?)|(?:\.\d+))\s*\*?\s*([a-zA-Z])$/;

function parseTerm(token): Term {
    let match = token.match(_varRegex);
    if (match != null) {
        return { variable: match[1], coefficient: 1 };
    }
    match = token.match(_numRegex);
    if (match != null) {
        return { variable: "", coefficient: parseFloat(match[1]) };
    }
    match = token.match(_numvarRegex);
    if (match != null) {
        return { variable: match[2], coefficient: parseFloat(match[1]) };
    }
    throw new ParseError("invalid term '" + token +"'");
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
}


// A halfspace represented by the inequation: normal · x <= offset. Due to the
// limitations of floating point arithmetic and using TOL for comparisons, no
// distinction between < and <= is made.
export class HalfspaceInequation implements Halfspace {

    +dim: number;
    +normal: Vector;
    +offset: number;

    // No further processing of input arguments. Use static methods to
    // construct a HalfspaceInequation from a textual or non-normalized
    // representation.
    constructor(normal: Vector, offset: number): void {
        this.normal = normal;
        this.offset = offset;
        this.dim = normal.length;
    }

    static normalized(normal: Vector, offset: number): HalfspaceInequation {
        let norm = linalg.norm2(normal);
        if (norm < TOL) {
            // Trivial/Infeasible inequations. Break ties (offset === 0) by
            // assuming inequation is always fulfilled (in the spirit of <=).
            // These special cases must be considered to enable changes of
            // dimensionality with applyRight. E.g. if [[1, 2]] is applied from
            // the right to the normal vector parallel to [[2], [-1]], the
            // result is either the entire lower dimension (if offset >= 0) or
            // empty (if offset < 0).
            offset = offset === 0 ? Infinity : Math.sign(offset) * Infinity
            norm = 1;
        }
        return new HalfspaceInequation(normal.map(x => x / norm), offset / norm);
    }

    // Parse expressions such as "x + 4y < 3".
    static parse(text: string, variables: string): HalfspaceInequation {
        let [lhs, comp, rhs] = splitInequation(text.trim());
        let terms = splitTerms(comp == ">" ? rhs : lhs);
        terms.push(...splitTerms(comp == ">" ? lhs : rhs).map(function (term: Term) {
            term.coefficient = -term.coefficient;
            return term;
        }));
        let offset = 0;
        let normal = new Array(variables.length);
        normal.fill(0);
        for (let term of terms) {
            if (term.variable == "") {
                offset = offset - term.coefficient;
            } else {
                let idx = variables.indexOf(term.variable);
                if (idx >= 0) {
                    normal[idx] = normal[idx] + term.coefficient;
                } else {
                    throw new ParseError("unexpected variable '" + term.variable + "'");
                }
            }
        }
        return HalfspaceInequation.normalized(normal, offset);
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

    flip(): HalfspaceInequation {
        return new HalfspaceInequation(this.normal.map(x => -x), -this.offset);
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
    translate(v: Vector): HalfspaceInequation {
        return HalfspaceInequation.normalized(this.normal, this.offset + linalg.dot(this.normal, v));
    }

    // Apply a matrix from the right to the normal vector. This may change the
    // dimensionality of the halfspace.
    applyRight(m: Matrix): HalfspaceInequation {
        return HalfspaceInequation.normalized(linalg.applyRight(m, this.normal), this.offset);
    }

}



/* Convex Polytopes */

// Interface for convex polytopes of all dimensions
export interface ConvexPolytope extends HalfspaceContainer{
    +vertices: Vector[]; // ordered (depends on dim)
    +isEmpty: boolean;
    +volume: number;
    +centroid: Vector;
    +boundingBox: ConvexPolytope;
    +extent: Vector[]; // TODO: this should rather be [number, number][] -> check with cartesian
    constructor(vertices: ?Vector[], halfspaces: ?Halfspace[]): void;
    isSameAs(other: ConvexPolytope): boolean;
    contains(p: Vector): boolean;
    translate(v: Vector): ConvexPolytope;
    invert(): ConvexPolytope;
    apply(m: Matrix): ConvexPolytope;
    applyRight(m: Matrix): ConvexPolytope;
    minkowski(other: ConvexPolytope): ConvexPolytope;
    pontryagin(other: ConvexPolytope): ConvexPolytope;
    split(...halfspaces: Halfspace[]): ConvexPolytopeUnion;
    intersect(...others: HalfspaceContainer[]): ConvexPolytope;
    remove(...others: HalfspaceContainer[]): ConvexPolytopeUnion;
    _HtoV(): void;
    _VtoH(): void;
}

// Interface declaring the static methods of a convex polytope type
interface ConvexPolytopeType {
    empty(): ConvexPolytope;
    hull(points: Vector[]): ConvexPolytope;
    noredund(halfspaces: Halfspace[]): ConvexPolytope;
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

    // Methods that have to be implemented by subtypes
    _VtoH() { throw new NotImplementedError() };
    _HtoV() { throw new NotImplementedError() };
    get volume() { throw new NotImplementedError() };
    get centroid() { throw new NotImplementedError() };

    // No post-processing, therefore canonical form of vertices/halfspaces must
    // be provided. Use the alternative static method constructors noredund,
    // hull and empty to create convex polytopes from non-canonical input.
    constructor(vertices: ?Vector[], halfspaces: ?Halfspace[]): void {
        if (this.constructor === "AbstractConvexPolytope") {
            throw new TypeError("must not instanciate AbstractConvexPolytope");
        }
        this._vertices = vertices;
        this._halfspaces = halfspaces;
    }

    get vertices(): Vector[] {
        if (this._vertices != null) {
            return this._vertices;
        } else {
            this._HtoV();
            return this.vertices;
        }
    }

    get halfspaces(): Halfspace[] {
        if (this._halfspaces != null) {
            return this._halfspaces;
        } else {
            this._VtoH();
            return this.halfspaces;
        }
    }

    // All polytopes that are not full-dimensional are considered to be empty.
    get isEmpty(): boolean {
        return (this._vertices != null && this._vertices.length <= this.dim)
            || (this._halfspaces != null && this._halfspaces.length <= this.dim)
            || Math.abs(this.volume) < TOL;
    }

    // Axis-aligned minimum bounding box
    get boundingBox(): ConvexPolytope {
        let bbox = cartesian(...this.extent);
        return polytopeType(this.dim).hull(bbox);
    }

    // Axis-aligned extent of the polytope
    get extent(): Vector[] {
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
        return zip2map((x, y) => [x, y], mins, maxs);
    }

    // Test if two polytopes are identical by comparing vertices. Depends on
    // the ordering properties of the canonical representation.
    isSameAs(other: ConvexPolytope): boolean {
        let thisVertices = this.vertices;
        let otherVertices = other.vertices;
        if (this.dim != other.dim || thisVertices.length != otherVertices.length) {
            return false;
        }
        // Find a common vertex
        let idxoff = 0;
        while (idxoff < thisVertices.length) {
            if (linalg.areClose(thisVertices[idxoff], otherVertices[0])) {
                break;
            }
            idxoff++;
        }
        // Check if same vertex order
        for (let i = 0; i < thisVertices.length; i++) {
            if (!linalg.areClose(thisVertices[(idxoff + i) % thisVertices.length], otherVertices[i])) {
                return false;
            }
        }
        return idxoff < thisVertices.length;
    }

    contains(p: Vector): boolean {
        linalg.assertEqualDims(this.dim, p.length);
        for (let halfspace of this.halfspaces) {
            if (!halfspace.contains(p)) {
                return false;
            }
        }
        return true;
    }

    translate(v: Vector): ConvexPolytope {
        // TODO: is hull really necessary? Translation should not change the
        // proper order of vertices...
        linalg.assertEqualDims(v.length, this.dim);
        return polytopeType(this.dim).hull(this.vertices.map(x => linalg.add(x, v)));
        //return polytopeType(this.dim).noredund(this.halfspaces.map(h => h.translate(v)));
    }

    // Reflection with respect to the origin.
    invert(): ConvexPolytope {
        return polytopeType(this.dim).hull(this.vertices.map(v => v.map(x => -x)));
    }

    // Apply matrix m from the left to every vertex.
    apply(m: Matrix): ConvexPolytope {
        linalg.assertEqualDims(m[0].length, this.dim);
        return polytopeType(m.length).hull(this.vertices.map(v => linalg.apply(m, v)));
    }

    // Apply matrix m from the right to every halfspace normal. For invertible
    // matrices, applyRight is identical to calling apply with the inverse of
    // the matrix m.
    applyRight(m: Matrix): ConvexPolytope {
        linalg.assertEqualDims(m.length, this.dim);
        return polytopeType(m[0].length).noredund(this.halfspaces.map(h => h.applyRight(m)));
    }

    // Minkowski sum as defined by Baotić (2009).
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

    // Pontryagin difference as defined by Baotić (2009). Note that pontryagin
    // is in general not the inverse of minkowski (e.g. consider the Pontryagin
    // difference between a square and a triangle).
    pontryagin(other: ConvexPolytope): ConvexPolytope {
        linalg.assertEqualDims(this.dim, other.dim);
        let otheri = other.invert();
        let halfspaces = [];
        for (let h of this.halfspaces) {
            for (let w of otheri.vertices) {
                halfspaces.push(h.translate(w));
            }
        }
        return polytopeType(this.dim).noredund(halfspaces);
    }

    // Split the convex polytope along the boundaries of the given halfspaces
    // and return the partition.
    split(...halfspaces: Halfspace[]): ConvexPolytopeUnion {
        // Must test variadic arg for undefined (https://github.com/facebook/flow/issues/3648)
        if (halfspaces == null || halfspaces.length == 0) {
            return [this];
        }
        let rest = halfspaces.splice(1);
        let split1 = this.intersect(halfspaces[0]).split(...rest).filter(h => !h.isEmpty);
        let split2 = this.intersect(halfspaces[0].flip()).split(...rest).filter(h => !h.isEmpty);
        return split1.concat(split2)
    }

    // Intersection of convex polytopes is trivial in H-representation: put all
    // halfspaces together and reduce to minimal (canonical) form.
    intersect(...others: HalfspaceContainer[]): ConvexPolytope {
        if (others == null || others.length == 0) {
            return polytopeType(this.dim).empty();
        }
        let halfspaces = this.halfspaces.slice();
        for (let other of others) {
            linalg.assertEqualDims(this.dim, other.dim);
            halfspaces.push(...other.halfspaces);
        }
        return polytopeType(this.dim).noredund(halfspaces);
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
        let region = [];
        let poly = this;
        // Use the halfspaces of the polytope that is removed to cut the
        // remainder into convex polytopes, then continue removal recursively
        // with the remaining elements in other.
        for (let halfspace of others[k].halfspaces) {
            let polyCandidate = poly.intersect(halfspace.flip());
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

    static noredund(halfspaces: Halfspace[]): Interval {
        let hs = [];
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
        let [left, right] = this.vertices;
        return right[0] - left[0];
    }

    get centroid(): Vector {
        let [l, r] = this.vertices;
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
        let [left, right] = this._vertices;
        this._halfspaces = [new HalfspaceInequation([-1], -left[0]),
                            new HalfspaceInequation([1], right[0])]
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
        let points = ps.slice().sort((p, q) => (p[0] == q[0] ? p[1] - q[1] : p[0] - q[0]));
        // Lower part of convex hull: start with leftmost point and pick
        // vertices such that each angle between 3 vertices makes
        // a counterclockwise angle.
        let ls = [];
        for (let i = 0; i < points.length; i++) {
            while (ls.length > 1 && (!isCCWTurn(ls[ls.length - 2], ls[ls.length - 1], points[i])
                                     || linalg.areClose(ls[ls.length - 1], points[i]))) {
                ls.pop();
            }
            ls.push(points[i]);
        }
        // Upper part of convex hull: like lower part but start from right
        let us = [];
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

    static noredund(halfspaces: Halfspace[]): Polygon {
        let hs = [];
        // Sort out trivial halfspaces or return empty if an infeasible
        // halfspace is encountered.
        for (let h of halfspaces) {
            linalg.assertEqualDims(h.dim, 2);
            if (h.isInfeasible) {
                return Polygon.empty();
            } else if (!h.isTrivial) {
                hs.push(h);
            }
        }
        // Sort by CCW angles relative to [0, -1, 0] (upper halfspace of
        // coordinate system)
        let halfplanes = hs.slice().sort(function (g, h) {
            return angleCCW([0, -1], g.normal) - angleCCW([0, -1], h.normal);
        });
        // Build a tight loop of halfspaces
        let loop = [];
        let cuts = [];
        let idx = 0;
        while (idx < halfplanes.length) {
            // Empty loop: add the halfspace to start one
            if (loop.length == 0) {
                loop.push(halfplanes[idx]);
                idx++;
                continue;
            }
            // Loop contains halfplane(s): case distinction
            let last = loop[loop.length - 1];
            let next = halfplanes[idx];
            let angle = angleCCW(last.normal, next.normal);
            // Case 1: angle between last inserted and next halfplane is larger
            // than 180°. The there is an "open end", the region is not finite.
            if (angle > Math.PI - TOL) {
                return Polygon.empty();
            }
            let nextCut = halfplaneIntersection(last, next);
            // Case 2 : the next halfplane is parallel to the last inserted.
            // Case 2a: the inequality constant of the last is larger than the
            //          one of the next halfplane, i.e. it is less specific.
            //          Remove it and try adding the next halfplane again.
            // Case 2b: the next halfplane is less specific, skip it.
            if (nextCut == null || angle < TOL) {
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
            let angle = angleCCW(loop[ridx - 1].normal, loop[lidx].normal);
            // Ends don't close loop, polygon is unbounded
            if (angle > Math.PI - TOL) {
                return Polygon.empty();
            }
            // Determine cut of loop ends.
            let endCut = halfplaneIntersection(loop[lidx], loop[ridx - 1]);
            // No cut, loop ends are parallel. Pick more specific halfplane.
            if (endCut == null || angle < TOL) {
                if (loop[lidx].offset > loop[ridx].offset) {
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
        let out = ridx - lidx < 3 || angleCCW(loop[ridx - 1].normal, loop[lidx].normal) > Math.PI - TOL
                  ? []
                  : loop.slice(lidx, ridx);
        return new Polygon(null, out);
    }

    // https://en.wikipedia.org/wiki/Centroid#Centroid_of_a_polygon
    get volume(): number {
        return 0.5 * cyc2map((a, b) => a[0]*b[1] - b[0]*a[1], this.vertices).reduce((a, b) => a + b, 0);
    }

    // https://en.wikipedia.org/wiki/Centroid#Centroid_of_a_polygon
    get centroid(): Vector {
        let vol = this.volume;
        let x = cyc2map((a, b) => (a[0] + b[0]) * (a[0]*b[1] - b[0]*a[1]), this.vertices).reduce((a, b) => a + b, 0);
        let y = cyc2map((a, b) => (a[1] + b[1]) * (a[0]*b[1] - b[0]*a[1]), this.vertices).reduce((a, b) => a + b, 0);
        return [x / 6 / vol, y / 6 / vol];
    }

    _HtoV(): void {
        if (this._halfspaces == null) {
            throw new ValueError();
        } else {
            // Because halfspaces are ordered CCW in canonical form, just find
            // the intersections of neighbours.
            this._vertices = cyc2map(function (v, w) {
                let cut = halfplaneIntersection(v, w);
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
            // Turn each edge into a halfspace.
            this._halfspaces = cyc2map(function (v, w) {
                return HalfspaceInequation.normalized([w[1] - v[1], v[0] - w[0]], v[0]*w[1] - w[0]*v[1]);
            }, this._vertices);
        }
    }

}


// Mapping: dimension -> ConvexPolytope type (required for polytope
// transformations that result in a change of dimensionality). This list also
// enforces that the types above fulfil the ConvexPolytopeType interface.
const _PolytopeTypes: (?ConvexPolytopeType)[] = [null, Interval, Polygon];

export function polytopeType(dim: number): ConvexPolytopeType {
    let polytopeType = _PolytopeTypes[dim];
    if (polytopeType == null) {
        throw new NotImplementedError();
    } else {
        return polytopeType;
    }
}



/* Union operations */

// Unions of convex polytopes are represented by a list of polytopes instead of
// a dedicated type.
export type ConvexPolytopeUnion = ConvexPolytope[];

export const union = {

    isEmpty(xs: ConvexPolytopeUnion): boolean {
        for (let x of xs) {
            if (!x.isEmpty) {
                return false;
            }
        }
        return true;
    },

    extent(xs: ConvexPolytopeUnion): Vector[] {
        if (xs.length < 1) {
            throw new ValueError("Union is empty, cannot determine dim");
        }
        return xs.map(x => x.extent).reduce((ext, cur) => {
            linalg.assertEqualDims(ext.length, cur.length);
            return zip2map((a, b) => [a[0] < b[0] ? a[0] : b[0], a[1] < b[1] ? b[1] : a[1]], ext, cur);
        });
    },

    boundingBox(xs: ConvexPolytopeUnion): ConvexPolytope {
        let bbox = cartesian(...union.extent(xs));
        return polytopeType(xs[0].dim).hull(bbox);
    },

    // TODO: hull

    covers(xs: ConvexPolytopeUnion, ys: ConvexPolytopeUnion): boolean {
        return union.isEmpty(union.remove(ys, xs));
    },

    isSameAs(xs: ConvexPolytopeUnion, ys: ConvexPolytopeUnion): boolean {
        return union.covers(xs, ys) && union.covers(ys, xs);
    },

    disjunctify(xs: ConvexPolytopeUnion): ConvexPolytopeUnion {
        // Sort by volume in descending order (this should favour the removal
        // of small polytopes).
        let xxs = xs.sort((x, y) => y.volume - x.volume);
        let out = [];
        for (let xx of xxs) {
            if (out.length === 0) {
                out.push(xx);
            } else {
                out.push(...xx.remove(...out));
            }
        }
        return out.filter(p => !p.isEmpty);
    },

    simplify(xs: ConvexPolytopeUnion): ConvexPolytopeUnion {
        // TODO: merging
        return union.disjunctify(xs);
    },

    intersect(xs: ConvexPolytopeUnion, ys: ConvexPolytopeUnion): ConvexPolytopeUnion {
        let out = [];
        for (let x of xs) {
            for (let y of ys) {
                let intersection = x.intersect(y);
                if (!intersection.isEmpty) {
                    out.push(intersection);
                }
            }
        }
        return out;
    },

    remove(xs: ConvexPolytopeUnion, ys: ConvexPolytopeUnion): ConvexPolytopeUnion {
        let out = [];
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
        let bbox = union.boundingBox(xs);
        let complement = bbox.remove(...xs);
        // Apply Pontryagin difference also to bbox or else edges in xs that
        // are shared with bbox are not properly handled (necessary due to bbox
        // use for complement)
        return bbox.pontryagin(y).remove(...union.minkowski(complement, y.invert()));
    }

};

