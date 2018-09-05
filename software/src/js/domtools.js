// @flow
"use strict";


/* KaTeX wrapper */

export function renderTeX<T: HTMLElement>(tex: string, element: T): T {
    // $FlowFixMe
    katex.render(tex, element, { throwOnError: false });
    return element;
}


/* DOM Element Creation */

type ElementChild = Element | string;
type ElementChildren = ElementChild[];
export type ElementAttributes = { [string]: string };
export type ElementEvents = { [string]: () => void };


// HTML DOM nodes
export function create<T: HTMLElement>(tag: *, attributes?: ElementAttributes, children?: ElementChildren): T {
    const node = document.createElement(tag);
    if (attributes != null) setAttributes(node, attributes);
    if (children != null) appendChildren(node, children);
    return node;
}
// Some common tags
export const p = (attrs?: ElementAttributes, children?: ElementChildren) => create("p", attrs, children);
export const h3 = (attrs?: ElementAttributes, children?: ElementChildren) => create("h3", attrs, children);
export const div = (attrs?: ElementAttributes, children?: ElementChildren) => create("div", attrs, children);
export const span = (attrs?: ElementAttributes, children?: ElementChildren) => create("span", attrs, children);


// SVG DOM nodes
export const SVGNS = "http://www.w3.org/2000/svg";
export function createSVG(tag: *, attributes?: ElementAttributes, children?: ElementChildren): Element {
    const node = document.createElementNS(SVGNS, tag);
    if (attributes != null) setAttributes(node, attributes);
    if (children != null) appendChildren(node, children);
    return node;
}

// Automatic text node creation for strings
export function nodeify(item: ElementChild): Text|Element {
    return typeof item === "string" ? document.createTextNode(item) : item;
}


/* Node Convenience Functions */

export function setAttributes(node: Element, attributes: ElementAttributes): void {
    for (let name in attributes) {
        node.setAttribute(name, attributes[name]);
    }
}

export function addEventListeners(node: Element, handlers: ElementEvents): void {
    for (let event in handlers) {
        node.addEventListener(event, handlers[event]);
    }
}


/* Children Convenience Functions */

// Remove all children from a node
export function removeChildren(node: Element): void {
    while(node.firstChild) {
        node.removeChild(node.firstChild);
    }
}

// Append children while converting string children to text nodes
export function appendChildren(parentNode: Element, children: Iterable<ElementChild>) {
    for (let child of children) {
        parentNode.appendChild(nodeify(child));
    }
}

// Replace all children of a node with the given new ones
// TODO: the code could be nicer...
export function replaceChildren<T: ElementChild>(parentNode: Element, childNodes: T[]): void {
    // Get static list of current nodes
    const oldNodes = Array.from(parentNode.childNodes);
    const nOld = oldNodes.length;
    const nNew = childNodes.length;
    // Replace until old or new nodes run out
    let i = 0;
    while (i < nOld && i < nNew) {
        parentNode.replaceChild(nodeify(childNodes[i]), oldNodes[i]);
        i++;
    }
    // Remove superfluous old nodes (if exist)
    for (let j = i; j < nOld; j++) {
        parentNode.removeChild(oldNodes[j]);
    }
    // Add additional new nodes (if exist)
    for (let j = i; j < nNew; j++) {
        parentNode.appendChild(nodeify(childNodes[j]));
    }
}


/* Global Document State Management */

export function setCursor(cursor: string): void {
    let body = document.body;
    if (body != null) {
        body.style.cursor = cursor;
    }
}


export type KeyCallback = (event?: KeyboardEvent) => void;

export class Keybindings {

    +bindings: Map<string, KeyCallback>;

    constructor() {
        this.bindings = new Map();
        document.addEventListener("keypress", (e: KeyboardEvent) => this.keyPress(e));
    }

    bind(key: string, callback: KeyCallback): void {
        this.bindings.set(key, callback);
    }

    keyPress(event: KeyboardEvent): void {
        const callback = this.bindings.get(event.key);
        if (event.target === document.body && !event.ctrlKey && !event.altKey && callback != null) {
            callback(event);
        }
    }

}


/* Inline Information display

A (?)-button that reveals an infobox specified elsewhere (identified by id)
next to it on hover.
*/

export function infoBox(contentID: string): HTMLDivElement {
    const node = div({ "class": "info-button" }, ["?"]);
    node.addEventListener("mouseover", (e: MouseEvent) => {
        const content = document.getElementById(contentID);
        if (content != null) {
            content.style.display = "block";
            content.style.top = String(node.offsetTop) + "px";
            content.style.left = String(node.offsetLeft - content.offsetWidth - 5) + "px";
        }
    });
    node.addEventListener("mouseout", (e: MouseEvent) => {
        const content = document.getElementById(contentID);
        if (content != null) {
            content.style.display = "none";
        }
    });
    return node;
}


