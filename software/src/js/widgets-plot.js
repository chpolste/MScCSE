// @flow
"use strict";

import type { LayeredFigure, FigureLayer, Shape, Primitive, Projection } from "./figure.js";

import * as linalg from "./linalg.js";
import { setCursor, clearNode, createElement, createElementSVG, SVGNS,
         setAttributes, addEventListeners, appendChild } from "./domtools.js";


/* Plots */

function toStr(x: number): string {
    return x.toFixed(3);
}

type Range = [number, number];
export interface Plot {
    +node: Element;
    +figure: LayeredFigure;
    size: Range;
    projection: Projection;
    constructor(size: Range, figure: LayeredFigure, projection: Projection): void;
}

export class InteractivePlot implements Plot {

    +node: HTMLDivElement;
    +menu: Element;
    +figure: LayeredFigure;
    +axesPlot: AxesPlot;
    panningState: number[] | null;

    constructor(size: Range, figure: LayeredFigure, projection: Projection): void {
        let helpButton = createElement("a", {"title": "shift + mouse to pan and zoom"}, ["?"]);
        let resetButton = createElement("a", {"href": ""}, ["reset view"]);
        resetButton.addEventListener("click", (e: MouseEvent) => {
            this.projection = projection;
            e.preventDefault();
        });
        let saveButton = createElement("a", {"href": "", "download": "plot.svg"}, ["save"]);
        saveButton.addEventListener("click", () => {
            saveButton.setAttribute("href", "data:image/svg+xml;base64," + window.btoa(this.axesPlot.source));
        });
        this.menu = createElement("menu", {}, [resetButton, " · ", saveButton, " · ", helpButton]);
        this.axesPlot = new AxesPlot(size, figure, projection);
        this.node = document.createElement("div");
        this.node.className = "plot";
        this.node.appendChild(this.menu);
        this.node.appendChild(this.axesPlot.node);

        let shapePlot = this.axesPlot.shapePlot
        // Mousewheel zoom
        shapePlot.node.addEventListener("wheel", (e: WheelEvent) => {
            if (e.shiftKey) {
                this.projection = this.projection.zoom(e.deltaY > 0 ? 1.12 : 1/1.12);
                e.preventDefault();
            }
        });
        // Click-and-drag panning
        this.panningState = null;
        shapePlot.node.addEventListener("mouseleave", () => {
            if (this.panningState != null) {
                this.panningState = null;
                setCursor("auto");
            }
        });
        shapePlot.node.addEventListener("mousedown", (e: MouseEvent) => {
            if (e.buttons == 1 && e.shiftKey) {
                this.panningState = shapePlot.getCoords(e.clientX, e.clientY);
                e.preventDefault();
                setCursor("grabbing");
            }
        });
        shapePlot.node.addEventListener("mouseup", (e: MouseEvent) => {
            // click is triggered after mouseup, but only on same node
            if (this.panningState != null && e.target != shapePlot.node) {
                this.projection = this.projection.translate(this.panningState, shapePlot.getCoords(e.clientX, e.clientY));
                this.panningState = null;
                setCursor("auto");
                e.stopPropagation();
            }
        });
        shapePlot.node.addEventListener("click", (e: MouseEvent) => {
            if (this.panningState != null) {
                this.projection = this.projection.translate(this.panningState, shapePlot.getCoords(e.clientX, e.clientY));
                this.panningState = null;
                setCursor("auto");
                e.stopPropagation();
            }
        });
    }

    get size(): Range {
        return this.axesPlot.size;
    }

    set size(size: Range): void {
        this.axesPlot.size = size;
    }

    get projection(): Projection {
        return this.axesPlot.projection;
    }

    set projection(projection: Projection): void {
        this.axesPlot.projection = projection;
    }

    get figure(): LayeredFigure {
        return this.axesPlot.figure;
    }

}

export class AxesPlot implements Plot {

    +node: Element;
    +shapePlot: ShapePlot;
    +ticks: Element;
    +tickLabels: Element;
    +source: string;
    size: Range;
    projection: Projection;

    // TODO: wrap size
    constructor(size: [number, number], figure: LayeredFigure, projection: Projection): void {
        // Create and configure basic elements
        this.ticks = createElementSVG("g", {
            "stroke": "#000",
            "stroke-width": "1"
        });
        this.tickLabels = createElementSVG("g", {
            "font-family": "DejaVu Sans, sans-serif",
            "font-size": "8pt",
        });
        this.shapePlot = new ShapePlot(size, figure, projection);
        this.shapePlot.node.setAttribute("x", "5");
        this.shapePlot.node.setAttribute("y", "5");
        this.node = createElementSVG("svg", {xmlns: SVGNS}, [this.ticks, this.tickLabels, this.shapePlot.node]);
        this.draw();
    }

