// @flow
"use strict";


// Automaton specification: transitions ; init ; E ; F
export const objectives = {

    "Reachability": {
        name: "Reachability",
        formula: "\\mathsf{F} \\varphi",
        variables: ["\\varphi"],
        automaton: "q0>(\\varphi)>q1,q0>>q0,q1>>q1 ; q0 ; q0 ; q1",
        automatonPlacement: { "q0": [0, 0, 0], "q1": [300, 0, 0] }
    },

    "Reachability & Avoidance": {
        name: "Reachability & Avoidance",
        formula: "(\\neg \\pi) \\mathsf{U} \\varphi",
        variables: ["\\varphi", "\\pi"],
        automaton: "q0>(\\varphi)>q1,q0>(!\\pi)>q0,q1>>q1 ; q0 ; q0 ; q1",
        automatonPlacement: { "q0": [0, 0, 0], "q1": [300, 0, 0] }
    },

    "Safety": {
        name: "Safety",
        formula: "\\mathsf{G} (\\neg \\pi)",
        variables: ["\\pi"],
        automaton: "q0>(!\\pi)>q0 ; q0 ; ; ",
        automatonPlacement: { "q0": [0, 0, 0] }
    },

    "Eventual Safety": {
        name: "Eventual Safety",
        formula: "\\mathsf{F} \\mathsf{G} \\neg \\pi",
        variables: ["\\pi"],
        automaton: "q0>(!\\pi)>q1,q0>>q0,q1>(!\\pi)>q1,q1>>q0 ; q0 ; q0 ; ",
        automatonPlacement: { "q0": [0, 0, 0], "q1": [300, 0, 0] }
    },

    "Recurrence": {
        name: "Recurrence",
        formula: "\\mathsf{G} \\mathsf{F} \\varphi",
        variables: ["\\varphi"],
        automaton: "q0>(\\varphi)>q1,q0>>q0,q1>(\\varphi)>q1,q1>>q0 ; q0 ; q0 ; q1",
        automatonPlacement: { "q0": [0, 0, 0], "q1": [300, 0, 0] }
    },

    "Safe 2-Recurrence": {
        name: "Safe 2-Recurrence",
        formula: "\\mathsf{G} (\\mathsf{F} \\varphi \\wedge \\mathsf{F} \\theta \\wedge \\neg \\pi)",
        variables: ["\\varphi", "\\theta", "\\pi"],
        automaton: "q0>(!\\pi & \\varphi & \\theta)>q0,q0>(!(\\pi | \\varphi))>q1,q0>(!(\\pi | \\theta) & \\varphi)>q2,"
                 + "q1>(!(\\pi | \\varphi))>q1,q1>(!\\pi & \\varphi & \\theta)>q0,q1>(!(\\pi | \\theta) & \\varphi)>q2,"
                 + "q2>(!(\\pi | \\theta))>q2,q2>(!\\pi & \\theta)>q0 ; q0 ; q1,q2 ; q0",
        automatonPlacement: { "q0": [0, 75, -10], "q1": [300, 150, 10], q2: [230, 0, 170] }
    }

}


export const setups = {

    "Double Integrator": {
        dimension: { stateSpace: "2-dimensional", controlSpace: "1-dimensional" },
        equation: { A: "1\n1\n0\n1", B: "0.5\n1" },
        polytope: {
            controlSpace: "-1 < x\n x < 1",
            randomSpace: "-0.1 < x\n   x < 0.1\n-0.1 < y\n   y < 0.1",
            stateSpace: "-5 < x\n x < 5\n-3 < y\n y < 3"
        },
        predicates: "p1: -1 < x\np2:  x < 1\np3: -1 < y\np4:  y < 1",
        objective: "Reachability\np1 & p2 & p3 & p4\nt"
    },

    "Illustrative Example (1D)": {
        dimension: { stateSpace: "1-dimensional", controlSpace: "1-dimensional" },
        equation: { A: "1", B: "1" },
        polytope: {
            controlSpace: "-1 < x\n x < 1",
            randomSpace: "-0.1 < x\n   x < 0.1",
            stateSpace: "0 < x\nx < 4"
        },
        predicates: "p1: x > -2\np2: x < 2",
        objective: "Reachability\np1 & p2\nt"
    },

    "Illustrative Example (2D)": {
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

    "Corridor": {
        dimension: { stateSpace: "2-dimensional", controlSpace: "2-dimensional" },
        equation: { A: "1\n0\n0\n1", B: "1\n0\n0\n1" },
        polytope: {
            controlSpace: "-0.5 < x\n   x < 0.5\n-0.5 < y\n   y < 0.5",
            randomSpace: "-0.1 < x\n   x < 0.1\n-0.1 < y\n   y < 0.1",
            stateSpace: "0 < x\nx < 4\n0 < y\ny < 3"
        },
        predicates: "r1: x > 2.7\nr2: x < 1.3\nh1: y < 1.3\nh2: y > 1.7",
        objective: "Safe 2-Recurrence\nr1\nr2\n!r1 & !r2 & (h1 | h2)\nf"
    }

}

