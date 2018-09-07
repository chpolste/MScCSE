// @flow
"use strict";

import type { ConvexPolytope, Halfspace } from "./geometry.js";
import type { Proposition, ObjectiveKind } from "./logic.js";
import type { FigureLayer } from "./figure.js";
import type { Plot } from "./widgets-plot.js";
import type { Input } from "./widgets-input.js";

import * as presets from "./presets.js";
import * as dom from "./domtools.js";
import { iter, ObservableMixin } from "./tools.js";
import { HalfspaceInequation, polytopeType, union } from "./geometry.js";
import { Objective, AtomicProposition, parseProposition, traverseProposition } from "./logic.js";
import { Figure, autoProjection } from "./figure.js";
import { AxesPlot } from "./widgets-plot.js";
import { ValidationError, SelectInput, MultiLineInput, MatrixInput, LineInput } from "./widgets-input.js";
import { LSS, AbstractedLSS } from "./system.js";
import { VAR_NAMES, COLORS } from "./inspector-widgets-inspector.js";


/* Session Management

Load and resume sessions from files and provide presets for convenient access
to common problem setups.
*/

type SystemSetup = {
    dimension: {
        stateSpace: string,
        controlSpace: string
    },
    equation: {
        A: string,
        B: string,
    },
    polytope: {
        controlSpace: string,
        randomSpace: string,
        stateSpace: string
    },
    predicates: string,
    objective: string
};


export class SessionManager {

    +node: HTMLDivElement;
    +problemSetup: ProblemSetup;

    constructor(problemSetup: ProblemSetup): void {
        this.node = dom.div();
        this.problemSetup = problemSetup;
        let presetSelect = new SelectInput(presets.setups);
        let presetButton = dom.create("input", {"type": "button", "value": "fill in"});
        presetButton.addEventListener("click", () => this.problemSetup.load(presetSelect.value));
        dom.appendChildren(this.node, [
            /*
            dom.h3({}, ["Load session from file"]),
            dom.p({}, [dom.create("input", {"type": "file", "disabled": "true"})]),
            dom.p({}, [
                dom.create("input", {"type": "button", "value": "resume session", "disabled": "true"}), " ",
                dom.create("input", {"type": "button", "value": "fill in setup only", "disabled": "true"}),
            ]),
            */
            dom.p({}, ["Start from a preset:"]),
            dom.p({}, [presetSelect.node, " ", presetButton])
        ]);
    }

}


/* Problem Setup

Specification of a linear stochastic system, its initial decomposition and an
objective with a live preview and consistency checks.
*/

// Widgets here take other inputs as dimension/shape args, to allow change

type ProblemCallback = (LSS, Halfspace[], string[], Objective) => void;

export class ProblemSetup {
    
    +node: HTMLFormElement;
    +ssDim: Input<number>;
    +csDim: Input<number>;
    +equation: EvolutionEquationInput;
    +preview: ProblemSetupSystemPreview;
    +ss: Input<ConvexPolytope>;
    +rs: Input<ConvexPolytope>;
    +cs: Input<ConvexPolytope>;
    +predicates: Input<[Halfspace[], string[]]>;
    +objective: Input<Objective>;
    +callback: ProblemCallback;
    +system: AbstractedLSS;

