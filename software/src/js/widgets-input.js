// @flow
"use strict";

import type { Observable } from "./tools.js";
import type { Matrix } from "./linalg.js";

import { createElement, clearNode } from "./domtools.js";
import { ObservableMixin, zip2map } from "./tools.js";


export class ValidationError extends Error {};


export interface Input<T> extends Observable<null> {
    +node: HTMLElement;
    +changeHandler: () => void;
    +value: T;
    +isValid: boolean;
    text: string;
}


export class LineInput<T> extends ObservableMixin<null> implements Input<T> {

    +node: HTMLInputElement;
    +parse: (txt: string) => T;
    -size: number;

    constructor(parse: (txt: string) => T, size?: number, initialText?: string) {
        super();
        this.parse = parse;
        this.node = document.createElement("input");
        this.node.type = "text";
        if (size != null) {
            this.size = size;
        }
        if (initialText != null) {
            this.text = initialText;
        }
        this.node.addEventListener("change", () => this.changeHandler());
    }

    get value(): T {
        return this.parse(this.text);
    }

    get text(): string {
        return this.node.value;
    }

    set text(text: string): void {
        this.node.value = text;
        this.changeHandler();
    }

    get isValid(): boolean {
        return this.node.checkValidity();
    }

    set size(size: number): void {
        this.node.size = size;
    }

    changeHandler(): void {
        try {
            this.value;
            this.node.setCustomValidity("");
        } catch (e) {
            this.node.setCustomValidity("Parse Error: " + e.message);
        }
        this.notify();
    }

}


export class MultiLineInput<T> extends ObservableMixin<null> implements Input<T[]> {

    +node: HTMLTextAreaElement;
    +parseLine: (txt: string) => T;
    -size: [number, number];

    constructor(parseLine: (txt: string) => T, size?: [number, number], initialText?: string) {
        super();
        this.node = document.createElement("textarea");
        this.node.addEventListener("change", () => this.changeHandler());
        this.parseLine = parseLine;
        if (size != null) {
            this.size = size;
        }
        if (initialText != null) {
            this.text = initialText;
        }
    }

    get value(): T[] {
        return this.text.split("\n").filter(line => line.length > 0).map(this.parseLine);
    }

    get text(): string {
        return this.node.value;
    }

    set text(text: string) {
        this.node.value = text;
        this.changeHandler();
    }

    get isValid(): boolean {
        return this.node.checkValidity();
    }

    set size(size: [number, number]): void {
        this.node.rows = size[0];
        this.node.cols = size[1];
    }

    changeHandler(): void {
        try {
            this.value;
            this.node.setCustomValidity("");
        } catch (e) {
            this.node.setCustomValidity("Parse Error: " + e.message);
        }
        this.notify();
    }

}


/* Select Options */

export class SelectInput<T> extends ObservableMixin<null> implements Input<T> {

    +node: HTMLSelectElement;
    +options: { [string]: T };
    +isValid: boolean;

    constructor(options: { [string]: T }, initialText?: string): void {
        super();
        this.options = options;
        this.node = document.createElement("select");
        for (let key in options) {
            let optionNode = document.createElement("option");
            optionNode.innerHTML = String(key);
            this.node.appendChild(optionNode);
        }
        this.node.addEventListener("change", () => this.changeHandler());
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
        this.notify();
    }

    changeHandler(): void {
        this.notify();
    }

}


export class CheckboxInput extends ObservableMixin<null> implements Input<boolean> {

    +node: HTMLInputElement;
    +isValid: boolean;

    constructor(initialValue?: boolean): void {
        super();
        this.node = document.createElement("input");
        this.node.setAttribute("type", "checkbox");
        this.node.addEventListener("change", () => this.changeHandler());
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
    }

    changeHandler(): void {
        this.notify();
    }

}


/* Matrix */

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
        this.node = document.createElement("table");
        this.node.className = "matrix";
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
        zip2map((lineInput, text) => { lineInput.text = text; }, this.lineInputs, text.split("\n"));
        this.isSendingNotifications = true;
        this.changeHandler();
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
        this.changeHandler();
    }

    _createLineInputs(): void {
        clearNode(this.node);
        let [nrows, ncols] = this._shape;
        this.lineInputs = [];
        let callback = () => this.changeHandler();
        for (let i = 0; i < nrows; i++) {
            let tds = [];
            for (let j = 0; j < ncols; j++) {
                let input: LineInput<T> = new LineInput(this.parse, this._size, "");
                input.attach(callback);
                tds.push(createElement("td", {}, [input.node]));
                this.lineInputs.push(input);
            }
            this.node.appendChild(createElement("tr", {}, tds));
        }
    }

    changeHandler(): void {
        this.notify();
    }

}



