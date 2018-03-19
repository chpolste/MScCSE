// @flow
"use strict";

let assert = require("assert");
let tools = require("../../src/js/tools.js");


describe("tools.ObservableMixin", function () {
    
    it("notify", function () {
        let observable = new tools.ObservableMixin();
        let x = false;
        observable.attach(() => { x = true });
        observable.notify();
        assert(x);
    });

});

