// @flow

let assert = require("assert");
let linalg = require("../../src/js/linalg.js");


describe("linalg Vector operations", function () {

    it("norm2", function () {
        assert.equal(linalg.norm2([1]), 1);
        assert.equal(linalg.norm2([1, 0]), 1);
        assert.equal(linalg.norm2([0, 1]), 1);
    });

});


describe("linalg Vector-Vector operations", function () {

    it("dot", function () {
        assert.equal(linalg.dot([1, 1], [2, 3]), 5);
        assert.equal(linalg.dot([1, 2], [2, 1]), 4);
        assert.throws(() => linalg.dot([1, 2], [1]));
    });

    it("add", function () {
        assert.deepEqual(linalg.add([1, 2, 3], [0, 0, 0]), [1, 2, 3]);
        assert.deepEqual(linalg.add([1, 2, 3], [6, 5, 4]), [7, 7, 7]);
        assert.deepEqual(linalg.add([1, 2, 3], [1, 2, 3]), [2, 4, 6]);
        assert.throws(() => linalg.add([1, 2], [1]));
    });

    it("areClose", function () {
        assert(linalg.areClose([3, 1], [3 + linalg.TOL/2, 1]));
        assert(!linalg.areClose([3, 1], [3 + linalg.TOL, 1 + linalg.TOL]));
        assert(linalg.areClose([1, 2, 3], [1, 2, 3]));
        assert(!linalg.areClose([1, 2, 3], [3, 2, 1]));
        assert.throws(() => linalg.areClose([1], [1, 2, 3]));
    });

});


describe("linalg Matrix-Vector operations", function () {
    
    it("apply", function () {
        assert.deepEqual(linalg.apply([[1]], [3]), [3]);
        assert.deepEqual(linalg.apply([[2]], [3]), [6]);
        assert.deepEqual(linalg.apply([[1, 0], [0, 1]], [3, 4]), [3, 4]);
        assert.deepEqual(linalg.apply([[1, 2], [3, 4]], [1, 2]), [5, 11]);
        assert.throws(() => linalg.apply([[1, 2]], [1, 2, 3]));
    });

    it("applyRight", function () {
        assert.deepEqual(linalg.applyRight([[1]], [3]), [3]);
        assert.deepEqual(linalg.applyRight([[2]], [3]), [6]);
        assert.deepEqual(linalg.applyRight([[1, 0], [0, 1]], [3, 4]), [3, 4]);
        assert.deepEqual(linalg.applyRight([[1, 2], [3, 4]], [1, 2]), [7, 10]);
        assert.throws(() => linalg.applyRight([[1, 2]], [1, 2]));
    });

});


describe("linalg Matrix operations", function () {

    let unit1d = [[1]];
    let unit2d = [[1, 0], [0, 1]];
    
    it("det", function () {
        assert.equal(linalg.det(unit1d), 1);
        assert.equal(linalg.det(unit2d), 1);
        assert.equal(linalg.det([[1, 2], [0.5, 2]]), 1*2 - 0.5*2);
    });

    it("inv", function () {
        assert.deepEqual(linalg.inv(unit1d), unit1d);
        assert.deepEqual(linalg.inv(unit2d), unit2d);
        assert.throws(() => linalg.inv([[0]]));
        assert.throws(() => linalg.inv([[1, 1], [1, 1]]));
        assert.throws(() => linalg.inv([[1, 2], [3, 6]]));
    });

    it("transpose", function () {
        assert.deepEqual(linalg.transpose(unit1d), unit1d);
        assert.deepEqual(linalg.transpose([[1, 2], [3, 4]]), [[1, 3], [2, 4]]);
        assert.deepEqual(linalg.transpose([[1, 2]]), [[1], [2]]);
    });

});


describe("linalg Matrix-Matrix operations", function () {

    let unit1d = [[1]];
    let unit2d = [[1, 0], [0, 1]];
    
    it("matmul", function () {
        assert.deepEqual(linalg.matmul(unit1d, unit1d), unit1d);
        assert.deepEqual(linalg.matmul(unit2d, unit2d), unit2d);
        let m1234 = [[1, 2], [3, 4]];
        assert.deepEqual(linalg.matmul(unit2d, m1234), m1234);
        assert.deepEqual(linalg.matmul(m1234, m1234), [[7, 10], [15, 22]]);
    });

});


