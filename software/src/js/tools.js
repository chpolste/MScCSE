// @flow
"use strict";

/* Error Types */

export class NotImplementedError extends Error {}
export class ValueError extends Error {}


/* Logical Connectives */

export function xor(p: boolean, q: boolean): boolean {
    return p ? !q : q;
}


/* Functional Helpers for Iterables */
export const iter = {

    or: function (xs: Iterable<boolean>): boolean {
        for (let x of xs) {
            if (x) return true;
        }
        return false;
    },

    and: function (xs: Iterable<boolean>): boolean {
        for (let x of xs) {
            if (!x) return false;
        }
        return true;
    },

    sum: function (xs: Iterable<number>): number {
        let s = 0;
        for (let x of xs) {
            s += x;
        }
        return s;
    },
    
    // Exhaust Iterable and return number of returned elements
    count: function <A>(xs: Iterable<A>): number {
        let c = 0;
        for (let x of xs) {
            c++;
        }
        return c;
    },

    // Apply a function to each returned element of the Iterable
    map: function* <A,B>(fun: (A) => B, xs: Iterable<A>): Iterator<B> {
        for (let x of xs) {
            yield fun(x);
        }
    },

    // Only keep elements of the Iterable that pass a test
    filter: function* <A>(test: (A) => boolean, xs: Iterable<A>): Iterator<A> {
        for (let x of xs) {
            if (test(x)) {
                yield x;
            }
        }
    },

    chain: function* <A>(...xss: Iterable<A>[]): Iterator<A> {
        for (let xs of xss) {
            yield* xs;
        }
    }

};


/* Functional Helpers for Arrays */

export const arr = {

    // Zip two arrays and apply a function to the tuples (arguments supplied
    // separately, not as tuples)
    zip2map: function <A,B,C>(fun: (x: A, y: B) => C, xs: A[], ys: B[]): C[] {
        let zs = [];
        for (let i = 0; i < xs.length; i++) {
            zs[i] = fun(xs[i], ys[i]);
        }
        return zs;
    },

    // Zip two arrays
    zip2: function <A,B>(xs: A[], ys: B[]): [A, B][] {
        return arr.zip2map((x, y) => [x, y], xs, ys);
    },

    // Apply function to tuples of subsequent elements in array, with wrap-around
    // at the end
    cyc2map: function <A,B>(fun: (x: A, y: A) => B, xs: A[]): B[] {
        if (xs.length == 0) return [];
        const zs = [];
        for (let i = 0; i < xs.length - 1; i++) {
            zs.push(fun(xs[i], xs[i + 1]));
        }
        zs.push(fun(xs[xs.length - 1], xs[0]));
        return zs;
    },

    // cyc2map but with wrap-around at the start
    cyc2mapl: function <A,B>(fun: (x: A, y: A) => B, xs: A[]): B[] {
        if (xs.length == 0) return [];
        const zs = [fun(xs[xs.length - 1], xs[0])];
        for (let i = 0; i < xs.length - 1; i++) {
            zs.push(fun(xs[i], xs[i + 1]));
        }
        return zs;
    },

    // Merge two sorted arrays into a sorted array
    merge: function <T>(comp: (x: T, y: T) => number, xs: T[], ys: T[]): T[] {
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
    },

    // Put a delimiter between elements of an array
    intersperse: function <T>(delim: T, items: T[]): T[] {
        const out = [];
        for (let item of items) {
            out.push(item);
            out.push(delim);
        }
        out.pop();
        return out;
    }

}


/* Set operations */

