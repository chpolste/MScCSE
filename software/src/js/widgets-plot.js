// @flow
"use strict";

import type { LayeredFigure, FigureLayer, Shape, Primitive, Projection } from "./figure.js";

import * as linalg from "./linalg.js";
import * as dom from "./dom.js";
import { obj, n2s } from "./tools.js";


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
}

export class InteractivePlot implements Plot {

    +node: HTMLDivElement;
    +menu: HTMLDivElement;
    +figure: LayeredFigure;
    +axesPlot: AxesPlot;
    _referenceProjection: Projection;

    constructor(size: Range, figure: LayeredFigure, projection: Projection): void {
        this._referenceProjection = projection;
        const resetButton = dom.create("a", {"href": ""}, ["reset"]);
        resetButton.addEventListener("click", (e: MouseEvent) => {
            this.projection = this._referenceProjection;
            e.preventDefault();
        });
        const saveButton = dom.create("a", {"href": "", "download": "plot.svg"}, ["export"]);
        saveButton.addEventListener("click", () => {
            saveButton.setAttribute("href", "data:image/svg+xml;base64," + window.btoa(this.axesPlot.source));
        });
        const coordsDisplay = dom.SPAN({ "class": "coords" });
        this.menu = dom.DIV({ "class": "menu" }, [
            coordsDisplay, "hold shift to pan and zoom :: ", resetButton, " :: ", saveButton
        ]);
        this.axesPlot = new AxesPlot(size, figure, projection);
        this.node = dom.DIV({ "class": "plot" }, [this.menu, this.axesPlot.node]);

        const shapePlot = this.axesPlot.shapePlot
        // Coordinate display
        shapePlot.node.addEventListener("mousemove", (e: MouseEvent) => {
            const [x, y] = shapePlot.getCoords(e.clientX, e.clientY);
            dom.replaceChildren(coordsDisplay, [n2s(x, 2) + ", " + n2s(y, 2)]);
        });
        // Mousewheel zoom
        shapePlot.node.addEventListener("wheel", (e: WheelEvent) => {
            if (e.shiftKey) {
                this.projection = this.projection.zoom(e.deltaY > 0 ? 1.12 : 1/1.12);
                e.preventDefault();
            }
        });
        // Click-and-drag panning
        let panningState: (number[] | null) = null;
        shapePlot.node.addEventListener("mouseleave", () => {
            dom.removeChildren(coordsDisplay);
            if (panningState != null) {
                panningState = null;
                dom.setCursor("auto");
            }
        });
        shapePlot.node.addEventListener("mousedown", (e: MouseEvent) => {
            if (e.buttons == 1 && e.shiftKey) {
                panningState = shapePlot.getCoords(e.clientX, e.clientY);
                e.preventDefault();
                dom.setCursor("grabbing");
            }
        });
        shapePlot.node.addEventListener("mouseup", (e: MouseEvent) => {
            // click is triggered after mouseup, but only on same node
            if (panningState != null && e.target != shapePlot.node) {
                this.projection = this.projection.translate(panningState, shapePlot.getCoords(e.clientX, e.clientY));
                panningState = null;
                dom.setCursor("auto");
                e.stopPropagation();
            }
        });
        shapePlot.node.addEventListener("click", (e: MouseEvent) => {
            if (panningState != null) {
                this.projection = this.projection.translate(panningState, shapePlot.getCoords(e.clientX, e.clientY));
                panningState = null;
                dom.setCursor("auto");
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

    set referenceProjection(projection: Projection): void {
        this._referenceProjection = projection;
    }

    get figure(): LayeredFigure {
        return this.axesPlot.figure;
    }

    addMenuElement(node: HTMLElement): void {
        dom.appendChildren(this.menu, [" :: ", node]);
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
        this.ticks = dom.createSVG("g", {
            "stroke": "#000",
            "stroke-width": "1"
        });
        this.tickLabels = dom.createSVG("g", {
            "font-family": "DejaVu Sans, sans-serif",
            "font-size": "8pt",
        });
        this.shapePlot = new ShapePlot(size, figure, projection);
        this.shapePlot.node.setAttribute("x", "5");
        this.shapePlot.node.setAttribute("y", "5");
        this.node = dom.createSVG("svg", {xmlns: dom.SVGNS}, [this.tickLabels, this.shapePlot.node, this.ticks]);
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
        this.node.setAttribute("height", String(sizeY + 25))
        const ticks = [];
        const labels = [];
        for (let tick of this.projection.getXTicks(Math.ceil(sizeX / 43))) {
            let x = 5 + tick[0] * sizeX
            ticks.push(this._createTickLine(x, x, sizeY + 1, sizeY + 4.5));
            labels.push(this._createTickLabel(x, sizeY + 20, "middle", tick[1]));
        }
        for (let tick of this.projection.getYTicks(Math.ceil(sizeY / 30))) {
            let y = (1 - tick[0]) * sizeY + 5;
            ticks.push(this._createTickLine(sizeX + 1, sizeX + 4.5, y, y));
            labels.push(this._createTickLabel(12 + sizeX, y + 4, "start", tick[1]));
        }
        dom.replaceChildren(this.ticks, ticks);
        dom.replaceChildren(this.tickLabels, labels);
    }

    _createTickLine(x1: number, x2: number, y1: number, y2: number): Element {
        return dom.createSVG("line", {
            "x1": toStr(x1), "y1": toStr(y1),
            "x2": toStr(x2), "y2": toStr(y2)
        });
    }

    _createTickLabel(x: number, y: number, anchor: string, label: string): Element {
        return dom.createSVG("text", {
            "x": toStr(x), "y": toStr(y), "text-anchor": anchor
        }, [label]);
    }

}


export class ShapePlot implements Plot {

    +node: Element;
    +figure: LayeredFigure;
    +groups: ShapeGroup[];
    +_background: Element;
    +_border: Element;
    +_drawBorder: boolean;
    _sizeX: number;
    _sizeY: number;
    size: Range;
    _projection: Projection;
    projection: Projection;

    constructor(size: Range, figure: LayeredFigure, projection: Projection, drawBorder?: boolean): void {
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
        this._background = dom.createSVG("rect", {
            x: "0", y: "0",
            width: "0", height: "0",
            stroke: "none", fill: "#FFFFFF"
        });
        // Border is drawn by default
        this._drawBorder = drawBorder == null || drawBorder;
        this._border = dom.createSVG("rect", {
            x: "0.5", y: "0.5",
            width: "0", height: "0",
            stroke: "#000000", "stroke-width": "1", fill: "none"
        });
        this.node = dom.createSVG("svg", {xmlns: dom.SVGNS}); // TODO make anti-aliasing toggleable with shape-rendering
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
        const children = [this._background];
        for (let group of this.groups) {
            children.push(group.node);
            group.draw();
        }
        if (this._drawBorder) {
            children.push(this._border);
        }
        dom.replaceChildren(this.node, children);
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
        this.node = dom.createSVG("g", this.layer.style);
    }

    draw(): void {
        const children = [];
        for (let shape of this.layer.shapes) {
            const primitives = this.shapePlot.project(shape);
            const shapeStyle = shape.style == null ? {} : shape.style;
            const events = shape.events == null ? {} : shape.events;
            // A shape can turn into multiple primitives
            for (let primitive of primitives) {
                const style = obj.merge(primitive.style == null ? {} : primitive.style, shapeStyle);

                if (primitive.kind === "polygon") {
                    let node = dom.createSVG("polygon", {
                        points: primitive.points.map(point => {
                            return this.fwd(point).map(toStr).join(",");
                        }).join(" ")
                    });
                    dom.setAttributes(node, style);
                    dom.addEventListeners(node, events);
                    children.push(node);

                } else if (primitive.kind === "label") {
                    let xy = this.fwd(primitive.coords);
                    let node = dom.snLabel.toSVG(primitive.text);
                    node.setAttribute("x", toStr(xy[0]));
                    node.setAttribute("y", toStr(xy[1]));
                    dom.setAttributes(node, style);
                    dom.addEventListeners(node, events);
                    children.push(node);

                } else if (primitive.kind === "marker") {
                    const [x, y] = this.fwd(primitive.coords);
                    const node = dom.createSVG("circle", {
                        cx: toStr(x), cy: toStr(y), r: toStr(primitive.size)
                    });
                    dom.setAttributes(node, style);
                    dom.addEventListeners(node, events);
                    children.push(node);

                } else if (primitive.kind === "arrow") {
                    let [x1, y1] = this.fwd(primitive.origin);
                    let [x2, y2] = this.fwd(primitive.target);
                    // Draw zero-length arrows as circles
                    if (linalg.areClose(primitive.origin, primitive.target)) {
                        const node = dom.createSVG("circle", {
                            cx: toStr(x1), cy: toStr(y1), r: "3"
                        });
                        dom.setAttributes(node, style);
                        dom.addEventListeners(node, events);
                        children.push(node);
                    } else {
                        // Vector from target to origin of vector, scaled to length 1
                        let nvec = [x2 - x1, y2 - y1]
                        let norm = linalg.norm2(nvec);
                        nvec = [nvec[0] / norm, nvec[1] / norm];
                        // Apply offset wrt arrow direction
                        if (primitive.deltaO != null) {
                            const [dxO, dyO] = primitive.deltaO;
                            x1 += dxO * nvec[0] - dyO * nvec[1];
                            y1 += dxO * nvec[1] + dyO * nvec[0];
                        }
                        if (primitive.deltaT != null) {
                            const [dxT, dyT] = primitive.deltaT;
                            x2 += dxT * nvec[0] - dyT * nvec[1];
                            y2 += dxT * nvec[1] + dyT * nvec[0];
                        }
                        // Draw a line with a triangle at the end. Because
                        // there is no convenient way to apply styling to
                        // markers, they are not used and the triangle is
                        // painted explicitly.
                        const line = dom.createSVG("line", {
                            x1: toStr(x1), y1: toStr(y1), x2: toStr(x2), y2: toStr(y2)
                        });
                        // Rotate by 45° and -45° and subtract from endpoint to
                        // obtain other triangle points.
                        const scale = 6 / Math.sqrt(2);
                        const l = [x2 - (nvec[0] - nvec[1]) * scale, y2 - (nvec[0] + nvec[1]) * scale];
                        const r = [x2 - (nvec[0] + nvec[1]) * scale, y2 - (nvec[1] - nvec[0]) * scale];
                        const triangle = dom.createSVG("polygon", {
                            points: [[x2, y2], l, r].map(p => p.map(toStr).join(",")).join(" ")
                        });
                        dom.setAttributes(line, style);
                        dom.addEventListeners(line, events);
                        dom.setAttributes(triangle, style);
                        dom.addEventListeners(triangle, events);
                        children.push(line, triangle);
                    }
                // Pre-drawn self-loop of state that is rotated into correct
                // position.
                } else if (primitive.kind === "loop") {
                    const [x, y] = this.fwd(primitive.coords);
                    const line = dom.createSVG("path", {
                        d: "M -6,-20 C -18,-35 -6,-40 0,-40 C 6,-40 18,-35 7,-22", fill: "none",
                        transform: "translate(" + toStr(x) + " " + toStr(y) + ") rotate(" + toStr(primitive.angle) + ")"
                    });
                    const triangle = dom.createSVG("polygon", {
                        points: "4.95,-26.63 12.63,-23.05 7,-21",
                        transform: "translate(" + toStr(x) + " " + toStr(y) + ") rotate(" + toStr(primitive.angle) + ")"
                    });
                    dom.setAttributes(line, style);
                    dom.addEventListeners(line, events);
                    dom.setAttributes(triangle, style);
                    dom.addEventListeners(triangle, events);
                    children.push(line, triangle);
                // Label in direction of an arrow, with orthogonal offset and
                // automatic text-anchor selection, so label does not intersect
                // with arrow. Main use case: automaton transition labels.
                } else if (primitive.kind === "__label") {
                    const [x1, y1] = this.fwd(primitive.p1);
                    const [x2, y2] = this.fwd(primitive.p2);
                    const nvec = [x2 - x1, y2 - y1];
                    const scale = -primitive.offset / linalg.norm2(nvec);
                    const x = 0.5 * (x1 + x2) + nvec[1] * scale;
                    const y = 0.5 * (y1 + y2) - nvec[0] * scale;
                    // Determine text-anchor based on angle of nvec
                    const angle = 180 * Math.atan2(nvec[1], nvec[0]) / Math.PI;
                    let textAnchor = "middle";
                    if (angle > 15 && angle < 165) textAnchor = "start"
                    if (angle < -15 && angle > -165) textAnchor = "end"
                    const text = dom.createSVG("text", {
                        "x": toStr(x), "y": toStr(y), "text-anchor": textAnchor,
                        "transform": "rotate(" + 0 + " " + toStr(x) + " " + toStr(y) + ")"
                    }, [primitive.text]);
                    dom.setAttributes(text, style);
                    dom.addEventListeners(text, events);
                    children.push(text);

                } else {
                    throw new Error("unknown primitive kind '" + primitive.kind + "'");
                }

            }
        }
        dom.replaceChildren(this.node, children);
    }

    // Project from [0, 1] coordinates to actual pixel coordinates
    fwd(coords: number[]): number[] {
        return this.shapePlot.scaleFwd(coords);
    }

}