    constructor(callback: ProblemCallback) {
        this.callback = callback;

        this.ssDim = new SelectInput({"1-dimensional": 1, "2-dimensional": 2}, "2-dimensional");
        this.csDim = new SelectInput({"1-dimensional": 1, "2-dimensional": 2}, "2-dimensional");
        this.equation = new EvolutionEquationInput(this.ssDim, this.csDim);
        this.preview = new ProblemSetupSystemPreview();
        this.ss = new PolytopeInput(this.ssDim, false);
        this.rs = new PolytopeInput(this.ssDim, false);
        this.cs = new PolytopeInput(this.csDim, false);
        this.predicates = new PredicatesInput(this.ssDim);
        this.objective = new ObjectiveInput(this.predicates);

        const columns = dom.div({ "class": "inspector" }, [
            dom.div({ "class": "left" }, [
                this.preview.node,
                dom.h3({}, ["Objective", dom.infoBox("info-input-objective")]), this.objective.node
            ]),
            dom.div({ "class": "right" }, [
                dom.div({"class": "cols"}, [
                    dom.div({ "class": "left" }, [
                        dom.h3({}, ["Control Space Polytope", dom.infoBox("info-input-control")]),
                        this.cs.node,
                        dom.h3({}, ["Random Space Polytope", dom.infoBox("info-input-random")]),
                        this.rs.node,
                        dom.h3({}, ["State Space Polytope", dom.infoBox("info-input-state")]),
                        this.ss.node,
                        dom.h3({}, ["Initial State Space Decomposition", dom.infoBox("info-input-predicates")]),
                        this.predicates.node
                    ]),
                    dom.div({ "class": "right" }) // dummy column to fill space in layout
                ])
            ])
        ]);
        const submit = dom.create("input", {"type": "submit", "value": "run inspector"});
        submit.addEventListener("click", (e: Event) => {
            if (this.node.checkValidity()) {
                e.preventDefault();
                this.submit();
            }
        });
        this.node = dom.create("form", {}, [
            dom.h3({}, ["Dimensions"]),
            dom.p({}, [this.ssDim.node, " state space"]),
            dom.p({}, [this.csDim.node, " control space"]),
            dom.h3({}, ["Evolution Equation"]), this.equation.node,
            columns,
            dom.h3({}, ["Continue"]),
            dom.p({}, [submit])
        ]);

        this.equation.A.attach(() => this.draw());
        this.equation.B.attach(() => this.draw());
        this.ss.attach(() => this.draw());
        this.rs.attach(() => this.draw());
        this.cs.attach(() => this.draw());
        this.predicates.attach(() => this.draw());
    }

    get lssIsValid(): boolean {
        return this.equation.isValid && this.ss.isValid && this.rs.isValid && this.cs.isValid;
    }

    get lss(): LSS {
        return new LSS(
            this.equation.A.value, this.equation.B.value,
            this.ss.value, this.rs.value, [this.cs.value]
        );
    }

    get systemIsValid(): boolean {
        return this.lssIsValid && this.predicates.isValid;
    }

    get system(): AbstractedLSS {
        return this.lss.decompose(...this.predicates.value);
    }

    // Fill in text fields based on a saved preset
    load(setup: SystemSetup) {
        this.ssDim.text = setup.dimension.stateSpace;
        this.csDim.text = setup.dimension.controlSpace;
        this.equation.A.text = setup.equation.A;
        this.equation.B.text = setup.equation.B;
        this.cs.text = setup.polytope.controlSpace;
        this.rs.text = setup.polytope.randomSpace;
        this.ss.text = setup.polytope.stateSpace;
        this.predicates.text = setup.predicates;
        this.objective.text = setup.objective;
    }

    submit(): void {
        this.callback(this.lss, ...this.predicates.value, this.objective.value);
    }

    draw(): void {
        if (this.systemIsValid) {
            this.preview.drawAbsLSS(this.system);
        } else if (this.lssIsValid) {
            this.preview.drawLSS(this.lss);
        } else {
            this.preview.clear();
        }
    }

}


class ProblemSetupSystemPreview {

    +node: HTMLDivElement;
    +plot: Plot;
    +layer: FigureLayer;

    constructor(): void {
        let fig = new Figure();
        this.plot = new AxesPlot([630, 420], fig, autoProjection(3/2));
        this.layer = fig.newLayer({ "stroke": "#000", "stroke-width": "1" });
        this.node = dom.div({}, [this.plot.node]);
    }

    drawLSS(lss: LSS): void {
        this.plot.projection = autoProjection(3/2, ...lss.extent);
        this.layer.shapes = [
            { kind: "polytope", vertices: lss.stateSpace.vertices, style: { fill: COLORS.undecided } },
            ...union.remove(lss.oneStepReachable, [lss.stateSpace]).map(
                poly => ({ kind: "polytope", vertices: poly.vertices, style: { fill: COLORS.nonSatisfying } })
            )
        ];
    }

    drawAbsLSS(abslss: AbstractedLSS): void {
        this.plot.projection = autoProjection(3/2, ...abslss.extent);
        this.layer.shapes = iter.map(state => {
            const fill = state.isNonSatisfying ? COLORS.nonSatisfying : COLORS.undecided;
            return { kind: "polytope", vertices: state.polytope.vertices, style: { fill: fill } };
        }, abslss.states.values());
    }

    clear(): void {
        this.plot.projection = autoProjection(3/2);
    }

}

// Input of Matrix A and B of LSS that adapts to dimensions selection.
// Recognize non-NaN numeric entries.
class EvolutionEquationInput {