export const sets = {

    areEqual: function <T>(xs: Set<T>, ys: Set<T>): boolean {
        if (xs.size !== ys.size) {
            return false;
        }
        for (let y of ys) {
            if (!xs.has(y)) {
                return false;
            }
        }
        return true;
    },

    isSubset: function <T>(subs: Set<T>, sups: Set<T>): boolean {
        for (let sub of subs) {
            if (!sups.has(sub)) {
                return false;
            }
        }
        return true;
    },

    doIntersect: function <T>(xs: Set<T>, ys: Set<T>): boolean {
        for (let x of xs) {
            if (ys.has(x)) {
                return true;
            }
        }
        return false;
    },

    union: function <T>(...xss: Set<T>[]): Set<T> {
        return new Set(iter.chain(...xss));
    },

    intersection: function <T>(xs: Iterable<T>, ys: Set<T>): Set<T> {
        return new Set(iter.filter(x => ys.has(x), xs));
    },

    difference: function <T>(xs: Iterable<T>, ys: Set<T>): Set<T> {
        return new Set(iter.filter(x => !ys.has(x), xs));
    }

};


/* Hashing */

// Source: http://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/
export function hashString(s: string): number {
    let hash = 0;
    if (s.length !== 0) {
        for (let i = 0; i < s.length; i++) {
            hash  = ((hash << 5) - hash) + s.charCodeAt(i);
            hash |= 0; // Convert to 32bit integer
        }
    }
    return hash;
}


/* Formatting */

// Number to string
export function n2s(x: number): string {
    // TODO: Change to scientific notation when numbers are small
    return x.toFixed(5).replace(/\.?0*$/, "");
}

// Timespan in milliseconds to formatted string
const MSINS = 1000;
const MSINM = 60 * MSINS;
const MSINH = 60 * MSINM;
export function t2s(x: number): string {
    const hor = Math.floor(x / MSINH);
    const min = Math.floor((x - hor * MSINH) / MSINM);
    const sec = Math.floor((x - hor * MSINH - min * MSINM) / MSINS);
    if (sec === 0 && min === 0 && hor === 0) {
        return (x / 1000).toFixed(3) + " s";
    } else {
        const parts = [];
        if (hor > 0) parts.push(hor + " h");
        if (min > 0) parts.push(min + " min");
        if (sec > 0) parts.push(sec + " s");
        return parts.join(" ");
    }
}


/* Observer Pattern

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


/* UniqueCollection

A set of objects with a user-defined equality relation. Requesting an object
(take) that already exists in the collection, returns the object from the
collection. If no object equal to the requested one exists, it will be added.
By ensuring that always the same object of an equivalence class defined by the
equality relation is returned, JavaScript's === can be used while implicitly
adhering to the user-defined equality relation. This makes it possible to use
the built-in Set and Map as long as all elements are taken from the
UniqueCollection. Hashing of objects is used to speed up requests.
*/

type HashFunction<T> = (T) => number;
type EqualityTest<T> = (T, T) => boolean;

export class UniqueCollection<T> {

    +_hash: HashFunction<T>;
    +_areEqual: EqualityTest<T>;
    +_buckets: Map<number,Set<T>>;
    _size: number;

    constructor(hash: HashFunction<T>, areEqual: EqualityTest<T>): void {
        this._hash = hash;
        this._areEqual = areEqual;
        this._buckets = new Map();
        this._size = 0;
    }

    get size(): number {
        return this._size;
    }

    has(value: T): boolean {
        const hash = this._hash(value);
        const bucket = this._buckets.get(hash);
        if (bucket != null) {
            for (let item of bucket) {
                if (this._areEqual(item, value)) {
                    return true;
                }
            }
        }
        return false;
    }

    take(value: T): T {
        const hash = this._hash(value);
        let bucket = this._buckets.get(hash);
        // No bucket exists, create new and add value
        if (bucket == null) {
            bucket = this._newBucket(hash);
            bucket.add(value);
            this._size++;
            return value;
        }
        // Search bucket for value, return existing item...
        for (let item of bucket) {
            if (this._areEqual(item, value)) {
                return item;
            }
        }
        // ... or add value if not found
        bucket.add(value);
        this._size++;
        return value;
    }

