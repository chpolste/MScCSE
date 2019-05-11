// @flow
"use strict";

import type { JSONTrace } from "./controller.js";
import type { FigureLayer, Shape } from "./figure.js";
import type { JSONPolytope } from "./geometry.js";
import type { Vector } from "./linalg.js";
import type { Input } from "./widgets-input.js";

import * as dom from "./dom.js";
import { Figure, autoProjection } from "./figure.js";
import { Polytope, Union } from "./geometry.js";
import { just, ObservableMixin, n2s, arr } from "./tools.js";
import { LineInput, DropdownInput, MatrixInput } from "./widgets-input.js";
import { ShapePlot, InteractivePlot } from "./widgets-plot.js";


type Range = [number, number];

// Item Viewer widget
type ItemView = SelectableNodes<PolytopeItem>;

// A mutable collection of items (values), represented by user-defined DOM
// nodes and with associated select and hover events. An observer can
// distinguish between the two events using the boolean flag sent with the
// notification (true: select, false: hover). Nodes are generated from the
// items using the itemToNode function. When the collection of items is
// empty the second emptyMessage argument of the constructor is shown.

type NodeCreator<T> = (T) => HTMLElement;

export class SelectableNodes<T> extends ObservableMixin<boolean> {
    
    +node: HTMLDivElement;
    +itemToNode: NodeCreator<T>;
    +emptyMessage: string;
    +nodeMap: Map<T, HTMLElement>; // TODO: conflict if same item is shown twice
    hoverSelection: ?T;
    _selection: ?T;

    constructor(itemToNode: NodeCreator<T>, emptyMessage: string): void {
        super();
        this.itemToNode = itemToNode;
        this.emptyMessage = emptyMessage;
        this._selection = null;
        this.hoverSelection = null;
        this.nodeMap = new Map();
        this.node = dom.DIV({ "class": "items" }, [emptyMessage]);
    }

    set items(items: T[]): void {
        this.nodeMap.clear();
        this.selection = null;
        this.hoverSelection = null;
        if (items.length == 0) {
            this.node.innerHTML = this.emptyMessage;
        } else {
            dom.replaceChildren(this.node, items.map(item => this.createNode(item)));
        }
        this.notify();
    }

    get selection(): ?T {
        return this._selection;
    }

    set selection(item: ?T): void {
        if (this.selection != null) {
            let curNode = this.nodeMap.get(this.selection);
            if (curNode != null) {
                curNode.className = "item";
            }
        }
        if (item != null) {
            just(this.nodeMap.get(item)).className = "item selection";
        }
        this._selection = item;
        this.notify(true);
    }

    // Create a single node and attach all necessary event handlers
    createNode(item: T): Element {
        if (this.nodeMap.has(item)) throw new Error(
            "Duplicate item in nodeMap of SelectableNodes"
        );
        const node = this.itemToNode(item);
        node.className = "item";
        node.addEventListener("click", () => this.onClick(item));
        node.addEventListener("mouseover", () => this.onMouseOver(item));
        node.addEventListener("mouseout", () => this.onMouseOut(item));
        this.nodeMap.set(item, node);
        return node;
    }

    onClick(item: T): void {
        this.selection = this.selection === item ? null : item;
    }

    onMouseOver(item: T): void {
        this.hoverSelection = item;
        this.notify(false);
    }

    onMouseOut(item: T): void {
        this.hoverSelection = null;
        this.notify(false);
    }

}


// #123 to #112233
function longColor(color: string) {
    return color.length === 4 ? "#" + color[1] + color[1] + color[2] + color[2] + color[3] + color[3] : color;
}


export type JSONPolytopeItem = [
    JSONPolytope,
    [boolean, string],
    [boolean, string],
    [boolean, string]
]

// Item in the PolytopeList
class PolytopeItem extends ObservableMixin<null> {

    +polytopes: PolytopeList;
    +polytope: Polytope;
    label: [boolean, string];
    fill: [boolean, string];
    stroke: [boolean, string];

    constructor(polytopes: PolytopeList, polytope: Polytope, label: string): void {
        super();
        this.polytopes = polytopes;
        this.polytope = polytope;
        this.label = [false, label];
        this.fill = [false, "#FFFFFF"];
        this.stroke = [true, "#000000"];
        this.attach(() => this.polytopes.notify());
    }