    +node: HTMLParagraphElement;
    +ssDim: Input<number>;
    +csDim: Input<number>;
    +A: MatrixInput<number>;
    +B: MatrixInput<number>;
    +isValid: boolean;

    constructor(ssDim: Input<number>, csDim: Input<number>) {
        this.ssDim = ssDim;
        this.csDim = csDim;
        this.A = new MatrixInput(EvolutionEquationInput.parseNumber, [2, 2], 5);
        this.B = new MatrixInput(EvolutionEquationInput.parseNumber, [2, 2], 5);
        this.node = dom.p({}, [
            dom.renderTeX("x_{t+1} =", dom.span()),
            this.A.node,
            dom.renderTeX("x_t +", dom.span()),
            this.B.node,
            dom.renderTeX("u_t + w_t", dom.span())
        ]);
        ssDim.attach(() => {
            this.A.shape = [ssDim.value, ssDim.value];
            this.B.shape = [ssDim.value, csDim.value];
        });
        csDim.attach(() => {
            this.B.shape = [ssDim.value, csDim.value];
        });
    }

    get isValid(): boolean {
        if (this.A.isValid && this.B.isValid) {
            let shapeA = this.A.shape;
            let shapeB = this.B.shape;
            return shapeA[0] === this.ssDim.value && shapeA[0] === shapeA[1]
                && shapeB[0] === this.ssDim.value && shapeB[1] === this.csDim.value;
        }
        return false;
    }

    static parseNumber(text: string): number {
        let out = parseFloat(text);
        if (isNaN(out)) {
            throw new ValidationError("invalid number '" + text + "'");
        }
        return out;
    }

}


// Input of a convex polytope in H-representation (predicates as linear
// inequations) with a preview. Validation adapts to external dimensions
// selection.
class PolytopeInput extends ObservableMixin<null> implements Input<ConvexPolytope> {

    +node: HTMLDivElement;
    +preview: AxesPlot;
    +previewLayer: FigureLayer;
    +dim: Input<number>;
    +allowEmpty: boolean;
    +predicates: MultiLineInput<Halfspace>;
    variables: string;

    constructor(dim: Input<number>, allowEmpty: boolean) {
        super();
        this.allowEmpty = allowEmpty;
        this.dim = dim;
        this.dim.attach(() => {
            this.variables = VAR_NAMES.substring(0, this.dim.value);
            this.predicates.handleChange(); // Triggers this.handleChange
        });
        this.variables = VAR_NAMES.substring(0, this.dim.value)
        this.predicates = new MultiLineInput(
            line => HalfspaceInequation.parse(line, this.variables),
            [5, 25]
        );
        this.predicates.attach(() => this.handleChange());
        let fig = new Figure();
        this.previewLayer = fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#EEE" });
        this.preview = new AxesPlot([90, 90], fig, autoProjection(4/3));
        this.node = dom.div({ "class": "polytope-builder" }, [this.predicates.node, this.preview.node]);
        this.handleChange();
    }

    get value(): ConvexPolytope {
        return polytopeType(this.variables.length).intersection(this.predicates.value);
    }

    get text(): string {
        return this.predicates.text;
    }

    set text(text: string): void {
        this.predicates.text = text;
    }

    get isValid(): boolean {
        return this.predicates.isValid && this.variables.length === this.dim.value && (this.allowEmpty || !this.value.isEmpty);
    }

    handleChange(): void {
        let proj = autoProjection(1);
        let shapes = [];
        if (this.isValid) {
            let poly = this.value;
            if (!poly.isEmpty) {
                proj = autoProjection(1, ...poly.extent);
                shapes = [{ kind: "polytope", vertices: poly.vertices }];
            }
        } else {
            if (this.predicates.isValid) {
                // Hijack form validation to display error message
                this.predicates.node.setCustomValidity("Polytope is empty or unbounded");
            }
        }
        this.preview.projection = proj;
        this.previewLayer.shapes = shapes;
        this.notify();
    }

}


// Input of predicates (as linear inequations) that define the initial state
// partition. Predicates can be labeled for use in objective specification.
// Validation adapts to external dimensions selection.
class PredicatesInput extends ObservableMixin<null> implements Input<[Halfspace[], string[]]> {

    +node: HTMLElement;
    +dim: Input<number>;
    +predicates: Input<[Halfspace, string][]>;
    variables: string;