    _newBucket(hash: number): Set<T> {
        const bucket = new Set();
        this._buckets.set(hash, bucket);
        return bucket;
    }

    // Flow is unable to deal with Symbols as method names and uses @@...
    // instead, therefore a bit of trickery is required to properly type the
    // iterator proctocol implementation:
    /*:: @@iterator(): Iterator<T> { return (({}: any): Iterator<T>); } */
    // $FlowFixMe
    *[Symbol.iterator]() {
        for (let values of this._buckets.values()) {
            yield* values;
        }
    }

}


/* Message management for Workers */

export class WorkerMessage {

    +communicator: WorkerCommunicator;
    +messageId: number;
    +kind: string;
    +data: mixed;
    +re: number;

    constructor(communicator: WorkerCommunicator, msg: Object): void {
        this.communicator = communicator;
        this.messageId = -1;
        if (msg.hasOwnProperty("messageId") && typeof msg.messageId === "number") {
            this.messageId = msg.messageId;
        }
        this.kind = "";
        if (msg.hasOwnProperty("kind") && typeof msg.kind === "string") {
            this.kind = msg.kind;
        }
        this.data = null;
        if (msg.hasOwnProperty("data")) {
            this.data = msg.data;
        }
        this.re = -1;
        if (msg.hasOwnProperty("re") && typeof msg.re === "number") {
            this.re = msg.re;
        }
    }

    get isAnswerable(): boolean {
        // No answers to answers
        return this.messageId >= 0 && this.re == -1;
    }

    answer(data: mixed): void {
        if (!this.isAnswerable) throw new Error(
            "Message is not answerable"
        );
        this.communicator.postMessage(this.kind, data, null, this.messageId);
    }

}

interface WorkerMessageHost {
    onmessage: null | (ev: MessageEvent) => any;
    postMessage(message: any, transfer?: Iterable<Object>): void;
}

type WorkerMessageCallback = (WorkerMessage) => void;

export class WorkerCommunicator {

    +host: WorkerMessageHost;
    +callbacks: Map<string | number | null, WorkerMessageCallback>;
    _id: number;

    constructor(host: WorkerMessageHost): void {
        this.host = host;
        this.host.onmessage = (e) => this._receive(e.data);
        this._id = 0;
        this.callbacks = new Map();
    }

    genId(): number {
        return this._id++;
    }

    postMessage(kind: string, data: mixed, callback?: ?WorkerMessageCallback, re?: number): void {
        const msg = { messageId: this.genId(), kind: kind, data: data, re: re != null ? re : -1 };
        if (callback != null) {
            this.callbacks.set(msg.messageId, callback);
        }
        this.host.postMessage(msg);
    }

    onMessage(kind: ?string, callback: WorkerMessageCallback): void {
        this.callbacks.set(kind == null ? null : kind, callback);
    }

    _receive(raw: mixed): void {
        if (typeof raw === "object" && raw != null) {
            const msg = new WorkerMessage(this, raw);
            let callback = null;
            // There may be a specialized callback for this response
            if (msg.re >= 0 && this.callbacks.has(msg.re)) {
                callback = this.callbacks.get(msg.re);
                // Each message is only answered once
                this.callbacks.delete(msg.re);
            }
            // There may be a specialized callback for this message kind
            if (msg.kind != null && this.callbacks.has(msg.kind)) {
                callback = this.callbacks.get(msg.kind);
            }
            // Fallback: default callback
            if (callback == null) {
                callback = this.callbacks.get(null);
            }
            // Invoke callback or ignore message if none applies
            if (callback != null) {
                try {
                    callback(msg);
                } catch (err) {
                    // Send error response if callback fails
                    if (msg.isAnswerable) {
                        this.postMessage("error", err.message, null, msg.messageId);
                    }
                    // Rethrow, so the error can be handled locally too
                    throw err;
                }
            }
        } else {
            throw new Error("recv err: " + JSON.stringify(raw));
        }
    }

}