    asShapes(): Shape[] {
        const shapes = [];
        // Polytope with styling
        shapes.push({
            kind: "polytope",
            vertices: this.polytope.vertices,
            style: {
                fill: this.fill[0] ? this.fill[1] : "none",
                stroke: this.stroke[0] ? this.stroke[1] : "none"
            }
        });
        // Label if enabled
        if (this.label[0]) shapes.push({
            kind: "label",
            coords: this.polytope.centroid,
            text: this.label[1],
            style: { dy: "3" }
        });
        return shapes;
    }

    remove(): void {
        this.polytopes.remove(this);
    }

    moveup(): void {
        this.polytopes.moveup(this);
    }

    movedown(): void {
        this.polytopes.movedown(this);
    }

    serialize(): JSONPolytopeItem {
        return [
            this.polytope.serialize(),
            this.label,
            this.fill,
            this.stroke
        ];
    }

    static deserialize(data: JSONPolytopeItem, polytopes: PolytopeList): PolytopeItem {
        const [poly, label, fill, stroke] = data;
        const item = new PolytopeItem(polytopes, Polytope.deserialize(poly), "");
        fill[1] = longColor(fill[1]);
        stroke[1] = longColor(stroke[1]);
        item.label = label;
        item.fill = fill;
        item.stroke = stroke;
        return item;
    }

    // Item to DOM element converter for SelectableNodes
    static toNode(item: PolytopeItem): HTMLDivElement {
        const fig = new Figure();
        fig.newLayer().shapes = item.asShapes().filter(_ => _.kind === "polytope");
        const plot = new ShapePlot([40, 40], fig, autoProjection(1, ...item.polytope.extent), false);
        return dom.DIV({ "class": "poly" }, [
            dom.DIV({ "class": "left" }, [plot.node]),
            dom.DIV({ "class": "right" }, [
                dom.DIV({ "class": "label" }, [item.label[1]]),
                dom.DIV({}, [
                    "Hull: [",
                    item.polytope.vertices.map(_ => "[" + _.map(n => n2s(n, 2)).join(",") + "]").join(", "),
                    "]"
                ])
            ])
        ]);
    }

}


// List of polytopes with organization functionality
class PolytopeList extends ObservableMixin<null> {

    items: PolytopeItem[];

    constructor(): void {
        super();
        this.items = [];
    }

    get length(): number {
        return this.items.length;
    }

    get extent(): Range[] {
        return this.items.length > 0 ? Union.from(this.items.map(_ => _.polytope)).extent : [];
    }

    // Insert a polytope at the top of the list
    add(polytope: Polytope, name: string): void {
        const item = new PolytopeItem(this, polytope, name);
        if (this.items.length === 0 || this.items[0].polytope.dim === polytope.dim) {
            this.items.unshift(item);
        } else throw new Error(
            "polytope dimension mismatch"
        );
        this.notify();
    }

    // Remove the given item
    remove(item: PolytopeItem): void {
        const idx = this.items.indexOf(item);
        if (idx > -1) {
            this.items.splice(idx, 1);
        }
        this.notify();
    }

    // Swap the given item with its upper neighbour
    moveup(item: PolytopeItem): void {
        const idx1 = this.items.indexOf(item);
        const idx2 = Math.max(idx1 - 1, 0)
        this.swap(idx1, idx2);
    }

    // Swap the given item with its lower neighbour
    movedown(item: PolytopeItem): void {
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
    save(): JSONPolytopeItem[] {
        return this.items.map(_ => _.serialize());
    }

    load(data: JSONPolytopeItem[]): void {
        this.items = [];
        for (let datum of data) {
            const item = PolytopeItem.deserialize(datum, this);
            if (this.items.length === 0 || this.items[0].polytope.dim === item.polytope.dim) {
                this.items.push(item);
            } else throw new Error(
                "polytope dimension mismatch"
            );
        }
        this.notify();
    }

}


class TraceContainer extends ObservableMixin<null> {

    _steps: [Vector, Vector][];

    constructor(): void {
        super();
        this._steps = [];
    }

    set steps(steps: [Vector, Vector][]): void {
        this._steps = steps;
        this.notify();
    }

