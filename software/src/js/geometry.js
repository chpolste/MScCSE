// @flow
"use strict";

import type { Vector, Matrix } from "./linalg.js";

import * as linalg from "./linalg.js";
import { zip2map, cyc2map, NotImplementedError, ValueError, ParseError } from "./tools.js";



export const TOL = linalg.TOL;

// Will not work correctly if T is a list (flattens)!
function cartesian<T>(...tuples: T[][]): T[][] {
    let cart = [[]];
    for (let tuple of tuples) {
        cart = [].concat(...cart.map(xs => tuple.map(y => xs.concat([y]))));
    }
    return cart;
}


// 2D helpers

function angleCCW(v: Vector, w: Vector): number {
    let angle = Math.atan2(w[1], w[0]) - Math.atan2(v[1], v[0]);
    if (angle < -TOL) {
        return angle + 2 * Math.PI;
    } else if (angle < 0 || angle == 2 * Math.PI) {
        return 0;
    } else {
        return angle;
    }
}

function isCCWTurn(p: Vector, q: Vector, r: Vector): boolean {
    return (p[0] - r[0]) * (q[1] - r[1]) - (p[1] - r[1]) * (q[0] - r[0]) >= TOL;
}

function trapezoidalIntegrate(v: Vector, w: Vector): number {
    return 0.5 * (w[0] - v[0]) * (v[1] + w[1]);
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


// Parser helpers

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

export interface HalfspaceContainer {
    +dim: number;
    +halfspaces: Halfspace[]; // ordered (depends on dim) and non-redundant
}

export interface Halfspace extends HalfspaceContainer {
    +normal: Vector; // normalized to length 1
    +offset: number;
    flip(): Halfspace;
    contains(p: Vector): boolean;
    isSameAs(other: Halfspace): boolean;
    applyRight(m: Matrix): Halfspace;
}


export class HalfspaceInequation implements Halfspace {

    +dim: number;
    +normal: Vector;
    +offset: number;

    constructor(normal: Vector, offset: number): void {
        this.normal = normal;
        this.offset = offset;
        this.dim = normal.length;
    }

    static normalized(normal: Vector, offset: number): HalfspaceInequation {
        let norm = linalg.norm2(normal);
        if (norm == 0) {
            throw new linalg.MathError("div/0");
        }
        return new HalfspaceInequation(normal.map(x => x / norm), offset / norm);
    }

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

    applyRight(m: Matrix): HalfspaceInequation {
        return HalfspaceInequation.normalized(linalg.applyRight(m, this.normal), this.offset);
    }

}



/* Convex Polytopes */

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
    apply(m: Matrix): ConvexPolytope;
    applyRight(m: Matrix): ConvexPolytope;
    minkowski(other: ConvexPolytope): ConvexPolytope;
    split(...halfspaces: Halfspace[]): ConvexPolytope[];
    intersect(...others: HalfspaceContainer[]): ConvexPolytope;
    remove(...others: HalfspaceContainer[]): ConvexPolytope[];
    _HtoV(): void;
    _VtoH(): void;
}

interface ConvexPolytopeType {
    hull(points: Vector[]): ConvexPolytope;
    noredund(halfspaces: Halfspace[]): ConvexPolytope;
}


/* Abstract base class for convex polytopes 

Contains dimension-independent implementations. Contains stubs to implement the
ConvexPolytope interface, so that `this` can be used inside methods without
flow complaining (no other way to specify abstract methods). However, this
means that flow will not detect missing methods in the subtypes.
*/

class AbstractConvexPolytope implements ConvexPolytope {

    _vertices: ?Vector[];
    _halfspaces: ?Halfspace[];
    +dim: number;

    // Methods that have to be implemented by subtypes
    _VtoH() { throw new NotImplementedError() };
    _HtoV() { throw new NotImplementedError() };
    get volume() { throw new NotImplementedError() };

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

    get isEmpty(): boolean {
        return (this._vertices != null && this._vertices.length <= this.dim)
            || (this._halfspaces != null && this._halfspaces.length <= this.dim)
            || Math.abs(this.volume) < TOL;
    }

    get centroid(): Vector {
        let vertices = this.vertices;
        return vertices.reduce(linalg.add).map(x => x / vertices.length);
    }

