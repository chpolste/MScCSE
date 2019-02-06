// @flow
"use strict";

import type { FigureLayer, Shape } from "./figure.js";
import type { JSONPolytope } from "./geometry.js";
import type { Input } from "./widgets-input.js";

import * as dom from "./dom.js";
import { Figure, autoProjection } from "./figure.js";
import { Polytope, Polygon, Union } from "./geometry.js";
import { ObservableMixin, n2s } from "./tools.js";
import { LineInput, SelectInput, SelectableNodes, MatrixInput } from "./widgets-input.js";
import { ShapePlot, InteractivePlot } from "./widgets-plot.js";


type Range = [number, number];

// Item Viewer widget
type ItemView = SelectableNodes<PolygonItem>;


// #123 to #112233
function longColor(color: string) {
    return color.length === 4 ? "#" + color[1] + color[1] + color[2] + color[2] + color[3] + color[3] : color;
}


export type JSONPolygonItem = [
    JSONPolytope,
    [boolean, string],
    [boolean, string],
    [boolean, string]
]

// Item in the PolygonList
class PolygonItem extends ObservableMixin<null> {

    +polygons: PolygonList;
    +polygon: Polytope;
    label: [boolean, string];
    fill: [boolean, string];
    stroke: [boolean, string];

    constructor(polygons: PolygonList, polygon: Polytope, label: string): void {
        super();
        this.polygons = polygons;
        this.polygon = polygon;
        this.label = [false, label];
        this.fill = [false, "#FFFFFF"];
        this.stroke = [true, "#000000"];
        this.attach(() => this.polygons.notify());
    }

    asShapes(): Shape[] {
        const shapes = [];
        // Polygon with styling
        shapes.push({
            kind: "polytope",
            vertices: this.polygon.vertices,
            style: {
                fill: this.fill[0] ? this.fill[1] : "none",
                stroke: this.stroke[0] ? this.stroke[1] : "none"
            }
        });
        // Label if enabled
        if (this.label[0]) shapes.push({
            kind: "label",
            coords: this.polygon.centroid,
            text: this.label[1],
            style: { dy: "3" }
        });
        return shapes;
    }

    remove(): void {
        this.polygons.remove(this);
    }

    moveup(): void {
        this.polygons.moveup(this);
    }

    movedown(): void {
        this.polygons.movedown(this);
    }

    serialize(): JSONPolygonItem {
        return [
            this.polygon.serialize(),
            this.label,
            this.fill,
            this.stroke
        ];
    }

    static deserialize(data: JSONPolygonItem, polygons: PolygonList): PolygonItem {
        const [poly, label, fill, stroke] = data;
        const item = new PolygonItem(polygons, Polygon.deserialize(poly), "");
        fill[1] = longColor(fill[1]);
        stroke[1] = longColor(stroke[1]);
        item.label = label;
        item.fill = fill;
        item.stroke = stroke;
        return item;
    }

    // Item to DOM element converter for SelectableNodes
    static toNode(item: PolygonItem): HTMLDivElement {
        const fig = new Figure();
        fig.newLayer().shapes = item.asShapes().filter(_ => _.kind === "polytope");
        const plot = new ShapePlot([40, 40], fig, autoProjection(1, ...item.polygon.extent), false);
        return dom.DIV({ "class": "poly" }, [
            dom.DIV({ "class": "left" }, [plot.node]),
            dom.DIV({ "class": "right" }, [
                dom.DIV({ "class": "label" }, [item.label[1]]),
                dom.DIV({}, [
                    "Hull: [",
                    item.polygon.vertices.map(_ => "[" + _.map(n => n2s(n, 2)).join(",") + "]").join(", "),
                    "]"
                ])
            ])
        ]);
    }

}


// List of polygons with organization functionality
class PolygonList extends ObservableMixin<null> {

    items: PolygonItem[];

    constructor(): void {
        super();
        this.items = [];
    }

    get length(): number {
        return this.items.length;
    }

    get extent(): Range[] {
        return this.items.length > 0 ? Union.from(this.items.map(_ => _.polygon)).extent : [];
    }

    // Insert a polygon at the top of the list
    add(polygon: Polytope, name: string): void {
        const item = new PolygonItem(this, polygon, name);
        this.items.unshift(item);
        this.notify();
    }

    // Remove the given item
    remove(item: PolygonItem): void {
        const idx = this.items.indexOf(item);
        if (idx > -1) {
            this.items.splice(idx, 1);
        }
        this.notify();
    }

    // Swap the given item with its upper neighbour
    moveup(item: PolygonItem): void {
        const idx1 = this.items.indexOf(item);
        const idx2 = Math.max(idx1 - 1, 0)
        this.swap(idx1, idx2);
    }

