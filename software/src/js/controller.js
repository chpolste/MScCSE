// @flow
"use strict";

import type { ConvexPolytopeUnion } from "./geometry.js";
import type { Vector } from "./linalg.js";
import type { AbstractedLSS } from "./system.js";

// Controller instances keep their own memory
export interface Controller {
    constructor(AbstractedLSS): void;
    input(Vector): Vector;
}

// Return a random control input at every step
class RandomController implements Controller {
    
    +uus: ConvexPolytopeUnion;
    
    constructor(system: AbstractedLSS): void {
        this.uus = system.lss.uus;
    }

    input(x: Vector): Vector {
        return this.uus[0].sample();
    }

}

// Collection of controllers for module export
export const controller = {
    Random: RandomController
};