    get size(): Range {
        return this.shapePlot.size;
    }

    set size(size: Range): void {
        this.shapePlot.size = size;
        this.draw();
    }

    get figure(): LayeredFigure {
        return this.shapePlot.figure;
    }

    get projection(): Projection {
        return this.shapePlot.projection;
    }

    set projection(projection: Projection): void {
        this.shapePlot.projection = projection;
        this.draw();
    }

    get source(): string {
        return this.node.outerHTML;
    }

    draw(): void {
        let [sizeX, sizeY] = this.size;
        this.node.setAttribute("width", String(sizeX + 45))
        this.node.setAttribute("height", String(sizeY + 30))
        clearNode(this.ticks);
        clearNode(this.tickLabels);
        for (let tick of this.projection.getXTicks(Math.floor(sizeX / 60))) {
            let x = 5 + tick[0] * sizeX
            this._createTickLine(x, x, sizeY + 4, sizeY + 10);
            this._createTickLabel(x, sizeY + 25, "middle", tick[1]);
        }
        for (let tick of this.projection.getYTicks(Math.floor(sizeY / 30))) {
            let y = (1 - tick[0]) * sizeY + 5;
            this._createTickLine(4 + sizeX, 10 + sizeX, y, y);
            this._createTickLabel(15 + sizeX, y + 4, "start", tick[1]);
        }
    }

    _createTickLine(x1: number, x2: number, y1: number, y2: number): void {
        this.ticks.appendChild(createElementSVG("line", {
            "x1": toStr(x1), "y1": toStr(y1),
            "x2": toStr(x2), "y2": toStr(y2)
        }));
    }

    _createTickLabel(x: number, y: number, anchor: string, label: string): void {
        this.tickLabels.appendChild(createElementSVG("text", {
            "x": toStr(x), "y": toStr(y), "text-anchor": anchor
        }, [label]));
    }

}


export class ShapePlot implements Plot {

    +node: Element;
    +figure: LayeredFigure;
    +groups: ShapeGroup[];
    +_background: Element;
    +_border: Element;
    _sizeX: number;
    _sizeY: number;
    size: Range;
    _projection: Projection;
    projection: Projection;

    constructor(size: Range, figure: LayeredFigure, projection: Projection): void {
        this._projection = projection;
        this.figure = figure;
        // Observe figure and transfer existing layers
        this.figure.attach((e) => {
            if (e != null && e.event == "newLayer") {
                let group = new ShapeGroup(this, e.layer);
                this.groups.push(group);
            }
            this.draw();
        });
        this.groups = [];
        for (let layer of figure.layers) {
            this.groups.push(new ShapeGroup(this, layer));
        }
        // Background and border. The rect is also required to catch all events
        // with this.node properly, see https://stackoverflow.com/a/16923563
        this._background = createElementSVG("rect", {
            x: "0", y: "0",
            width: "0", height: "0",
            stroke: "none", fill: "#FFFFFF"
        });
        this._border = createElementSVG("rect", {
            x: "0.5", y: "0.5",
            width: "0", height: "0",
            stroke: "#000000", "stroke-width": "1", fill: "none"
        });
        this.node = createElementSVG("svg", {xmlns: SVGNS}); // TODO make anti-aliasing toggleable with shape-rendering
        this.size = size; // invokes initial this.draw().
    }

    get size(): Range {
        return [this._sizeX, this._sizeY];
    }

    set size(size: Range): void {
        this._sizeX = size[0];
        this._sizeY = size[1];
        this.node.setAttribute("width", String(this._sizeX));
        this.node.setAttribute("height", String(this._sizeY));
        this._background.setAttribute("width", String(this._sizeX));
        this._background.setAttribute("height", String(this._sizeY));
        this._border.setAttribute("width", String(this._sizeX - 1));
        this._border.setAttribute("height", String(this._sizeY - 1));
        this.draw();
    }

    get projection(): Projection {
        return this._projection;
    }

    set projection(projection: Projection): void {
        this._projection = projection;
        this.draw();
    }

