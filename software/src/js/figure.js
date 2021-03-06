// @flow
"use strict";

import type { ElementAttributes, ElementEvents } from "./dom.js";
import type { Observer, Observable } from "./tools.js";

import * as linalg from "./linalg.js";
import { n2s, ObservableMixin, xor } from "./tools.js";


type ShapeExt = { style?: ElementAttributes, events?: ElementEvents };
export type Shape = ({ kind: "polytope", vertices: Point[] } & ShapeExt)
                  | ({ kind: "arrow", origin: Point, target: Point } & ShapeExt)
                  | ({ kind: "marker", coords: Point, size: number } & ShapeExt)
                  | ({ kind: "label", coords: Point, text: string } & ShapeExt)
                  | ({ kind: "halfspace", normal: Point, offset: number } & ShapeExt)
                  | ({ kind: "vectorField", fun: (Point) => Point, scaling?: number, n?: number[] } & ShapeExt)
                  | ({ kind: "state", coords: Point, member: string } & ShapeExt)
                  | ({ kind: "transition", origin: Point, target: Point } & ShapeExt)
                  | ({ kind: "transitionLabel", origin: Point, target: Point, text: string } & ShapeExt)
                  | ({ kind: "loop", coords: Point, angle: number } & ShapeExt)
                  | ({ kind: "loopLabel", coords: Point, angle: number, text: string } & ShapeExt);

type Delta = [number, number];
type PrimitiveExt = { style?: ElementAttributes };
export type Primitive = ({ kind: "polygon", points: Point[] } & PrimitiveExt)
                      | ({ kind: "arrow", origin: Point, target: Point, deltaO?: Delta, deltaT?: Delta } & PrimitiveExt)
                      | ({ kind: "marker", coords: Point, size: number, delta?: Delta } & PrimitiveExt)
                      | ({ kind: "label", coords: Point, text: string } & PrimitiveExt)
                      | ({ kind: "loop", coords: Point, angle: number } & PrimitiveExt)
                      | ({ kind: "__label", text: string, p1: Point, p2: Point, offset: number } & PrimitiveExt);



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
    shapes: Iterable<Shape>;
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

    set shapes(shapes: Iterable<Shape>): void {
        this._shapes = Array.from(shapes);
        this.notify();
    }

}


 /* Projections */

type Point = number[];
type Range = [number, number];
type Tick = [number, string];

