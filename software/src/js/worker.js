// @flow
"use strict";


interface MessageHost {
    onmessage: null | (ev: MessageEvent) => any;
    postMessage(message: any, transfer?: Iterable<Object>): void;
}

type Message = { kind: string, data: mixed, id: string };

type RequestHandler = (mixed) => mixed;


// Two-way promise-based communication using web workers
export class Communicator {

    +host: MessageHost;
    +_callbacks: Map<string, (Message) => void>;
    +_handlers: Map<string, RequestHandler>;
    +_idPrefix: string;
    _idCounter: number;

    constructor(host: MessageHost, idPrefix: string): void {
        this._idPrefix = idPrefix;
        this._idCounter = 0;
        this._callbacks = new Map();
        this._handlers = new Map();
        this.host = host;
        this.host.onmessage = (e) => this._receive(e.data);
    }

    request(kind: string, data?: mixed): Promise<mixed> {
        const message = {
            kind: kind,
            data: data,
            id: this._genId()
        };
        return new Promise((resolve, reject) => {
            this._callbacks.set(message.id, (answer) => {
                // Remove the callback
                this._callbacks.delete(message.id);
                // Reject promise on error
                if (answer.kind === "error") {
                    reject(new Error(answer.data));
                // Otherwise Resolve promise with returned data
                } else {
                    resolve(answer.data);
                }
            });
            this.host.postMessage(message);
        });
    }

    // Register a handler for incoming requests of the given kind
    onRequest(kind: string, handler: RequestHandler): void {
        this._handlers.set(kind, handler);
    }

    postAnswer(msg: Message, data: mixed): void {
        this.host.postMessage({ id: msg.id, kind: msg.kind, data: data });
    }

    postError(msg: Message, data: string): void {
        this.host.postMessage({ id: msg.id, kind: "error", data: data });
    }

    _genId(): string {
        return this._idPrefix + (this._idCounter++);
    }

    _receive(raw: mixed): void {
        if (typeof raw === "object" && raw != null) {
            // Verify Message
            const message: Message = { id: "", kind: "", data: null };
            if (raw.hasOwnProperty("id") && typeof raw.id === "string") {
                message.id = raw.id;
            } else {
                throw new Error("No/Invalid id in message '" + JSON.stringify(raw) + "'");
            }
            if (raw.hasOwnProperty("kind") && typeof raw.kind === "string") {
                message.kind = raw.kind;
            } else {
                throw new Error("No/Invalid kind in message '" + JSON.stringify(raw) + "'");
            }
            if (raw.hasOwnProperty("data")) {
                message.data = raw.data;
            }
            // Own request was fulfilled
            const callback = this._callbacks.get(message.id);
            if (callback != null) {
                callback(message);
                return;
            }
            // New request has arrived
            const handler = this._handlers.get(message.kind);
            if (handler != null) {
                try {
                    this.postAnswer(message, handler(message.data));
                } catch (err) {
                    this.postError(message, err.message);
                }
                return;
            }
            throw new Error("No handler for request of kind '" + message.kind + "'");
        } else {
            throw new Error("Received invalid message: '" + JSON.stringify(raw) + "'");
        }
    }

}

