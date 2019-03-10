// @flow
"use strict";

let assert = require("assert");
let tools = require("../../src/js/tools.js");



describe("tools.xor", function () {

    it("truth table", function () {
        assert(!tools.xor(true, true));
        assert(tools.xor(true, false));
        assert(tools.xor(false, true));
        assert(!tools.xor(false, false));
    });

});


describe("tools.iter", function () {

    const iter = tools.iter;
    const dbl = x => x * 2;
    const gt0 = x => x > 0;

    it("some", function () {
        assert(iter.some([true, true]));
        assert(iter.some([false, true, false]));
        assert(iter.some([true, false, false]));
        assert(!iter.some([]));
        assert(!iter.some([false, false, false]));
    });

    it("every", function () {
        assert(iter.every([]));
        assert(iter.every([true, true]));
        assert(iter.every([true, true, true]));
        assert(!iter.every([false, true, false]));
        assert(!iter.every([true, false, false]));
    });

    it("count", function () {
        assert.equal(iter.count([]), 0);
        assert.equal(iter.count([4]), 1);
        assert.equal(iter.count([4, 5, 6, 7]), 4);
        assert.equal(iter.count(new Set([1, 2])), 2);
    });

    it("map", function () {
        assert.deepEqual(Array.from(iter.map(dbl, [2, 1, 4])), [4, 2, 8]);
        assert.deepEqual(Array.from(iter.map(dbl, [])), []);
    });

    it("filter", function () {
        assert.deepEqual(Array.from(iter.filter(gt0, [2, 1, -4])), [2, 1]);
        assert.deepEqual(Array.from(iter.filter(gt0, [-1, -4])), []);
        assert.deepEqual(Array.from(iter.filter(gt0, [-2, 1, -4])), [1]);
        assert.deepEqual(Array.from(iter.filter(gt0, [])), []);
    });

    it("chain", function () {
        assert.deepEqual(Array.from(iter.chain([], [])), []);
        assert.deepEqual(Array.from(iter.chain([], [1, 2])), [1, 2]);
        assert.deepEqual(Array.from(iter.chain([1, 2], [])), [1, 2]);
        assert.deepEqual(Array.from(iter.chain([1], [2])), [1, 2]);
        assert.deepEqual(Array.from(iter.chain([1], [2, 3], [4, 5])), [1, 2, 3, 4, 5]);
    });

});


describe("tools.arr", function () {

    const arr = tools.arr;
    const sum = (x, y) => x + y;

    it("zip2map", function () {
        assert.deepEqual(arr.zip2map(sum, [1, 2], [3, 4]), [4, 6]);
        assert.deepEqual(arr.zip2map(sum, [1], [3, 4, 5]), [4]);
        assert.deepEqual(arr.zip2map(sum, [], [2, 3]), []);
    });

    it("zip2", function () {
        assert.deepEqual(arr.zip2([1, 2, 3], [4, 5, 6]), [[1, 4], [2, 5], [3, 6]]);
        assert.deepEqual(arr.zip2([1, 2, 3], [4, 5]), [[1, 4], [2, 5], [3, undefined]]);
        assert.deepEqual(arr.zip2([1], [3, 4]), [[1, 3]]);
        assert.deepEqual(arr.zip2([], [3, 4]), []);
    });

    it("cyc2map", function () {
        assert.deepEqual(arr.cyc2map(sum, [1, 2, 3]), [3, 5, 4]);
        assert.deepEqual(arr.cyc2map(sum, [1]), [2]);
        assert.deepEqual(arr.cyc2map(sum, []), []);
    });

    it("cyc2mapl", function () {
        assert.deepEqual(arr.cyc2mapl(sum, [1, 2, 3]), [4, 3, 5]);
        assert.deepEqual(arr.cyc2mapl(sum, [1]), [2]);
        assert.deepEqual(arr.cyc2mapl(sum, []), []);
    });

    it("merge", function () {
        let xs = [0, 2, 4, 6];
        let ys = [-1, 1, 2, 3];
        assert.deepEqual(arr.merge((a, b) => a - b, xs, ys), [-1, 0, 1, 2, 2, 3, 4, 6]);
        assert.deepEqual(arr.merge((a, b) => a - b, ys, xs), [-1, 0, 1, 2, 2, 3, 4, 6]);
    });

    it("intersperse", function () {
        assert.deepEqual(arr.intersperse(0, [1, 2, 3]), [1, 0, 2, 0, 3]);
        assert.deepEqual(arr.intersperse(0, [2, 3]), [2, 0, 3]);
        assert.deepEqual(arr.intersperse(0, [1]), [1]);
        assert.deepEqual(arr.intersperse(0, []), []);
    });

});


