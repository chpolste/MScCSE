// @flow
"use strict";

import type { FigureLayer, Shape } from "./figure.js";
import type { ConvexPolytope } from "./geometry.js";
import type { Input } from "./widgets-input.js";

import * as dom from "./dom.js";
import { Figure, autoProjection } from "./figure.js";
import { Polygon, union } from "./geometry.js";
import { ObservableMixin, n2s } from "./tools.js";
import { LineInput, SelectInput, SelectableNodes } from "./widgets-input.js";
import { ShapePlot, InteractivePlot } from "./widgets-plot.js";


/* ... */

class PolygonItem extends ObservableMixin<null> {

    +list: PolygonList;
    +polygon: ConvexPolytope;
    label: string;
    fill: string;
    stroke: string;

    constructor(list: PolygonList, polygon: ConvexPolytope, label: string): void {
        super();
        this.list = list;
        this.polygon = polygon;
        this.label = label;
        this.fill = "none";
        this.stroke = "#000";
    }

    asShape(): Shape {
        return {
            kind: "polytope",
            vertices: this.polygon.vertices,
            style: {
                fill: this.fill,
                stroke: this.stroke
            }
        };
    }

    static toNode(item: PolygonItem): HTMLDivElement {
        const fig = new Figure();
        fig.newLayer().shapes = [item.asShape()];
        const plot = new ShapePlot([40, 40], fig, autoProjection(1, ...item.polygon.extent), false);
        return dom.DIV({ "class": "poly" }, [
            dom.DIV({ "class": "left" }, [plot.node]),
            dom.DIV({ "class": "right" }, [
                dom.DIV({ "class": "label" }, [item.label]),
                dom.DIV({}, [
                    "Hull: [",
                    item.polygon.vertices.map(_ => "[" + _.map(n => n2s(n, 2)).join(",") + "]").join(", "),
                    "]"
                ])
            ])
        ]);
    }

}


class PolygonList extends ObservableMixin<null> {

    items: PolygonItem[];

    constructor(): void {
        super();
        this.items = [];
    }

    get length(): number {
        return this.items.length;
    }

    get extent(): null|[number, number][] {
        return this.items.length > 0 ? union.extent(this.items.map(_ => _.polygon)) : null;
    }

    add(polygon: ConvexPolytope): void {
        const item = new PolygonItem(this, polygon, "Polygon");
        item.attach(() => this.notify());
        this.items.push(item);
        this.notify();
    }

}


/* ... */

class PolygonInput {

    +polygons: PolygonList;
    +node: HTMLDivElement;
    +inputForm: Input<InputForm>;
    +formContainer: HTMLDivElement;

    constructor(polygons: PolygonList): void {
        this.polygons = polygons;

        this.formContainer = dom.DIV({ "class": "input-form-container" });
        this.inputForm = new SelectInput({
            "hull": new VerticesInputForm()
        }, "hull");
        this.inputForm.attach(() => this.handleChange());

        const submit = dom.BUTTON({}, ["add"]);
        submit.addEventListener("click", () => {
            try {
                this.polygons.add(this.inputForm.value.polygon);
            } catch (err) {
                console.log(err.message);
            }
        });

        this.node = dom.DIV({}, [
            dom.P({}, [this.inputForm.node, " ", submit]),
            this.formContainer
        ]);

        this.handleChange();
    }

    handleChange(): void {
        dom.replaceChildren(this.formContainer, [this.inputForm.value.node]);
    }

}


interface InputForm {
    +node: HTMLElement;
    +polygon: ConvexPolytope;
}


class VerticesInputForm implements InputForm {

    +node: HTMLTextAreaElement;
    
    constructor(): void {
        this.node = dom.TEXTAREA({ rows: "6", cols: "50" }, []);

    }

    get polygon(): ConvexPolytope {
        return Polygon.hull(JSON.parse(this.node.value));
    }
}


/* ... */

class SelectionView {

    +list: SelectableNodes<PolygonItem>;
    +node: HTMLDivElement;
    +inputs: { [string]: HTMLInputElement };

