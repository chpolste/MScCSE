// @flow
"use strict";

import type { Polytope } from "./geometry.js";
import type { Vector } from "./linalg.js";
import type { AbstractedLSS } from "./system.js";


// Controller instances keep their own memory
export interface Controller {
    constructor(AbstractedLSS): void;
    input(Vector): Vector;
}

// Return a random control input at every step
class RandomController implements Controller {
    
    +uu: Polytope;
    
    constructor(system: AbstractedLSS): void {
        this.uu = system.lss.uu;
    }

    input(x: Vector): Vector {
        return this.uu.sample();
    }

}

// Collection of controllers for module export
export const controller = {
    Random: RandomController
};
