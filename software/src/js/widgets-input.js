// @flow
"use strict";

import type { Observable } from "./tools.js";
import type { Matrix } from "./linalg.js";
import type { KeyCallback } from "./domtools.js";

import * as dom from "./domtools.js";
import { arr, ObservableMixin } from "./tools.js";


export class ValidationError extends Error {};


// Common observable interface for input forms
export interface Input<T> extends Observable<null> {
    +node: HTMLElement;
    +handleChange: () => void;
    // Getter for the proper value (after type conversion, ...)
    +value: T;
    // Validity flag (value may not be usable if this is false)
    +isValid: boolean;
    // Text value of the field (before type conversion, value as serialized
    // string corresponding to how the user inputs it)
    text: string;
}


// Convenience function for associating keypresses with input fields. With each
// invocation of the returned closure, the next entry from the given list of
// texts is set. Wraps around.
export function inputTextRotation<T>(input: Input<T>, texts: string[]): KeyCallback {
    if (texts.length < 1) throw new Error("texts must contain at least one choice");
    return function () {
        const idx = texts.indexOf(input.text);
        input.text = idx < 0 ? texts[0] : texts[(idx + 1) % texts.length];
    }
}


// A one-line text input element
export class LineInput<T> extends ObservableMixin<null> implements Input<T> {

    +node: HTMLInputElement;
    +parse: (txt: string) => T;
    -size: number;

    constructor(parse: (txt: string) => T, size?: number, initialText?: string) {
        super();
        this.parse = parse;
        this.node = dom.create("input", { "type": "text" });
        if (size != null) {
            this.size = size;
        }
        if (initialText != null) {
            this.text = initialText;
        }
        this.node.addEventListener("change", () => this.handleChange());
    }

    get value(): T {
        return this.parse(this.text);
    }

    get text(): string {
        return this.node.value;
    }

    set text(text: string): void {
        this.node.value = text;
        this.handleChange();
    }

    get isValid(): boolean {
        return this.node.checkValidity();
    }

    set size(size: number): void {
        this.node.size = size;
    }

    handleChange(): void {
        try {
            this.value;
            this.node.setCustomValidity("");
        } catch (e) {
            this.node.setCustomValidity("Parse Error: " + e.message);
        }
        this.notify();
    }

}


// A textarea that is parsed line-by-line
export class MultiLineInput<T> extends ObservableMixin<null> implements Input<T[]> {

    +node: HTMLTextAreaElement;
    +parseLine: (txt: string) => T;
    -size: [number, number];

    constructor(parseLine: (txt: string) => T, size?: [number, number], initialText?: string) {
        super();
        this.node = dom.create("textarea");
        this.node.addEventListener("change", () => this.handleChange());
        this.parseLine = parseLine;
        if (size != null) {
            this.size = size;
        }
        if (initialText != null) {
            this.text = initialText;
        }
    }

    get value(): T[] {
        return this.text.split("\n").filter(line => line.length > 0).map((line, i) => {
            try {
                return this.parseLine(line);
            } catch (e) {
                e.message = "Line " + (i + 1) + ": " + e.message;
                throw e;
            }
        });
    }

    get text(): string {
        return this.node.value;
    }

    set text(text: string) {
        this.node.value = text;
        this.handleChange();
    }

    get isValid(): boolean {
        return this.node.checkValidity();
    }

    set size(size: [number, number]): void {
        this.node.rows = size[0];
        this.node.cols = size[1];
    }

    handleChange(): void {
        try {
            this.value;
            this.node.setCustomValidity("");
        } catch (e) {
            this.node.setCustomValidity("Parse Error: " + e.message);
        }
        this.notify();
    }

}


// A drop-down selection of a fixed set of values
export class SelectInput<T> extends ObservableMixin<null> implements Input<T> {

    +node: HTMLSelectElement;
    +options: { [string]: T };
    +isValid: boolean;

    constructor(options: { [string]: T }, initialText?: string): void {
        super();
        this.options = options;
        const optionNodes = [];
        for (let key in options) {
            optionNodes.push(dom.create("option", {}, [key]));
        }
        this.node = dom.create("select", {}, optionNodes);
        this.node.addEventListener("change", () => this.handleChange());
        this.text = (initialText != null && options.hasOwnProperty(initialText)) ? initialText : Object.keys(options)[0];
        this.isValid = true;
    }

    get value(): T {
        return this.options[this.text];
    }

    get text(): string {
        return this.node.value;
    }

    set text(text: string): void {
        if (!this.options.hasOwnProperty(text)) {
            throw new Error("text not in options");
        }
        this.node.value = text;
        this.handleChange();
    }

    handleChange(): void {
        this.notify();
    }

}


// A true/false switch
export class CheckboxInput extends ObservableMixin<null> implements Input<boolean> {

    +node: HTMLInputElement;
    +isValid: boolean;

    constructor(initialValue?: boolean): void {
        super();
        this.node = dom.create("input", { "type": "checkbox" });
        this.node.addEventListener("change", () => this.handleChange());
        this.node.checked = initialValue != null && initialValue;
        this.isValid = true;
    }

    get value(): boolean {
        return this.node.checked;
    }

    get text(): string {
        return this.value ? "t" : "f";
    }

    set text(text: string): void {
        this.node.checked = text === "t";
        this.handleChange();
    }

    handleChange(): void {
        this.notify();
    }

}


// A slider representing a range of numeric values
export class RangeInput extends ObservableMixin<null> implements Input<number> {

    +node: HTMLInputElement;
    +isValid: boolean;

