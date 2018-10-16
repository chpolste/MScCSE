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


/* Item in the PolygonList */
class PolygonItem extends ObservableMixin<null> {

    +list: PolygonList;
    +polygon: ConvexPolytope;
    label: string;
    fill: [boolean, string];
    stroke: [boolean, string];

    constructor(list: PolygonList, polygon: ConvexPolytope, label: string): void {
        super();
        this.list = list;
        this.polygon = polygon;
        this.label = label;
        this.fill = [false, "#FFFFFF"];
        this.stroke = [true, "#000000"];
    }

    asShape(): Shape {
        return {
            kind: "polytope",
            vertices: this.polygon.vertices,
            style: {
                fill: this.fill[0] ? this.fill[1] : "none",
                stroke: this.stroke[0] ? this.stroke[1] : "none"
            }
        };
    }

    remove(): void {
        this.list.remove(this);
    }

    moveup(): void {
        this.list.moveup(this);
    }

    movedown(): void {
        this.list.movedown(this);
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


/* List of polygons with organization functionality */
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

    add(polygon: ConvexPolytope, name: string): void {
        const item = new PolygonItem(this, polygon, name);
        item.attach(() => this.notify());
        this.items.unshift(item);
        this.notify();
    }

    remove(item: PolygonItem): void {
        const idx = this.items.indexOf(item);
        if (idx > -1) {
            this.items.splice(idx, 1);
        }
        this.notify();
    }

    moveup(item: PolygonItem): void {
        const idx1 = this.items.indexOf(item);
        const idx2 = Math.max(idx1 - 1, 0)
        this.swap(idx1, idx2);
    }

    movedown(item: PolygonItem): void {
        const idx1 = this.items.indexOf(item);
        const idx2 = Math.min(idx1 + 1, this.items.length - 1)
        this.swap(idx1, idx2);
    }

    swap(idx1: number, idx2: number): void {
        const temp = this.items[idx1];
        this.items[idx1] = this.items[idx2];
        this.items[idx2] = temp;
        this.notify();
    }

}


/* Add a polygon the the top of the list */
class PolygonInput {

    +polygons: PolygonList;
    +node: HTMLDivElement;
    +inputForm: Input<InputForm>;
    +formContainer: HTMLDivElement;
    counter: number;

    constructor(polygons: PolygonList): void {
        this.polygons = polygons;

        this.formContainer = dom.DIV({ "class": "input-form-container" });
        this.inputForm = new SelectInput({
            "Hull": new HullInputForm()
        }, "Hull");
        this.inputForm.attach(() => this.handleChange());

        const submit = dom.BUTTON({}, ["add"]);
        submit.addEventListener("click", () => {
            try {
                const name = "Polygon #" + (this.counter++);
                this.polygons.add(this.inputForm.value.polygon, name);
            } catch (err) {
                console.log(err.message);
            }
        });

        this.node = dom.DIV({}, [
            dom.P({}, [this.inputForm.node, " ", submit]),
            this.formContainer
        ]);

        this.counter = 1;
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


/* Insert the polytope that is the hull of a set of points inserted by the user */
class HullInputForm implements InputForm {

    +node: HTMLTextAreaElement;
    
    constructor(): void {
        this.node = dom.TEXTAREA({ rows: "6", cols: "70" }, []);

    }

    get polygon(): ConvexPolytope {
        return Polygon.hull(JSON.parse(this.node.value));
    }
}


/* Edit the current selection from the list */
class SelectionView {

    +items: SelectableNodes<PolygonItem>;
    +node: HTMLDivElement;
    +inputs: { [string]: HTMLInputElement };
    +buttons: { [string]: HTMLInputElement };

    constructor(items: SelectableNodes<PolygonItem>): void {
        this.items = items;
        this.items.attach((isClick) => {
            if (isClick) this.handleChange();
        });

        // Input elements for properties of the item
        this.inputs = {
            label: dom.INPUT({ "type": "text", "id": "label", "size": "40" }),
            showFill: dom.INPUT({ "type": "checkbox" }),
            fill: dom.INPUT({ "type": "color" }),
            showStroke: dom.INPUT({ "type": "checkbox" }),
            stroke: dom.INPUT({ "type": "color" })
        };
        for (let name in this.inputs) {
            this.inputs[name].addEventListener("change", () => this.updateItem());
        }

        // Control elements for list organization
        this.buttons = {
            remove: dom.INPUT({ "type": "button", "value": "remove" }, []),
            moveup: dom.INPUT({ "type": "button", "value": "up" }, []),
            movedown: dom.INPUT({ "type": "button", "value": "down" }, [])
        };
        this.buttons.remove.addEventListener("click", () => {
            const item = this.items.selection;
            if (item != null) item.remove();
        });
        this.buttons.moveup.addEventListener("click", () => {
            const item = this.items.selection;
            if (item != null) item.moveup();
            // Restore the current selection
            this.items.selection = item;
        });
        this.buttons.movedown.addEventListener("click", () => {
            const item = this.items.selection;
            if (item != null) item.movedown();
            // Restore the current selection
            this.items.selection = item;
        });

        this.node = dom.DIV({ "class": "cols polygon-selection" }, [
            dom.DIV({ "class": "left" }, [
                dom.DIV({}, [this.inputs.label]),
                dom.DIV({}, [this.buttons.remove, " :: ", this.buttons.movedown, this.buttons.moveup])
            ]),
            dom.DIV({ "class": "right" }, [
                dom.DIV({}, ["fill ", this.inputs.showFill, this.inputs.fill]),
                dom.DIV({}, ["stroke ", this.inputs.showStroke, this.inputs.stroke])
            ])
        ]);
        this.handleChange();
    }

    handleChange(): void {
        const item = this.items.selection;
        for (let name in this.inputs) {
            this.inputs[name].disabled = item == null;
        }
        for (let name in this.buttons) {
            this.buttons[name].disabled = item == null;
        }
        // Label
        this.inputs.label.value = item == null ? "" : item.label;
        // Stroke color
        this.inputs.showStroke.checked = item != null && item.stroke[0];
        this.inputs.stroke.value = item != null ? item.stroke[1] : "#000000";
        // Fill color
        this.inputs.showFill.checked = item != null && item.fill[0];
        this.inputs.fill.value = item != null ? item.fill[1] : "#FFFFFF";
    }

    updateItem(): void {
        const item = this.items.selection;
        if (item != null) {
            // Modify the properties of the selected item
            item.label = this.inputs.label.value;
            item.stroke = [this.inputs.showStroke.checked, this.inputs.stroke.value];
            item.fill = [this.inputs.showFill.checked, this.inputs.fill.value];
            // The item should notify on change, but then there would be a lot
            // of unnecessary updates, so the notification is triggered
            // externally and the item does not notify on change.
            item.notify();
            // Restore the current selection
            this.items.selection = item;
        }
    }

}


/* Interactive, resizable plot of all polygons in the list */
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
        const shapes = this.polygons.items.map(_ => _.asShape());
        // So that topmost item is on top, add shapes in reverse
        this.layers.polygons.shapes = shapes.reverse();
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


/* Assemble the app */
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