    // Swap the given item with its lower neighbour
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

    // Serialization
    serialize(): JSONPolygonItem[] {
        return this.items.map(_ => _.serialize());
    }

    deserialize(data: JSONPolygonItem[]): void {
        this.items = data.map(_ => PolygonItem.deserialize(_, this));
        this.notify();
    }

}


// Add a polygon the the top of the list
class PolygonInput {

    +polygons: PolygonList;
    +items: ItemView;
    +errorBox: HTMLDivElement;
    +formContainer: HTMLDivElement;
    +inputForm: Input<InputForm>;
    +node: HTMLDivElement;
    counter: number;

    constructor(polygons: PolygonList, items: ItemView): void {
        this.polygons = polygons;
        this.items = items;
        // Errors in polygon input are shown to the user
        this.errorBox = dom.DIV({ "class": "error" });
        // Different input methods are selectable from a drop-down menu
        this.formContainer = dom.DIV({ "class": "input-form-container" });
        this.inputForm = new SelectInput({
            "Hull": new HullInputForm(),
            "Transformation": new TransformationInputForm(items)
        }, "Hull");
        this.inputForm.attach(() => this.handleChange());
        // Add the polygon returned by the input form 
        const submit = dom.createButton({}, ["add"], () => this.addPolygon());
        // Build widget and initialize
        this.node = dom.DIV({}, [
            dom.P({}, [this.inputForm.node, " ", submit]),
            this.formContainer,
            this.errorBox
        ]);
        this.counter = 1;
        this.handleChange();
    }

    addPolygon(): void {
        const selection = this.items.selection;
        try {
            const [polygon, name] = this.inputForm.value.getPolygon(this);
            if (polygon.isEmpty) throw new Error("Polygon is empty");
            this.polygons.add(polygon, name);
            // Restore selection
            this.items.selection = selection;
            this.setError(null);
        } catch (err) {
            this.setError(err.message);
        }
    }

    setError(message: ?string): void {
        if (message == null) {
            dom.removeChildren(this.errorBox);
        } else {
            dom.replaceChildren(this.errorBox, [message]);
        }
    }

    genName(): string {
        return "Polygon #" + (this.counter++);
    }

    handleChange(): void {
        dom.replaceChildren(this.formContainer, [this.inputForm.value.node]);
        this.setError(null);
    }

}


interface InputForm {
    +node: HTMLElement;
    getPolygon(PolygonInput): [Polytope, string];
}

// Insert the polytope that is the hull of a set of points inserted by the user
class HullInputForm implements InputForm {

    +node: HTMLTextAreaElement;
    
    constructor(): void {
        this.node = dom.TEXTAREA({ rows: "6", cols: "70" }, []);
    }

    getPolygon(input: PolygonInput): [Polytope, string] {
        return [Polygon.hull(JSON.parse(this.node.value)), input.genName()];
    }
}

// Apply a 2 by 2 matrix to all vertices and/or translate the current selection
class TransformationInputForm implements InputForm {

    +items: ItemView;
    +matrix: Input<number[][]>;
    +vector: Input<number[][]>;
    +node: HTMLDivElement;

    constructor(items: ItemView): void {
        this.items = items;
        this.matrix = new MatrixInput(parseFloat, [2, 2], 4, "1\n0\n0\n1");
        this.vector = new MatrixInput(parseFloat, [2, 1], 4, "0\n0");
        this.node = dom.DIV({}, ["v' = ", this.matrix.node, "v + ", this.vector.node]);
    }

    getPolygon(input: PolygonInput): [Polytope, string] {
        const item = this.items.selection;
        if (item == null) throw new Error("No polygon selected");
        const matrix = this.matrix.value;
        const vector = this.vector.value;
        const polygon = item.polygon.apply(matrix).translate([vector[0][0], vector[1][0]]);
        return [polygon, "Transformation of " + item.label[1]];
    }

}


