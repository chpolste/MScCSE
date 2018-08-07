// @flow
"use strict";

let assert = require("assert");
let tools = require("../../src/js/tools.js");


describe("tools.merge", function () {

    it("preserves ordering", function () {
        let xs = [0, 2, 4, 6];
        let ys = [-1, 1, 2, 3];
        assert.deepEqual(tools.merge((a, b) => a - b, xs, ys), [-1, 0, 1, 2, 2, 3, 4, 6]);
        assert.deepEqual(tools.merge((a, b) => a - b, ys, xs), [-1, 0, 1, 2, 2, 3, 4, 6]);
    });

});


describe("tools.ObservableMixin", function () {
    
    it("notify", function () {
        let observable = new tools.ObservableMixin();
        let x = false;
        observable.attach(() => { x = true });
        observable.notify();
        assert(x);
    });

});


describe("tools.UniqueCollection", function () {

    it("always returns the same value for an equality class", function () {
        const xs = new tools.UniqueCollection(
            (x) => x % 5,
            (x, y) => (x % 10) === (y % 10)
        );
        assert.equal(xs.take(1), 1);
        assert.equal(xs.take(2), 2);
        assert.equal(xs.take(9), 9);
        assert.equal(xs.take(11), 1);
        assert.equal(xs.take(102), 2);
        assert.equal(xs.take(79), 9);
        assert.equal(xs.take(80), 80);
        assert.equal(xs.take(0), 80);
        assert.equal(xs.take(9), 9);
    });

    it("always returns the same object for an equality class", function () {
        const xs = new tools.UniqueCollection(
            (x) => x.length,
            (x, y) => x.length === y.length
        );
        const empty1 = [];
        const empty2 = [];
        const one1 = [3];
        const one2 = ["hi"];
        assert.notEqual(empty1, empty2);
        assert.notEqual(one1, one2);
        assert.equal(xs.take(empty1), empty1);
        assert.equal(xs.take(empty2), empty1);
        assert.equal(xs.take(empty1), empty1);
        assert.equal(xs.take(one2), one2);
        assert.equal(xs.take(one1), one2);
        assert.equal(xs.take(one1), one2);
    });

    it("confirms and denies membership correctly", function () {
        const xs = new tools.UniqueCollection(
            (x) => x % 5,
            (x, y) => (x % 10) === (y % 10)
        );
        xs.take(2);
        xs.take(3);
        xs.take(5);
        xs.take(13);
        assert(xs.has(2));
        assert(xs.has(3));
        assert(xs.has(5));
        assert(xs.has(13));
        assert(xs.has(55));
        assert(xs.has(12));
        assert(!xs.has(0));
        assert(!xs.has(1));
        assert(!xs.has(11));
        assert(!xs.has(106));
        assert(!xs.has(4));
    });

    it("size reports accurate element count", function () {
        const xs = new tools.UniqueCollection(
            (x) => x % 5,
            (x, y) => (x % 10) === (y % 10)
        );
        assert.equal(xs.size, 0);
        xs.take(2);
        assert.equal(xs.size, 1);
        xs.take(4);
        assert.equal(xs.size, 2);
        xs.take(7);
        assert.equal(xs.size, 3);
        xs.take(2);
        assert.equal(xs.size, 3);
        xs.take(17);
        assert.equal(xs.size, 3);
    });

    it("yields all elements when used as iterable", function () {
        const xs = new tools.UniqueCollection(
            (x) => x % 5,
            (x, y) => (x % 10) === (y % 10)
        );
        for (let i = 0; i < 23; i++) {
            xs.take(i);
        }
        const elements = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        for (let x of xs) {
            assert(elements.delete(x));
        }
        assert.equal(elements.size, 0);
    });

});