    asShapes(): Shape[] {
        return this._steps.map(([x, y]) => ({
            kind: "arrow",
            origin: x,
            target: y
        }));
    }

    save(): [Vector, Vector][] {
        return this._steps;
    }

    load(json: [Vector, Vector][]): void {
        this.steps = json;
    }

}


// Add a polytope the the top of the list or add a trace
class InputField {

    +polytopes: PolytopeList;
    +trace: TraceContainer;
    +items: ItemView;
    +errorBox: HTMLDivElement;
    +inputBox: HTMLTextAreaElement;
    +node: HTMLDivElement;
    counter: number;

    constructor(polytopes: PolytopeList, trace: TraceContainer, items: ItemView): void {
        this.polytopes = polytopes;
        this.trace = trace;
        this.items = items;
        // Errors in polytope input are shown to the user
        this.errorBox = dom.DIV({ "class": "error" });
        // Input box
        this.inputBox = dom.TEXTAREA({ rows: "6", cols: "70" }, []);
        // Polytope input
        const submitPoly = dom.createButton({}, ["add hull"], () => this.addPolytope());
        const clearPoly = dom.createButton({}, ["clear all polytopes"], () => this.clearPolytopes());
        // Trace input
        const submitTrace = dom.createButton({}, ["add trace"], () => this.addTrace());
        const clearTrace = dom.createButton({}, ["clear trace"], () => this.clearTrace());
        // Build widget and initialize
        this.node = dom.DIV({}, [
            dom.P({}, [this.inputBox]),
            dom.P({}, [submitPoly, " ", clearPoly, " :: ", submitTrace, " ", clearTrace]),
            this.errorBox
        ]);
        this.counter = 1;
    }

    addPolytope(): void {
        const selection = this.items.selection;
        let vs = [];
        // Parse contents of vertex input textbox
        try {
            vs = JSON.parse(this.inputBox.value);
            if (vs.length === 0) throw new Error("Polytope is empty");
        } catch (err) {
            this.setError(err.message);
        }
        // Make polytope from vertices
        try {
            const dim = vs[0].length;
            const polytope = Polytope.ofDim(dim).hull(vs);
            const name = this.genName();
            this.polytopes.add(polytope, name);
            // Restore selection
            this.items.selection = selection;
            this.setError(null);
        } catch (err) {
            this.setError(err.message);
        }
    }

    clearPolytopes(): void {
        this.polytopes.load([]);
    }

    addTrace(): void {
        let steps = [];
        try {
            const json = JSON.parse(this.inputBox.value);
            for (let step of json) {
                steps.push([step.xOrigin[0], step.xTarget[0]]);
            }
            this.setError(null);
        } catch (err) {
            this.setError(err.message);
        }
        this.trace.steps = steps;
    }

    clearTrace(): void {
        this.trace.steps = [];
    }

    setError(message: ?string): void {
        if (message == null) {
            dom.removeChildren(this.errorBox);
        } else {
            dom.replaceChildren(this.errorBox, [message]);
        }
    }

    genName(): string {
        return "Polytope #" + (this.counter++);
    }

}



// Edit the current selection from the list
class SelectionView {

    +items: SelectableNodes<PolytopeItem>;
    +node: HTMLDivElement;
    +inputs: { [string]: HTMLInputElement };
    +buttons: { [string]: HTMLInputElement };

