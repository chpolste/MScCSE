// @flow
"use strict";

import type { ElementAttributes, ElementEvents } from "./domtools.js";
import type { Observer, Observable } from "./tools.js";
import { ObservableMixin } from "./tools.js";


type ShapeExt = { style?: ElementAttributes, events?: ElementEvents };
export type Shape = ({ kind: "polytope", vertices: Point[] } & ShapeExt)
                  | ({ kind: "arrow", origin: Point, target: Point } & ShapeExt)
                  | ({ kind: "text", coords: Point, text: string} & ShapeExt)
                  | ({ kind: "vectorField", fun: Point => Point, n?: number[] } & ShapeExt);

export type Primitive = { kind: "polygon", points: Point[] }
                      | { kind: "arrow", origin: Point, target: Point }
                      | { kind: "text", coords: Point, text: string };



/* Figure */

export type LayeredFigureEvent = { event: string, layer: FigureLayer };
export interface LayeredFigure extends Observable<LayeredFigureEvent> {
    newLayer(style?: ElementAttributes): FigureLayer;
    layers: FigureLayer[];
}

export class Figure extends ObservableMixin<LayeredFigureEvent> implements LayeredFigure {

    layers: FigureLayer[];

    constructor(): void {
        super();
        this.layers = [];
    }

    newLayer(style?: ElementAttributes): FigureLayer {
        let layer = new Layer(this, style);
        this.layers.push(layer);
        this.notify({event: "newLayer", layer: layer});
        return layer;
    }

}


export type LayerEvent = null;
export interface FigureLayer extends Observable<LayerEvent> {
    constructor(figure: LayeredFigure, style?: ElementAttributes): void;
    +figure: LayeredFigure;
    +style: ElementAttributes;
    shapes: Shape[];
}

export class Layer extends ObservableMixin<LayerEvent> implements FigureLayer {

    +figure: LayeredFigure;
    +style: ElementAttributes;
    _shapes: Shape[];

    constructor(figure: LayeredFigure, style?: ElementAttributes): void {
        super();
        this.figure = figure;
        this._shapes = [];
        this.style = style != null ? style : {};
    }

    get shapes(): Shape[] {
        return this._shapes;
    }

    set shapes(shapes: Shape[]): void {
        this._shapes = shapes.slice();
        this.notify();
    }

}


 /* Projections */

type Point = number[];
type Range = [number, number];
type Tick = [number, string];

export interface Projection {
    fwd(p: Point): Point;
    bwd(p: Point): Point;
    project(shape: Shape): Primitive[];
    zoom(factor: number): Projection;
    translate(start: Point, end: Point): Projection;
    getXTicks(n: number): Tick[];
    getYTicks(n: number): Tick[];
}


function largestPowerOf10In(x: number): number {
    return Math.pow(10, Math.floor(Math.log10(x)));
}

function linearTicks(min: number, max: number, n: number): number[] {
    const diff = (max - min) / n;
    const lp10 = largestPowerOf10In(diff);
    const increment = Math.ceil(diff / lp10) * lp10
    let init;
    if (min <= 0 && 0 <= max) {
        init = 0;
    } else if (max - min > lp10 * 10) {
        init = Math.ceil(min / 10) * 10;
    } else {
        init = Math.ceil(min / lp10) * lp10;
    }
    const ticks = [];
    for (let i = init; i >= min; i = i - increment) ticks.push(i);
    for (let i = init + increment; i <= max; i = i + increment) ticks.push(i);
    return ticks.sort();
}


export class Cartesian2D implements Projection {

    +minX: number;
    +maxX: number;
    +minY: number;
    +maxY: number;
    +center: Point;
    
    constructor(limX: Range, limY: Range): void {
        this.minX = limX[0];
        this.maxX = limX[1];
        this.minY = limY[0];
        this.maxY = limY[1];
    }

    get center(): Point {
        return [(this.minX + this.maxX) / 2, (this.minY + this.maxY) / 2];
    }

    fwd(coords: Point): Point {
        let [x, y] = coords;
        return [(x - this.minX) / (this.maxX - this.minX),
                (y - this.minY) / (this.maxY - this.minY)];
    }

    bwd(coords: Point): Point {
        let [x, y] = coords;
        return [x * (this.maxX - this.minX) + this.minX,
                y * (this.maxY - this.minY) + this.minY];
    }

    project(shape: Shape): Primitive[] {
        let primitives = [];
        if (shape.kind === "polytope") {
            primitives.push({
                kind: "polygon",
                points: shape.vertices.map(vertex => this.fwd(vertex))
            });
        } else if (shape.kind === "arrow") {
            primitives.push({
                kind: "arrow",
                origin: this.fwd(shape.origin),
                target: this.fwd(shape.target)
            });
        } else if (shape.kind === "text") {
            primitives.push({ kind: "text", coords: this.fwd(shape.coords), text: shape.text });
        } else if (shape.kind === "vectorField") {
            for (let x of linearTicks(this.minX, this.maxX, shape.n == null ? 10 : shape.n[0])) {
                for (let y of linearTicks(this.minY, this.maxY, shape.n == null ? 10 : shape.n[1])) {
                    primitives.push({
                        kind: "arrow",
                        origin: this.fwd([x, y]),
                        target: this.fwd(shape.fun([x, y]))
                    });
                }
            }
        } else {
            throw new Error("unknown shape kind");
        }
        return primitives;
    }

