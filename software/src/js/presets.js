// @flow
"use strict";


export const objectives = {

    // TODO: composite variables that are made up of other variables

    "Reachability": {
        name: "Reachability",
        formula: "\\mathsf{F} \\varphi",
        variables: ["\\varphi"],
        automaton: "q0>(\\varphi)>q1,q0>>q0,q1>>q1 | q0 | q0 | q1"
    }

}


export const setups = {

    "Svorenova et al. (2017)'s Illustrative Example": {
        dimension: { stateSpace: "2-dimensional", controlSpace: "2-dimensional" },
        equation: { A: "1\n0\n0\n1", B: "1\n0\n0\n1" },
        polytope: {
            controlSpace: "-1 < x\n x < 1\n-1 < y\n y < 1",
            randomSpace: "-0.1 < x\n   x < 0.1\n-0.1 < y\n   y < 0.1",
            stateSpace: "0 < x\nx < 4\n0 < y\ny < 2"
        },
        predicates: "p1: x > 2",
        objective: "Reachability\np1\nt"
    },

    "Svorenova et al. (2017)'s Double Integrator": {
        dimension: { stateSpace: "2-dimensional", controlSpace: "1-dimensional" },
        equation: { A: "1\n1\n0\n1", B: "0.5\n1" },
        polytope: {
            controlSpace: "-1 < x\n x < 1",
            randomSpace: "-0.1 < x\n   x < 0.1\n-0.1 < y\n   y < 0.1",
            stateSpace: "-5 < x\n x < 5\n-3 < y\n y < 3"
        },
        predicates: "p1: -1 < x\np2:  x < 1\np3: -1 < y\np4:  y < 1",
        objective: "Reachability\np1 & p2 & p3 & p4\nt"
    }

}