describe("tools.sets", function () {

    const sets = tools.sets;

    const s1 = new Set([1]);
    const s2 = new Set([2]);
    const s3 = new Set([3]);
    const s12 = new Set([1, 2]);
    const s13 = new Set([1, 3]);
    const s23 = new Set([2, 3]);
    const s123 = new Set([1, 2, 3]);

    it("areEqual", function () {
        assert(sets.areEqual(s123, s123));
        assert(sets.areEqual(s123, new Set([3, 1, 2])));
        assert(!sets.areEqual(s123, s23));
        assert(!sets.areEqual(s123, new Set(["1", 2, 3])));
        assert(!sets.areEqual(s123, new Set([4, 1, 2])));
    });

    it("isSubset", function () {
        assert(sets.isSubset(s1, s1));
        assert(sets.isSubset(s1, s123));
        assert(sets.isSubset(s1, s13));
        assert(sets.isSubset(s1, s12));
        assert(!sets.isSubset(s1, s2));
        assert(!sets.isSubset(s1, s23));
    });

    it("doIntersect", function () {
        assert(sets.doIntersect(s1, s12));
        assert(sets.doIntersect(s2, s12));
        assert(sets.doIntersect(s13, s12));
        assert(sets.doIntersect(s123, s123));
        assert(!sets.doIntersect(s1, s2));
        assert(!sets.doIntersect(s2, s13));
    });

    it("union", function () {
        assert(sets.areEqual(sets.union(s1, s23), s123));
        assert(sets.areEqual(sets.union(s2, s13), s123));
        assert(sets.areEqual(sets.union(s12, s23), s123));
        assert(sets.areEqual(sets.union(s123, s23), s123));
        assert(sets.areEqual(sets.union(s2, s123), s123));
        assert(sets.areEqual(sets.union(s2, s1, s3), s123));
    });

    it("intersection", function () {
        assert(sets.areEqual(sets.intersection(s1, s23), new Set()));
        assert(sets.areEqual(sets.intersection(s2, s123), s2));
        assert(sets.areEqual(sets.intersection(s12, s23), s2));
        assert(sets.areEqual(sets.intersection(s123, s23), s23));
        assert(sets.areEqual(sets.intersection(s123, s123), s123));
    });

    it("difference", function () {
        assert(sets.areEqual(sets.difference(s1, s23), s1));
        assert(sets.areEqual(sets.difference(s2, s123), new Set()));
        assert(sets.areEqual(sets.difference(s12, s23), s1));
        assert(sets.areEqual(sets.difference(s123, s23), s1));
        assert(sets.areEqual(sets.difference(s123, s3), s12));
    });

});


describe("tools.n2s", function () {

    it("rounds to 5 decimal places", function () {
        assert.equal(tools.n2s(0.1111111), "0.11111");
        assert.equal(tools.n2s(0.7777777), "0.77778");
    });

    it("removes 0-decimals at the end", function () {
        assert.equal(tools.n2s(0.11), "0.11");
        assert.equal(tools.n2s(0.01), "0.01");
    });

    it("removes decimal point when number is integer", function () {
        assert.equal(tools.n2s(5347), "5347");
        assert.equal(tools.n2s(70), "70");
        assert.equal(tools.n2s(0.0000008), "0");
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