    constructor(items: SelectableNodes<PolytopeItem>): void {
        this.items = items;
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
        this.node = dom.DIV({ "class": "cols polytope-selection" }, [
            dom.DIV({ "class": "left" }, [
                dom.DIV({}, [this.inputs.label, this.inputs.showLabel]),
                dom.DIV({}, [this.buttons.remove, " :: ", this.buttons.movedown, this.buttons.moveup])
            ]),
            dom.DIV({ "class": "right" }, [
                dom.DIV({}, ["fill ", this.inputs.showFill, this.inputs.fill]),
                dom.DIV({}, ["stroke ", this.inputs.showStroke, this.inputs.stroke])
            ])
        ]);
        // When selection changes, update info bar. Initialize.
        this.items.attach((isClick) => {
            if (isClick) this.handleChange();
        }, true);
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
    // a notification from the polytope list
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


type ViewSettings = { size: ?Range };

// Interactive, resizable plot of all polytopes in the list
class PlotView extends ObservableMixin<null> {

    +polytopes: PolytopeList;
    +trace: TraceContainer;
    +plot: InteractivePlot;
    +layers: { [string]: FigureLayer };
    +plotSizeX: Input<number>;
    +plotSizeY: Input<number>;
    +node: HTMLDivElement;

    _lastNumberOfPolytopes: number;

    constructor(polytopes: PolytopeList, trace: TraceContainer): void {
        super();
        this.polytopes = polytopes;
        this.polytopes.attach(() => this.drawPolytopes());
        this.trace = trace;
        this.trace.attach(() => this.drawTrace());
        // Plot
        const fig = new Figure();
        this.layers = {
            polytopes: fig.newLayer({ "font-family": "DejaVu Sans, sans-serif", "font-size": "8pt", "text-anchor": "middle" }),
            arrows: fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#000" })
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
        this._lastNumberOfPolytopes = 0;
        this.resizePlot();
    }

    get plotParameters(): [number, number, Range[]] {
        return [this.plotSizeX.value, this.plotSizeY.value, this.polytopes.extent];
    }

    // Refresh the polytope layer
    drawPolytopes(): void {
        if (this._lastNumberOfPolytopes === 0) {
            this.resizePlot();
        } else {
            this.resetReferenceProjection();
        }
        const shapes = [];
        // So that topmost item is really on top, add shapes in reverse
        for (let i = this.polytopes.length - 1; i >= 0; i--) {
            shapes.push(...this.polytopes.items[i].asShapes());
        }
        this.layers.polytopes.shapes = shapes;
        this._lastNumberOfPolytopes = this.polytopes.length;
    }

    drawTrace(): void {
        this.layers.arrows.shapes = this.trace.asShapes();
    }

    // Resize the plot and adapt the projection
    resizePlot(): void {
        const [x, y, extent] = this.plotParameters;
        this.plot.size = [x, y];
        this.plot.projection = autoProjection(x/y, ...extent);
        this.resetReferenceProjection();
        this.notify();
    }

    resetReferenceProjection(): void {
        const [x, y, extent] = this.plotParameters;
        this.plot.referenceProjection = autoProjection(x/y, ...extent);
    }

    save(): ViewSettings {
        return {
            size: [this.plotSizeX.value, this.plotSizeY.value]
        };
    }

    load(data: ViewSettings): void {
        if (data.size != null) {
            const [sizeX, sizeY] = data.size;
            this.plotSizeX.text = sizeX.toString();
            this.plotSizeY.text = sizeY.toString();
        }
    }

}


function toExportURL(view: PlotView, polytopes: PolytopeList, trace: TraceContainer): string {
    const data = {
        view: view.save(),
        polytopes: polytopes.save(),
        trace: trace.save()
    };
    return window.btoa(JSON.stringify(data));
}

function fromExportURL(url: string, view: PlotView, polytopes: PolytopeList, trace: TraceContainer): void {
    const data = JSON.parse(window.atob(url));
    if (data.view != null) view.load(data.view);
    if (data.polytopes != null) polytopes.load(data.polytopes);
    if (data.trace != null) trace.load(data.trace);
}


// Assemble the app
document.addEventListener("DOMContentLoaded", function () {

    const polytopes = new PolytopeList();
    const trace = new TraceContainer();
    const plotView = new PlotView(polytopes, trace);
    const itemView = new SelectableNodes(PolytopeItem.toNode, "no polytopes");
    polytopes.attach(() => {
        itemView.items = polytopes.items;
    });
    const selectionView = new SelectionView(itemView);
    const input = new InputField(polytopes, trace, itemView);

    const keys = new dom.Keybindings();
    keys.bind("d", () => {
        const selection = itemView.selection;
        if (selection != null) selection.remove();
    });

    // Build application
    const contentNode = just(document.getElementById("content"));
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
        fromExportURL(hash, plotView, polytopes, trace);
    }

    // Keep #-part of URL updated after every change
    const updateHash = () => { window.location.hash = "#" + toExportURL(plotView, polytopes, trace) };
    plotView.attach(updateHash);
    polytopes.attach(updateHash);
    
});

