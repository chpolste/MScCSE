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


// HTML DOM nodes: returns the generic HTMLElement to be safe. I cannot figure
// out how to properly use the parametric nature of document.createElement so
// that the return type matches the tag.
export function create(tag: string, attributes?: ElementAttributes, children?: ElementChildren): HTMLElement {
    const node = document.createElement(tag);
    if (attributes != null) setAttributes(node, attributes);
    if (children != null) appendChildren(node, children);
    return node;
}

// Some common tags (with proper return types through any-casting)
export const A        = (a?: ElementAttributes, c?: ElementChildren) => ((create("a"       , a, c): any): HTMLAnchorElement);
export const BUTTON   = (a?: ElementAttributes, c?: ElementChildren) => ((create("button"  , a, c): any): HTMLButtonElement);
export const DIV      = (a?: ElementAttributes, c?: ElementChildren) => ((create("div"     , a, c): any): HTMLDivElement);
export const FORM     = (a?: ElementAttributes, c?: ElementChildren) => ((create("form"    , a, c): any): HTMLFormElement);
export const H3       = (a?: ElementAttributes, c?: ElementChildren) => ((create("h3"      , a, c): any): HTMLHeadingElement);
export const INPUT    = (a?: ElementAttributes, c?: ElementChildren) => ((create("input"   , a, c): any): HTMLInputElement);
export const LABEL    = (a?: ElementAttributes, c?: ElementChildren) => ((create("label"   , a, c): any): HTMLLabelElement);
export const P        = (a?: ElementAttributes, c?: ElementChildren) => ((create("p"       , a, c): any): HTMLParagraphElement);
export const SELECT   = (a?: ElementAttributes, c?: ElementChildren) => ((create("select"  , a, c): any): HTMLSelectElement);
export const SPAN     = (a?: ElementAttributes, c?: ElementChildren) => ((create("span"    , a, c): any): HTMLSpanElement);
export const TABLE    = (a?: ElementAttributes, c?: ElementChildren) => ((create("table"   , a, c): any): HTMLTableElement);
export const TEXTAREA = (a?: ElementAttributes, c?: ElementChildren) => ((create("textarea", a, c): any): HTMLTextAreaElement);

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
export function replaceChildren<T: ElementChild>(parentNode: Element, childNodes: Iterable<T>): void {
    let i = 0;
    for (let childNode of childNodes) {
        const oldNode = parentNode.childNodes[i];
        const newNode = nodeify(childNode);
        // Replace until old nodes run out
        if (oldNode != null) {
            parentNode.replaceChild(newNode, oldNode);
        // Add additional new nodes
        } else {
            parentNode.appendChild(newNode);
        }
        i++;
    }
    // Remove superfluous old nodes (if exist)
    while (parentNode.childNodes[i] != null) {
        parentNode.removeChild(parentNode.childNodes[i]);
    }
}

//
export function appendAfter(parent: Element, before: Element, after: Element): void {
    const sibling = before.nextSibling;
    if (sibling == null) {
        parent.appendChild(nodeify(after));
    } else {
        parent.insertBefore(nodeify(after), sibling);
    }
}


/* Mouse event helper */

export function createButton(a: ElementAttributes, c: ElementChildren, f: MouseEventListener): HTMLButtonElement {
    const button = BUTTON(a, c);
    button.addEventListener("click", f);
    return button;
}

// Test if related target of event is a child element of the given node. Use to
// discard mouseover/mouseout events that are triggered by moving over a nested
// element.
export function fromChildElement(node: Element, e: MouseEvent): boolean {
    let tgt = e.relatedTarget;
    if (tgt instanceof Node) {
        while (tgt != null && tgt !== node) {
            tgt = tgt.parentNode;
        }
    }
    return tgt === node;
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


/* String-Number label styling */

const SPLIT_LABEL_REGEX = /^([a-zA-Z]+)(\d+)$/;
const NUM_TSPAN_ATTRS = { "dy": "2", "font-size": "0.8em" };
export const snLabel = {
    
    // Split labels like X12 or p3 into ["X", "12"] or ["p", "13"]
    split: function (text: string): [string, string] {
        const match = SPLIT_LABEL_REGEX.exec(text);
        return (match == null) ? [text, ""] : [match[1], match[2]];
    },

    toTeX: function (text: string): string {
        const [name, num] = snLabel.split(text);
        return (num.length === 0) ? name : name + "_" + num;
    },

    toHTML: function (text: string): HTMLSpanElement {
        const [name, num] = snLabel.split(text);
        return SPAN({}, (num.length === 0) ? [name] : [name, create("sub", {}, [num])]);
    },

    toSVG: function (text: string): Element {
        const [name, num] = snLabel.split(text);
        return createSVG("text", {},
            (num.length === 0) ? [name] : [name, createSVG("tspan", NUM_TSPAN_ATTRS, [num])]
        );
    }

};


/* Inline Information display

A (?)-button that reveals an infobox specified elsewhere (identified by id)
next to it on hover.
*/

export function infoBox(contentID: string): HTMLDivElement {
    const node = DIV({ "class": "info-button" }, ["?"]);
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