    constructor(list: SelectableNodes<PolygonItem>): void {
        this.list = list;
        this.list.attach((isClick) => {
            if (isClick) this.handleChange();
        });

        this.inputs = {
            label: dom.INPUT({ "type": "text", "id": "label" }),
            fillYN: dom.INPUT({ "type": "checkbox" }),
            fill: dom.INPUT({ "type": "color" }),
            strokeYN: dom.INPUT({ "type": "checkbox" }),
            stroke: dom.INPUT({ "type": "color" })
        };

        for (let name in this.inputs) {
            this.inputs[name].addEventListener("change", () => this.updateItem());
        }

        this.node = dom.DIV({ "class": "cols polygon-selection" }, [
            dom.DIV({ "class": "left" }, [this.inputs.label]),
            dom.DIV({ "class": "right" }, [
                dom.DIV({}, ["fill ", this.inputs.fillYN, this.inputs.fill]),
                dom.DIV({}, ["stroke ", this.inputs.strokeYN, this.inputs.stroke])
            ])
        ]);
        this.handleChange();
    }

    handleChange(): void {
        const item = this.list.selection;
        for (let name in this.inputs) {
            this.inputs[name].disabled = item == null;
        }
        // Label
        this.inputs.label.value = item == null ? "" : item.label;
        // Stroke color
        this.inputs.strokeYN.checked = item != null && item.stroke !== "none";
        this.inputs.stroke.value = item != null && item.stroke !== "none" ? item.stroke : "#000000";
        // Fill color
        this.inputs.fillYN.checked = item != null && item.fill !== "none";
        this.inputs.fill.value = item != null && item.fill !== "none" ? item.fill : "#CCCCCC";
    }

    updateItem(): void {
        const item = this.list.selection;
        if (item != null) {
            item.label = this.inputs.label.value;
            item.stroke = this.inputs.strokeYN.checked ? this.inputs.stroke.value : "none";
            item.fill = this.inputs.fillYN.checked ? this.inputs.fill.value : "none";
            item.notify();
            this.list.selection = item;
        }
    }

}


/* ... */

class PlotView {

    +polygons: PolygonList;
    +plot: InteractivePlot;
    +layers: { [string]: FigureLayer };
    +plotSizeX: Input<number>;
    +plotSizeY: Input<number>;
    +node: HTMLDivElement;

    _lastNumberOfPolygons: number;

    constructor(polygons: PolygonList): void {
        this.polygons = polygons;
        this.polygons.attach(() => this.drawPolygons());
        // ...
        const fig = new Figure();
        this.layers = {
            highlight2: fig.newLayer({ "fill": "none", "stroke": "red", "stroke-width": "1" }),
            highlight1: fig.newLayer({ "fill": "#069" }),
            polygons:   fig.newLayer()
        };
        this.plot = new InteractivePlot([100, 100], fig, autoProjection(1));

        this.plotSizeX = new LineInput(_ => parseInt(_), 5, "700");
        this.plotSizeY = new LineInput(_ => parseInt(_), 5, "500");
        this.plotSizeX.attach(() => this.resizePlot());
        this.plotSizeY.attach(() => this.resizePlot());

        this.node = dom.DIV({}, [
            dom.DIV({ "class": "plot-settings" }, [
                "plot size: ", this.plotSizeX.node, " by ", this.plotSizeY.node
            ]),
            this.plot.node
        ]);

        this._lastNumberOfPolygons = 0;
        this.resizePlot();
    }

    drawPolygons(): void {
        if (this._lastNumberOfPolygons === 0) {
            this.resizePlot();
        }
        this.layers.polygons.shapes = this.polygons.items.map(_ => _.asShape());
        this._lastNumberOfPolygons = this.polygons.length;
    }

    resizePlot(): void {
        const x = this.plotSizeX.value;
        const y = this.plotSizeY.value;
        this.plot.size = [x, y];
        const extent = this.polygons.extent;
        if (extent == null) {
            this.plot.projection = autoProjection(x/y);
        } else {
            this.plot.projection = autoProjection(x/y, ...extent);
        }
        this.plot.referenceProjection = this.plot.projection;
    }

}



document.addEventListener("DOMContentLoaded", function () {

    const contentNode = document.getElementById("content");
    if (contentNode == null) throw new Error();

    const polygons = new PolygonList();
    const plotView = new PlotView(polygons);
    const listView = new SelectableNodes(PolygonItem.toNode, "no polygons");
    polygons.attach(() => {
        listView.items = polygons.items;
    });
    const selectionView = new SelectionView(listView);
    const input = new PolygonInput(polygons);

    // Build application
    dom.replaceChildren(contentNode, [
        dom.DIV({ "class": "left" }, [
            plotView.node,
            input.node
        ]),
        dom.DIV({ "class": "right" }, [
            selectionView.node,
            listView.node
        ])
    ]);

});