    constructor(min: number, max: number, step: number, initialValue?: number): void {
        super();
        this.node = dom.create("input", {
            "type": "range",
            "min": String(min),
            "max": String(max),
            "step": String(step),
            "value": initialValue != null ? String(initialValue) : String(min)
        });
        this.node.title = this.text;
        // Ranges should be highly-responsive, therefore listen to input events
        // instead of change events
        this.node.addEventListener("input", () => this.handleChange());
        this.isValid = true;
    }

    get value(): number {
        return parseFloat(this.node.value);
    }

    get text(): string {
        return this.node.value;
    }

    set text(text: string): void {
        if (parseFloat(text) !== NaN) {
            this.node.value = text;
        }
        this.handleChange();
    }

    handleChange(): void {
        this.node.title = this.text;
        this.notify();
    }

}


// A 2-dimensional grid of text inputs
export class MatrixInput<T> extends ObservableMixin<null> implements Input<T[][]> {
    
    +node: HTMLTableElement;
    +parse: (string) => T;
    lineInputs: LineInput<T>[];
    _shape: [number, number];
    shape: [number, number];
    _size: number;
    -size: number;

    constructor(parse: (string) => T, shape: [number, number], size: number, initialText?: string): void {
        super();
        this.parse = parse;
        this._shape = shape;
        this._size = size;
        this.node = dom.create("table", { "class": "matrix" });
        this._createLineInputs();
        if (initialText != null) {
            this.text = initialText;
        }
    }

    get value(): T[][] {
        let [nrows, ncols] = this._shape;
        let value = [];
        for (let i = 0; i < nrows; i++) {
            let row = [];
            for (let j = 0; j < ncols; j++) {
                row.push(this.lineInputs[i * ncols + j].value);
            }
            value.push(row);
        }
        return value;
    }

    get text(): string {
        return this.lineInputs.map(lineInput => lineInput.text).join("\n");
    }

    set text(text: string): void {
        this.isSendingNotifications = false;
        arr.zip2map((lineInput, text) => { lineInput.text = text; }, this.lineInputs, text.split("\n"));
        this.isSendingNotifications = true;
        this.handleChange();
    }

    get isValid(): boolean {
        for (let lineInput of this.lineInputs) {
            if (!lineInput.isValid) {
                return false;
            }
        }
        return true;
    }

    set size(size: number) {
        this._size = size;
        for (let lineInput of this.lineInputs) {
            lineInput.size = size;
        }
    }

    get shape(): [number, number] {
        return this._shape;
    }

    set shape(shape: [number, number]): void {
        let [nrowsOld, ncolsOld] = this._shape;
        let oldTexts = this.text.split("\n");
        this.isSendingNotifications = false;
        this._shape = shape;
        this._createLineInputs();
        let [nrows, ncols] = shape;
        for (let i = 0; i < Math.min(nrows, nrowsOld); i++) {
            for (let j = 0; j < Math.min(ncols, ncolsOld); j++) {
                this.lineInputs[i * ncols + j].text = oldTexts[i * ncolsOld + j];
            }
        }
        this.isSendingNotifications = true;
        this.handleChange();
    }

    _createLineInputs(): void {
        const [nrows, ncols] = this._shape;
        this.lineInputs = [];
        const callback = () => this.handleChange();
        const trs = [];
        for (let i = 0; i < nrows; i++) {
            let tds = [];
            for (let j = 0; j < ncols; j++) {
                let input: LineInput<T> = new LineInput(this.parse, this._size, "");
                input.attach(callback);
                tds.push(dom.create("td", {}, [input.node]));
                this.lineInputs.push(input);
            }
            trs.push(dom.create("tr", {}, tds));
        }
        dom.replaceChildren(this.node, trs);
    }

    handleChange(): void {
        this.notify();
    }

}


// A mutable collection of items (values), represented by user-defined DOM
// nodes and with associated select and hover events. An observer can
// distinguish between the two events using the boolean flag sent with the
// notification (true: select, false: hover). Nodes are generated from the
// items using the itemToNode function. A delimiter can be be inserted between
// nodes with the optional third argument. When the collection of items is
// empty the second emptyMessage argument of the constructor is shown.

type NodeCreator<T> = (T) => HTMLElement;

export class SelectableNodes<T> extends ObservableMixin<boolean> {
    
    +node: HTMLDivElement;
    +itemToNode: NodeCreator<T>;
    +delimiter: ?string;
    +emptyMessage: string;
    +nodeMap: Map<T, HTMLElement>; // TODO: conflict if same item is shown twice
    hoverSelection: ?T;
    _selection: ?T;

    constructor(itemToNode: NodeCreator<T>, emptyMessage: string, delimiter?: ?string): void {
        super();
        this.itemToNode = itemToNode;
        this.delimiter = delimiter;
        this.emptyMessage = emptyMessage;
        this._selection = null;
        this.hoverSelection = null;
        this.nodeMap = new Map();
        this.node = dom.div({}, [emptyMessage]);
    }

    set items(items: T[]): void {
        this.nodeMap.clear();
        this.selection = null;
        this.hoverSelection = null;
        if (items.length == 0) {
            this.node.innerHTML = this.emptyMessage;
        } else {
            let itemNodes = items.map(item => this.createNode(item));
            if (this.delimiter != null) {
                itemNodes = arr.intersperse(this.delimiter, itemNodes);
            }
            dom.replaceChildren(this.node, itemNodes);
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
            let selNode = this.nodeMap.get(item);
            if (selNode != null) {
                selNode.className = "item selection";
            } else {
                throw new ValidationError();
            }
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