    getCoords(clientX: number, clientY: number): number[] {
        let rect = this.node.getBoundingClientRect();
        let x = Math.floor(clientX - rect.left) / (rect.width- 1) * rect.width;
        let y = Math.floor(clientY - rect.top) / (rect.height - 1) * rect.height;
        return this.projection.bwd(this.scaleBwd([x, y]));
    }

    // Project from unit coordinates to SVG coordinates
    scaleFwd(coords: number[]): number[] {
        let [x, y] = coords;
        return [x * this._sizeX, (1 - y) * this._sizeY];
    }

    // Project from SVG coordinates to unit coordinates
    scaleBwd(coords: number[]): number[] {
        let x = coords[0] / this._sizeX;
        let y = 1 - coords[1] / this._sizeY;
        return [x, y];
    }

    project(shape: Shape) {
        return this.projection.project(shape);
    }

    draw(): void {
        clearNode(this.node);
        this.node.appendChild(this._background);
        for (let group of this.groups) {
            this.node.appendChild(group.node);
            group.draw();
        }
        this.node.appendChild(this._border);
    }

}


class ShapeGroup {

    +shapePlot: ShapePlot;
    +layer: FigureLayer;
    node: Element;

    constructor(shapePlot: ShapePlot, layer: FigureLayer): void {
        this.shapePlot = shapePlot;
        this.layer = layer;
        this.layer.attach(() => this.draw());
        this.node = createElementSVG("g", this.layer.style);
    }

    draw(): void {
        clearNode(this.node);
        let children = [];
        for (let shape of this.layer.shapes) {
            let primitives = this.shapePlot.project(shape);
            // A shape can turn into multiple primitives
            for (let primitive of primitives) {

                if (primitive.kind === "polygon") {
                    let node = createElementSVG("polygon", {
                        points: primitive.points.map(point => {
                            return this.shapePlot.scaleFwd(point).map(toStr).join(",");
                        }).join(" ")
                    });
                    setAttributes(node, shape.style);
                    addEventListeners(node, shape.events);
                    children.push(node);

                } else if (primitive.kind === "text") {
                    let xy = this.shapePlot.scaleFwd(primitive.coords);
                    let node = createElementSVG("text", {
                        x: toStr(xy[0]), y: toStr(xy[1])
                    }, [primitive.text]);
                    setAttributes(node, shape.style);
                    addEventListeners(node, shape.events);
                    children.push(node);

                } else if (primitive.kind === "arrow") {
                    let [x1, y1] = this.shapePlot.scaleFwd(primitive.origin);
                    let [x2, y2] = this.shapePlot.scaleFwd(primitive.target);
                    // Draw zero-length arrows as circles
                    if (linalg.areClose(primitive.origin, primitive.target)) {
                        let node = createElementSVG("circle", {
                            cx: toStr(x1), cy: toStr(y1), r: "3"
                        });
                        setAttributes(node, shape.style);
                        addEventListeners(node, shape.events);
                        children.push(node);
                    // Draw a line with a triangle at the end. Because there is
                    // no convenient way to apply styling to markers, they are
                    // not used and the triangle is painted explicitly.
                    } else {
                        let line = createElementSVG("line", {
                            x1: toStr(x1), y1: toStr(y1), x2: toStr(x2), y2: toStr(y2)
                        });
                        setAttributes(line, shape.style);
                        addEventListeners(line, shape.events);
                        // Vector from target to origin of vector, scaled to length 6
                        let sqrt2 = Math.sqrt(2);
                        let vec = [x2 - x1, y2 - y1];
                        let norm = linalg.norm2(vec);
                        vec = [6 * vec[0] / norm, 6 * vec[1] / norm];
                        // Rotate by 45° and -45° and subtract from endpoint to
                        // obtain other triangle points
                        let l = [x2 - (vec[0] - vec[1]) / sqrt2, y2 - (vec[0] + vec[1]) / sqrt2];
                        let r = [x2 - (vec[0] + vec[1]) / sqrt2, y2 - (vec[1] - vec[0]) / sqrt2];
                        let triangle = createElementSVG("polygon", {
                            points: [[x2, y2], l, r].map(p => p.map(toStr).join(",")).join(" ")
                        });
                        setAttributes(triangle, shape.style);
                        addEventListeners(triangle, shape.events);
                        children.push(line, triangle);
                    }

                } else {
                    throw new Error("unknown primitive");
                }

            }
        }
        appendChild(this.node, ...children);
    }

}

