// @flow
"use strict";

import { zip2map, NotImplementedError } from "./tools.js";


export type Vector = number[];
export type Matrix = number[][];

export const TOL = exports.TOL = 1.0e-8;

export class DimensionMismatch extends Error {}
export class MathError extends Error {}


export function assertEqualDims(n: number, m: number): void {
    if (n != m) {
        throw new DimensionMismatch(String(n) + " != " + String(m));
    }
}


/* Vector operations */

export function norm2(v: Vector): number {
    return Math.sqrt(v.reduce((a, b) => a + b*b, 0));
}


/* Vector-Vector operations */

export function dot(v: Vector, w: Vector): number {
    assertEqualDims(v.length, w.length);
    return zip2map((a, b) => a * b, v, w).reduce((c, d) => c + d, 0);
}

export function add(v: Vector, w: Vector): Vector {
    assertEqualDims(v.length, w.length);
    return zip2map((a, b) => a + b, v, w);
}

export function sub(v: Vector, w: Vector): Vector {
    assertEqualDims(v.length, w.length);
    return zip2map((a, b) => a - b, v, w);
}

export function areClose(v: Vector, w: Vector): boolean {
    assertEqualDims(v.length, w.length);
    return norm2(zip2map((x, y) => x - y, v, w)) < TOL;
}


/* Matrix-Vector operations */

// Apply Matrix m to column Vector v (from left)
export function apply(m: Matrix, v: Vector): Vector {
    assertEqualDims(m[0].length, v.length);
    return m.map(row => dot(row, v));
}

// Apply Matrix m to row Vector v (from right)
export function applyRight(m: Matrix, v: Vector): Vector {
    return matmul([v], m)[0];
}


/* Matrix operations */

export function eye(size: number): Matrix {
    let m = [];
    for (let i = 0; i < size; i++) {
        let row = new Array(size);
        row.fill(0);
        row[i] = 1;
        m.push(row);
    }
    return m;
}

export function det(m: Matrix): number {
    assertEqualDims(m.length, m[0].length);
    switch (m.length) {
        case 1: return m[0][0];
        case 2: return m[0][0] * m[1][1] - m[0][1] * m[1][0];
        default: throw new NotImplementedError();
    }
}

export function inv(m: Matrix): Matrix {
    assertEqualDims(m.length, m[0].length);
    let d = det(m);
    if (Math.abs(d) < TOL) {
        throw new MathError("matrix not invertible");
    } else {
        switch (m.length) {
            case 1: return [[ 1 / d ]];
            case 2: return [[ m[1][1] / d, -m[0][1] / d],
                            [-m[1][0] / d,  m[0][0] / d]];
            default: throw new NotImplementedError();
        }
    }
}

export function transpose(m: Matrix): Matrix {
    let result = [];
    for (let j = 0; j < m[0].length; j++) {
        let row = [];
        for (let i = 0; i < m.length; i++) {
            row.push(m[i][j]);
        }
        result.push(row);
    }
    return result;
}


/* Matrix-Matrix operations */

export function matmul(m: Matrix, n: Matrix): Matrix {
    assertEqualDims(m[0].length, n.length);
    let result = [];
    for (let i = 0; i < m.length; i++) {
        let row = [];
        for (let j = 0; j < n[0].length; j++) {
            let akkumulator = 0;
            for (let k = 0; k < n.length; k++) {
                akkumulator = akkumulator + m[i][k] * n[k][j];
            }
            row.push(akkumulator);
        }
        result.push(row);
    }
    return result;
}

/* Minkowski sums/differences

Cannot generally use minkowski of ConvexPolytope for polytopic operators, since
intermediate terms may be lower-dimensional
*/
export const minkowski = {

    xmy(xs: Vector[], ys: Vector[]): Vector[] {
        let out = [];
        for (let x of xs) {
            for (let y of ys) {
                out.push(sub(x, y));
            }
        }
        return out;
    },

    axpy(A: Matrix, xs: Vector[], ys: Vector[]): Vector[] {
        let out = [];
        for (let x of xs) {
            let Ax = apply(A, x);
            for (let y of ys) {
                out.push(add(Ax, y));
            }
        }
        return out;
    }

};

