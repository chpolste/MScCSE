// @flow
"use strict";


export type ElementAttributes = { [string]: string };
export type ElementEvents = { [string]: () => void };
type ElementChild = Element | string;
type ElementCreator = (tag: string, attributes?: ElementAttributes, children?: ElementChild[]) => Element;

export function createElementFactory(create: (tag: string) => Element): ElementCreator {
    return function (tag, attributes, children) {
        let node = create(tag);
        if (attributes != null) {
            for (let attr in attributes) {
                node.setAttribute(attr, attributes[attr]);
            }
        }
        if (children != null) {
            for (let child of children) {
                node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
            }
        }
        return node;
    }
}

export const SVGNS = "http://www.w3.org/2000/svg";

export const createElement = createElementFactory(tag => document.createElement(tag));
export const createElementSVG = createElementFactory(tag => document.createElementNS(SVGNS, tag));

export function clearNode(node: Element) {
    while(node.firstChild) {
        node.removeChild(node.firstChild);
    }
    return node;
}

export function replaceNode(target: ?Element, substitute: ?Element): void {
    if (target != null && substitute != null) {
        let targetID = target.getAttribute("id");
        let substituteID = substitute.getAttribute("id");
        if (targetID != null && substituteID === null) {
            substitute.setAttribute("id", targetID);
        }
        target.replaceWith(substitute);
    }
}

export function appendChild(parentNode: ?Element, ...childNodes: (null|Element|string)[]) {
    if (parentNode != null) {
        for (let childNode of childNodes) {
            if (childNode != null) {
                parentNode.appendChild(typeof childNode === "string" ? document.createTextNode(childNode) : childNode);
            }
        }
    }
}

export function setAttributes(node: ?Element, attributes: ?ElementAttributes): void {
    if (node != null && attributes != null) {
        for (let name in attributes) {
            node.setAttribute(name, attributes[name]);
        }
    }
}

export function addEventListeners(node: ?Element, handlers: ?ElementEvents): void {
    if (node != null && handlers != null) {
        for (let event in handlers) {
            node.addEventListener(event, handlers[event]);
        }
    }
}


export function setCursor(cursor: string): void {
    let body = document.body;
    if (body != null) {
        body.style.cursor = cursor;
    }
}