    constructor(dim: Input<number>): void {
        super();
        this.dim = dim;
        this.dim.attach(() => { 
            this.variables = VAR_NAMES.substring(0, this.dim.value);
            this.predicates.handleChange();
        });
        this.variables = VAR_NAMES.substring(0, this.dim.value);
        this.predicates = new MultiLineInput(line => this.parsePredicate(line), [10, 40]);
        this.predicates.attach(() => this.handleChange());
        this.node = this.predicates.node;
    }

    get value(): [Halfspace[], string[]] {
        let predicates = [];
        let names = [];
        for (let predicate of this.predicates.value) {
            predicates.push(predicate[0]);
            names.push(predicate[1]);
        }
        return [predicates, names];
    }

    get text(): string {
        return this.predicates.text;
    }

    set text(text: string): void {
        this.predicates.text = text;
    }

    get isValid(): boolean {
        return this.predicates.isValid && this.predicates.value.length > 0
            && this.variables.length === this.dim.value;
    }

    handleChange(): void {
        this.notify();
    }

    parsePredicate(line: string): [Halfspace, string] {
        const match = line.match(/(?:\s*([a-z][a-z0-9]*)\s*:\s*)?(.*)/);
        if (match == null || match[2] == null) throw new Error(
            "..." // TODO
        );
        const name = match[1] == null ? "" : match[1];
        const pred = HalfspaceInequation.parse(match[2], this.variables);
        return [pred, name];
    }

}


// Objective specification
class ObjectiveInput extends ObservableMixin<null> implements Input<Objective> {

    +node: HTMLDivElement;
    +predicates: Input<[Halfspace[], string[]]>;
    +kind: Input<ObjectiveKind>;
    +termContainer: HTMLDivElement;
    +description: HTMLParagraphElement;
    terms: Input<Proposition>[];

    constructor(predicates: Input<[Halfspace[], string[]]>): void {
        super();
        this.terms = [];
        this.kind = new SelectInput(presets.objectives, "Reachability");
        const formula = dom.create("code");
        this.termContainer = dom.div();
        this.kind.attach(() => {
            const objKind = this.kind.value;
            formula.innerHTML = objKind.formula;
            this.updateTerms(objKind.variables);
            this.handleChange();
        });
        // The quickest way to properly initialize the widget:
        this.kind.notify();

        // React to changes in predicates by re-evaluating the term inputs,
        // which reference named predicates
        this.predicates = predicates;
        this.predicates.attach(() => {
            for (let term of this.terms) term.handleChange()
        });

        this.node = dom.div({}, [
            dom.p({}, [this.kind.node, ": ", formula, ", where"]),
            this.termContainer
        ]);
    }

    get value(): Objective {
        return new Objective(this.kind.value, this.terms.map(term => term.value));
    }

    get text(): string {
        return this.kind.text + "\n" + this.terms.map(t => t.text).join("\n");
    }
    
    set text(text: string): void {
        const lines = text.split("\n");
        if (lines.length < 1) throw new Error(
            "Invalid ..." // TODO
        );
        this.kind.text = lines[0];
        for (let i = 0; i < this.terms.length; i++) {
            this.terms[i].text = i + 1 < lines.length ? lines[i + 1] : "";
        }
    }

    get isValid(): boolean {
        for (let term of this.terms) {
            if (!term.isValid) return false;
        }
        return true;
    }

    handleChange(): void {
        this.notify();
    }

    // Update term input fields to match variable requirements of objective
    updateTerms(variables: string[]): void {
        const terms = [];
        const termNodes = [];
        for (let i = 0; i < variables.length; i++) {
            // Preserve contents of previous term input fields
            const oldText = i < this.terms.length ? this.terms[i].text : "";
            terms.push(new LineInput(s => this.parseTerm(s), 70, oldText));
            termNodes.push(dom.create("label", {}, [
                dom.create("code", {}, [variables[i]]), " = ", terms[i].node
            ]));
            terms[i].attach(() => this.handleChange());
        }
        dom.replaceChildren(this.termContainer, termNodes);
        this.terms = terms;
    }

    parseTerm(text: string): Proposition {
        const formula = parseProposition(text);
        const predicateNames = new Set(this.predicates.value[1]);
        traverseProposition(prop => {
            if (prop instanceof AtomicProposition && !predicateNames.has(prop.symbol)) {
                throw new Error("Unknown linear predicate '" + prop.symbol + "'");
            }
        }, formula);
        return formula;
    }

}