// Edit the current selection from the list
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
            showLabel: dom.INPUT({ "type": "checkbox" }),
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
        // Assemble the widget and initialize
        this.node = dom.DIV({ "class": "cols polygon-selection" }, [
            dom.DIV({ "class": "left" }, [
                dom.DIV({}, [this.inputs.label, this.inputs.showLabel]),
                dom.DIV({}, [this.buttons.remove, " :: ", this.buttons.movedown, this.buttons.moveup])
            ]),
            dom.DIV({ "class": "right" }, [
                dom.DIV({}, ["fill ", this.inputs.showFill, this.inputs.fill]),
                dom.DIV({}, ["stroke ", this.inputs.showStroke, this.inputs.stroke])
            ])
        ]);
        this.handleChange();
    }

    // (De-)Activate the form for the current selection
    handleChange(): void {
        const item = this.items.selection;
        for (let name in this.inputs) {
            this.inputs[name].disabled = item == null;
        }
        for (let name in this.buttons) {
            this.buttons[name].disabled = item == null;
        }
        // Label
        this.inputs.showLabel.checked = item != null && item.label[0];
        this.inputs.label.value = item == null ? "" : item.label[1];
        // Stroke color
        this.inputs.showStroke.checked = item != null && item.stroke[0];
        this.inputs.stroke.value = item != null ? item.stroke[1] : "#000000";
        // Fill color
        this.inputs.showFill.checked = item != null && item.fill[0];
        this.inputs.fill.value = item != null ? item.fill[1] : "#FFFFFF";
    }

    // On any change in the form input fields, update the item and trigger
    // a notification from the polygon list
    updateItem(): void {
        const item = this.items.selection;
        if (item != null) {
            // Modify the properties of the selected item
            item.label = [this.inputs.showLabel.checked, this.inputs.label.value];
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


// Interactive, resizable plot of all polygons in the list
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
        // Plot
        const fig = new Figure();
        this.layers = {
            polygons: fig.newLayer({ "font-family": "DejaVu Sans, sans-serif", "font-size": "8pt", "text-anchor": "middle" })
        };
        this.plot = new InteractivePlot([100, 100], fig, autoProjection(1));
        // Resize form
        this.plotSizeX = new LineInput(parseInt, 5, "700");
        this.plotSizeY = new LineInput(parseInt, 5, "500");
        this.plotSizeX.attach(() => this.resizePlot());
        this.plotSizeY.attach(() => this.resizePlot());
        // Assemble widget and initialize
        this.node = dom.DIV({}, [
            dom.DIV({ "class": "plot-settings" }, [
                "plot size: ", this.plotSizeX.node, " by ", this.plotSizeY.node
            ]),
            this.plot.node
        ]);
        this._lastNumberOfPolygons = 0;
        this.resizePlot();
    }

    get plotParameters(): [number, number, Range[]] {
        return [this.plotSizeX.value, this.plotSizeY.value, this.polygons.extent];
    }

    // Refresh the polygon layer
    drawPolygons(): void {
        if (this._lastNumberOfPolygons === 0) {
            this.resizePlot();
        } else {
            this.resetReferenceProjection();
        }
        const shapes = [];
        // So that topmost item is really on top, add shapes in reverse
        for (let i = this.polygons.length - 1; i >= 0; i--) {
            shapes.push(...this.polygons.items[i].asShapes());
        }
        this.layers.polygons.shapes = shapes;
        this._lastNumberOfPolygons = this.polygons.length;
    }

    // Resize the plot and adapt the projection
    resizePlot(): void {
        const [x, y, extent] = this.plotParameters;
        this.plot.size = [x, y];
        this.plot.projection = autoProjection(x/y, ...extent);
        this.resetReferenceProjection();
    }

    resetReferenceProjection(): void {
        const [x, y, extent] = this.plotParameters;
        this.plot.referenceProjection = autoProjection(x/y, ...extent);
    }

}


function toExportURL(polygons: PolygonList): string {
    const data = polygons.serialize();
    return window.btoa(JSON.stringify(data));
}

function fromExportURL(url: string, polygons: PolygonList): void {
    const data = JSON.parse(window.atob(url));
    polygons.deserialize(data);
}


// Assemble the app
document.addEventListener("DOMContentLoaded", function () {


    const polygons = new PolygonList();
    const plotView = new PlotView(polygons);
    const itemView = new SelectableNodes(PolygonItem.toNode, "no polygons");
    polygons.attach(() => {
        itemView.items = polygons.items;
    });
    const selectionView = new SelectionView(itemView);
    const input = new PolygonInput(polygons, itemView);

    // Build application
    const contentNode = document.getElementById("content");
    if (contentNode == null) throw new Error();
    dom.replaceChildren(contentNode, [
        dom.DIV({ "class": "left" }, [
            plotView.node,
            input.node
        ]),
        dom.DIV({ "class": "right" }, [
            selectionView.node,
            itemView.node
        ])
    ]);

    // Load from #-part of URL if set at startup
    if (window.location.hash.length > 0) {
        const hash = window.location.hash.substring(1);
        fromExportURL(hash, polygons);
    }

    // Keep #-part of URL updated after every change
    polygons.attach(() => {
        window.location.hash = "#" + toExportURL(polygons)
    });
    
});

