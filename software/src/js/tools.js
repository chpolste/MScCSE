// @flow
"use strict";

/* Error Types */

export class NotImplementedError extends Error {}
export class ValueError extends Error {}


/* Logical Connectives */

export function xor(p: boolean, q: boolean): boolean {
    return p ? !q : q;
}


/* Functional Helpers */

export function zip2map<A,B,C>(fun: (x: A, y: B) => C, xs: A[], ys: B[]): C[] {
    let zs = [];
    for (let i = 0; i < xs.length; i++) {
        zs[i] = fun(xs[i], ys[i]);
    }
    return zs;
}

export function cyc2map<A,B>(fun: (x: A, y: A) => B, xs: A[]): B[] {
    if (xs.length == 0) return [];
    const zs = [];
    for (let i = 0; i < xs.length - 1; i++) {
        zs.push(fun(xs[i], xs[i + 1]));
    }
    zs.push(fun(xs[xs.length - 1], xs[0]));
    return zs;
}

export function cyc2mapl<A,B>(fun: (x: A, y: A) => B, xs: A[]): B[] {
    if (xs.length == 0) return [];
    const zs = [fun(xs[xs.length - 1], xs[0])];
    for (let i = 0; i < xs.length - 1; i++) {
        zs.push(fun(xs[i], xs[i + 1]));
    }
    return zs;
}

export function merge<T>(comp: (x: T, y: T) => number, xs: T[], ys: T[]): T[] {
    let i = 0;
    let j = 0;
    const merged = [];
    while (i < xs.length && j < ys.length) {
        if (comp(xs[i], ys[j]) <= 0) {
            merged.push(xs[i++]);
        } else {
            merged.push(ys[j++]);
        }
    }
    while (i < xs.length) merged.push(xs[i++]);
    while (j < ys.length) merged.push(ys[j++]);
    return merged;
}

export function intersperse<T>(delim: T, items: T[]): T[] {
    const out = [];
    for (let item of items) {
        out.push(item);
        out.push(delim);
    }
    out.pop();
    return out;
}


/* Patterns */

/* Observer Pattern:

Automatically invoke callback functions (Observers) when the state of an
Observable changes. Supports push and push-update notifications.
*/

export type Observer<T> = (event?: T) => void;
export interface Observable<T> {
    attach(observer: Observer<T>): void;
    detach(observer: Observer<T>): void;
    isSendingNotifications: boolean;
    notify(event?: T): void;
}


// Basic callback management and notification distribution
export class ObservableMixin<T> implements Observable<T> {

    observers: Observer<T>[];
    isSendingNotifications: boolean;

    constructor() {
        this.observers = [];
        this.isSendingNotifications = true;
    }

    attach(observer: Observer<T>): void {
        this.observers.push(observer);
    }

    detach(observer: Observer<T>): void {
        let idx = this.observers.indexOf(observer);
        if (idx < 0) {
            throw new Error("observer was not attached");
        }
        this.observers.splice(idx, 1);
    }

    notify(event?: T): void {
        if (this.isSendingNotifications) {
            for (let observer of this.observers) {
                observer(event);
            }
        }
    }

}