    // Axis-aligned minimum bounding box
    get boundingBox(): ConvexPolytope {
        let bbox = cartesian(...this.extent);
        return polytopeType(this.dim).hull(bbox);
    }

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

    isSameAs(other: ConvexPolytope): boolean {
        let thisVertices = this.vertices;
        let otherVertices = other.vertices;
        if (this.dim != other.dim || thisVertices.length != otherVertices.length) {
            return false;
        }
        // Find common vertex
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
        linalg.assertEqualDims(v.length, this.dim);
        return polytopeType(this.dim).hull(this.vertices.map(x => linalg.add(x, v)));
    }

    apply(m: Matrix): ConvexPolytope {
        linalg.assertEqualDims(m[0].length, this.dim);
        return polytopeType(m.length).hull(this.vertices.map(v => linalg.apply(m, v)));
    }

    applyRight(m: Matrix): ConvexPolytope {
        linalg.assertEqualDims(m.length, this.dim);
        return polytopeType(m[0].length).noredund(this.halfspaces.map(h => h.applyRight(m)));
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

    split(...halfspaces: Halfspace[]): ConvexPolytope[] {
        if (halfspaces.length == 0) {
            return [this];
        }
        let rest = halfspaces.splice(1);
        let split1 = this.intersect(halfspaces[0]).split(...rest).filter(h => !h.isEmpty);
        let split2 = this.intersect(halfspaces[0].flip()).split(...rest).filter(h => !h.isEmpty);
        return split1.concat(split2)
    }

    intersect(...others: HalfspaceContainer[]): ConvexPolytope {
        let halfspaces = this.halfspaces.slice();
        for (let other of others) {
            linalg.assertEqualDims(this.dim, other.dim);
            halfspaces.push(...other.halfspaces);
        }
        return polytopeType(this.dim).noredund(halfspaces);
    }

    remove(...others: HalfspaceContainer[]): ConvexPolytope[] {
        let k = 0;
        while (this.intersect(others[k]).isEmpty) {
            k++;
            if (k == others.length) {
                return [this];
            }
        }
        let region = [];
        let poly = this;
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
            return new Interval([], []);
        } else {
            return new Interval([ps[leftIdx].slice(), ps[rightIdx].slice()], null);
        }
    }

    static noredund(hs: Halfspace[]): Interval {
        hs.map(h => linalg.assertEqualDims(h.dim, 1));
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
            return new Interval([], []);
        } else {
            return new Interval(null, [hs[leftIdx], hs[rightIdx]]);
        }
    }

    get volume(): number {
        let [left, right] = this.vertices;
        return right[0] - left[0];
    }

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

    static noredund(hs: Halfspace[]): Polygon {
        hs.map(h => linalg.assertEqualDims(h.dim, 2));
        // Sort by CCW angles relative to [0, -1, 0] (upper halfspace of
        // coordinate system)
        let halfplanes = hs.slice().sort(function (g, h) {
            return angleCCW([0, -1], g.normal) - angleCCW([0, -1], h.normal);
        });
        // Build tight loop
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
                return new Polygon([], []);
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
                return new Polygon([], []);
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
        // Return the left over loop, if still is a bounded region
        let out = ridx - lidx < 3 || angleCCW(loop[ridx - 1].normal, loop[lidx].normal) > Math.PI - TOL
                  ? []
                  : loop.slice(lidx, ridx);
        return new Polygon(null, out);
    }

    get volume(): number {
        // CCW ordering: negate trapezoidal integration
        return cyc2map(trapezoidalIntegrate, this.vertices).reduce((a, b) => a - b, 0);
    }

    _HtoV(): void {
        if (this._halfspaces == null) {
            throw new ValueError();
        } else {
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
            this._halfspaces = cyc2map(function (v, w) {
                return HalfspaceInequation.normalized([w[1] - v[1], v[0] - w[0]], v[0]*w[1] - w[0]*v[1]);
            }, this._vertices);
        }
    }

}


// Mapping: dimension -> ConvexPolytope type (required for polytope
// transformations that result in a change of dimensionality)
const _PolytopeTypes: (?ConvexPolytopeType)[] = [null, Interval, Polygon];

export function polytopeType(dim: number): ConvexPolytopeType {
    let polytopeType = _PolytopeTypes[dim];
    if (polytopeType == null) {
        throw new NotImplementedError();
    } else {
        return polytopeType;
    }
}