export interface Projection {
    // Project to normalized [0, 1] x [0, 1] coordinate system
    fwd(p: Point): Point;
    // Inverse projection (if possible)
    bwd(p: Point): Point;
    // Translate a shape to plottable primitives
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
        init = Math.ceil(min / lp10 / 10) * lp10 * 10;
    } else {
        init = Math.ceil(min / lp10) * lp10;
    }
    const ticks = [];
    for (let i = -n; i <= n; i++) {
        const tick = init + i * increment;
        if (min < tick && tick < max) ticks.push(tick);
    }
    return ticks;
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
        let primitives: Primitive[] = [];
        // 2-dimensional polytopes are polygons which are a primitive
        if (shape.kind === "polytope") {
            primitives.push({
                kind: "polygon",
                points: shape.vertices.map(vertex => this.fwd(vertex))
            });
        // arrow, label and marker are primitives
        } else if (shape.kind === "arrow") {
            primitives.push({
                kind: "arrow",
                origin: this.fwd(shape.origin),
                target: this.fwd(shape.target)
            });
        } else if (shape.kind === "label") {
            primitives.push({ kind: "label", coords: this.fwd(shape.coords), text: shape.text });
        } else if (shape.kind === "marker") {
            primitives.push({ kind: "marker", coords: this.fwd(shape.coords), size: shape.size });
        // Halfspaces are transformed into a polygon that covers the visible
        // part of the projection up to the halfspace edge
        } else if (shape.kind === "halfspace") {
            const normal = shape.normal;
            const offset = shape.offset;
            const cs = [
                [this.minX, this.minY], [this.minX, this.maxY],
                [this.maxX, this.maxY], [this.maxX, this.minY]
            ];
            const csIn = cs.map(v => linalg.dot(v, normal) - offset < linalg.TOL);
            // Move around rectangle and add corners and, if appropriate,
            // intersections of the halfplane-edge with the edges of the
            // rectangle
            const vertices = [];
            if (csIn[0]) vertices.push(cs[0]);
            if (xor(csIn[0], csIn[1])) vertices.push([cs[0][0], (offset - normal[0] * cs[0][0]) / normal[1]]);
            if (csIn[1]) vertices.push(cs[1]);
            if (xor(csIn[1], csIn[2])) vertices.push([(offset - normal[1] * cs[1][1]) / normal[0], cs[1][1]]);
            if (csIn[2]) vertices.push(cs[2]);
            if (xor(csIn[2], csIn[3])) vertices.push([cs[2][0], (offset - normal[0] * cs[2][0]) / normal[1]]);
            if (csIn[3]) vertices.push(cs[3]);
            if (xor(csIn[3], csIn[0])) vertices.push([(offset - normal[1] * cs[3][1]) / normal[0], cs[3][1]]);
            primitives.push({
                kind: "polygon",
                points: vertices.map(v => this.fwd(v))
            });
        // Vector fields are displayed as arrows and sampled using linearTicks
        } else if (shape.kind === "vectorField") {
            const s = shape.scaling == null ? 1 : shape.scaling;
            for (let x of linearTicks(this.minX, this.maxX, shape.n == null ? 10 : shape.n[0])) {
                for (let y of linearTicks(this.minY, this.maxY, shape.n == null ? 10 : shape.n[1])) {
                    // Scaling should happen in figure space
                    const o = this.fwd([x, y]);
                    const t = this.fwd(shape.fun([x, y]));
                    primitives.push({
                        kind: "arrow",
                        origin: o,
                        target: linalg.add(o, linalg.sub(t, o).map(_ => s * _))
                    });
                }
            }
        // Automata. This is not particularly sophisticated and only allows the
        // drawing of very simple automata.
        // States: fixed-size circles
        } else if (shape.kind === "state") {
            const coords = this.fwd(shape.coords);
            primitives.push({
                kind: "marker", coords: coords, size: 20,
                style: (shape.member.indexOf("E") !== -1 ? { "stroke-dasharray": "5 3"} : {})
            });
            // Inner circle
            if (shape.member.indexOf("F") !== -1) {
                primitives.push({ kind: "marker", coords: coords, size: 16 });
            }
        // Transitions: arrows (offset to the side, so back-and-forth arrows
        // don't overlap)
        } else if (shape.kind === "transition") {
            primitives.push({
                kind: "arrow", origin: this.fwd(shape.origin), target: this.fwd(shape.target),
                deltaO: [20, -6], deltaT: [-21, -6]
            });
        // Self-loop for states
        } else if (shape.kind === "loop") {
            primitives.push({ kind: "loop", coords: this.fwd(shape.coords), angle: shape.angle });
        // Special __label kind that takes position of transition/loop arrow
        // into account and tries not to overlap the label.
        } else if (shape.kind === "transitionLabel") {
            primitives.push({
                kind: "__label", text: shape.text,
                p1: this.fwd(shape.origin), p2: this.fwd(shape.target), offset: -17
            });
        } else if (shape.kind === "loopLabel") {
            const [x, y] = shape.coords;
            // 90° phase shifted (loop angle 0 is at 12 o'clock)
            const dx = Math.cos(Math.PI * shape.angle / 180);
            const dy = -Math.sin(Math.PI * shape.angle / 180);
            primitives.push({
                kind: "__label", text: shape.text,
                p1: this.fwd([x - dx, y - dy]), p2: this.fwd([x + dx, y + dy]), offset: -49 });

        } else {
            throw new Error("unknown shape kind '" + shape.kind + "' (Cartesian2D)");
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
        return linearTicks(this.minX, this.maxX, n).map(t => [this.fwd([t, 0])[0], n2s(t)]);
    }

    getYTicks(n: number): Tick[] {
        return linearTicks(this.minY, this.maxY, n).map(t => [this.fwd([0, t])[1], n2s(t)]);
    }

}


