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