    zoom(factor: number): Cartesian2D {
        let center = this.center;
        let lengthX = (this.maxX - this.minX) / 2;
        let lengthY = (this.maxY - this.minY) / 2;
        let limX = [center[0] - lengthX * factor, center[0] + lengthX * factor];
        let limY = [center[1] - lengthY * factor, center[1] + lengthY * factor];
        return new Cartesian2D(limX, limY);
    }

    translate(start: Point, end: Point): Cartesian2D {
        let diffX = end[0] - start[0];
        let diffY = end[1] - start[1];
        let limX = [this.minX - diffX, this.maxX - diffX];
        let limY = [this.minY - diffY, this.maxY - diffY];
        return new Cartesian2D(limX, limY);
    }

    getXTicks(n: number): Tick[] {
        return linearTicks(this.minX, this.maxX, n).map(t => [this.fwd([t, 0])[0], String(t)]);
    }

    getYTicks(n: number): Tick[] {
        return linearTicks(this.minY, this.maxY, n).map(t => [this.fwd([0, t])[1], String(t)]);
    }

}


export class Horizontal1D implements Projection {

    +min: number;
    +max: number;
    +center: Point;

    constructor(lim: Range): void {
        this.min = lim[0];
        this.max = lim[1];
    }

    get center(): Point {
        return [(this.min + this.max) / 2];
    }

    fwd(coords: Point): Point {
        return [(coords[0] - this.min) / (this.max - this.min), 0.5];
    }

    bwd(coords: Point): Point {
        return [coords[0] * (this.max - this.min) + this.min];
    }

    project(shape: Shape): Primitive[] {
        let primitives = [];
        if (shape.kind === "polytope") {
            if (shape.vertices.length < 2) {
                return [];
            }
            let [l, r] = shape.vertices.map(vertex => this.fwd(vertex));
            primitives.push({
                kind: "polygon",
                points: [[l[0], 0.6], [l[0], 0.4], [r[0], 0.4], [r[0], 0.6]]
            });
        } else if (shape.kind === "arrow") {
            primitives.push({ kind: "arrow", origin: this.fwd(shape.origin), target: this.fwd(shape.target) });
        } else if (shape.kind === "text") {
            primitives.push({ kind: "text", coords: [shape.coords[0], 0.5], text: shape.text });
        } else if (shape.kind === "vectorField") {
            for (let x of linearTicks(this.min, this.max, shape.n == null ? 10 : shape.n[0])) {
                primitives.push({
                    kind: "arrow",
                    origin: this.fwd([x]),
                    target: this.fwd(shape.fun([x]))
                });
            }
        } else {
            throw new Error("unknown shape kind");
        }
        return primitives;
    }

    zoom(factor: number): Horizontal1D {
        let center = this.center[0];
        return new Horizontal1D([center - (center - this.min) * factor,
                                 center + (this.max - center) * factor]);
    }

    translate(start: Point, end: Point): Horizontal1D {
        let diff = end[0] - start[0];
        return new Horizontal1D([this.min - diff, this.max - diff]);
    }

    getXTicks(n: number): Tick[] {
        return linearTicks(this.min, this.max, n).map(t => [this.fwd([t])[0], String(t)]);
    }

    getYTicks(n: number): Tick[] {
        return [[0.5, "1D"]];
    }

}


const PADDING = 1.2;

export function autoProjection(aspectRatio: number, ...ranges: number[][]) : Projection {
    let dim = ranges.length;
    if (dim == 0) {
        return new Cartesian2D([NaN, NaN], [NaN, NaN]);
    } else if (dim == 1) {
        let [min, max] = ranges[0];
        let radius = (max - min) / 2 * PADDING;
        let mid = (min + max) / 2;
        return new Horizontal1D([mid - radius, mid + radius]);
    } else if (dim == 2) {
        let [minX, maxX] = ranges[0];
        let [minY, maxY] = ranges[1];
        let radiusX = (maxX - minX) / 2 * PADDING;
        let radiusY = (maxY - minY) / 2 * PADDING;
        let midX = (minX + maxX) / 2;
        let midY = (minY + maxY) / 2;
        let ratio = radiusX / radiusY;
        let factorX = ratio < aspectRatio ? aspectRatio / ratio : 1;
        let factorY = ratio > aspectRatio ? ratio / aspectRatio : 1;
        return new Cartesian2D([midX - radiusX * factorX, midX + radiusX * factorX],
                               [midY - radiusY * factorY, midY + radiusY * factorY]);
    } else {
        throw new Error("dim not supported");
    }
}