export class Horizontal1D implements Projection {

    +minX: number;
    +maxX: number;
    +minY: number;
    +maxY: number;

    constructor(lim: Range, ylim?: Range): void {
        this.minX = lim[0];
        this.maxX = lim[1];
        this.minY = ylim == null ? 0.4 : ylim[0];
        this.maxY = ylim == null ? 0.6 : ylim[1];
    }

    get center(): Point {
        return [(this.minX + this.maxX) / 2];
    }

    fwd(coords: Point): Point {
        return [(coords[0] - this.minX) / (this.maxX - this.minX), 0.5];
    }

    bwd(coords: Point): Point {
        return [coords[0] * (this.maxX - this.minX) + this.minX];
    }

    project(shape: Shape): Primitive[] {
        let primitives = [];
        // 1-dimensional polytopes are intervals, display with some height so
        // they are better visible and can be filled with color
        if (shape.kind === "polytope") {
            if (shape.vertices.length < 2) {
                return [];
            }
            let [l, r] = shape.vertices.map(vertex => this.fwd(vertex));
            primitives.push({
                kind: "polygon",
                points: [[l[0], this.maxY], [l[0], this.minY], [r[0], this.minY], [r[0], this.maxY]]
            });
        // arrow, label and marker are primitives
        } else if (shape.kind === "arrow") {
            primitives.push({ kind: "arrow", origin: this.fwd(shape.origin), target: this.fwd(shape.target) });
        } else if (shape.kind === "label") {
            primitives.push({ kind: "label", coords: this.fwd(shape.coords), text: shape.text });
        } else if (shape.kind === "marker") {
            primitives.push({ kind: "marker", coords: this.fwd(shape.coords), size: shape.size });
        } else if (shape.kind === "halfspace") {
            const normal = shape.normal;
            const offset = shape.offset;
            let left = 0;
            let right = 1;
            if (normal[0] < 0) {
                left = Math.max(left, this.fwd([-offset])[0]);
            } else {
                right = Math.min(right, this.fwd([offset])[0]);
            }
            if (left < right) {
                primitives.push({
                    kind: "polygon",
                    points: [[left, 0], [left, 1], [right, 1], [right, 0]]
                });
            }
        // Vector fields are displayed with arrows
        } else if (shape.kind === "vectorField") {
            const s = shape.scaling == null ? 1 : shape.scaling;
            for (let x of linearTicks(this.minX, this.maxX, shape.n == null ? 10 : shape.n[0])) {
                // Scaling should happen in figure space
                const o = this.fwd([x]);
                const t = this.fwd(shape.fun([x]));
                primitives.push({
                    kind: "arrow",
                    origin: o,
                    target: linalg.add(o, linalg.sub(t, o).map(_ => s * _))
                });
            }
        // Automata are not implemented for 1D Projection

        } else {
            throw new Error("unknown shape kind '" + shape.kind + "' (Horizontal1D)");
        }
        return primitives;
    }

    zoom(factor: number): Horizontal1D {
        let center = this.center[0];
        return new Horizontal1D(
            [center - (center - this.minX) * factor, center + (this.maxX - center) * factor],
            [this.minY, this.maxY]
        );
    }

    translate(start: Point, end: Point): Horizontal1D {
        let diff = end[0] - start[0];
        return new Horizontal1D([this.minX - diff, this.maxX - diff], [this.minY, this.maxY]);
    }

    getXTicks(n: number): Tick[] {
        return linearTicks(this.minX, this.maxX, n).map(t => [this.fwd([t])[0], n2s(t)]);
    }

    getYTicks(n: number): Tick[] {
        return [[0.5, "1D"]];
    }

}


const PADDING = 1.2;

export function autoProjection(aspectRatio: number, ...ranges: [number, number][]) : Projection {
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

