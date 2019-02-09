// @flow
"use strict";

import type { Proposition, ObjectiveKind } from "./logic.js";
import type { FigureLayer } from "./figure.js";
import type { Plot } from "./widgets-plot.js";
import type { Input } from "./widgets-input.js";

import * as presets from "./presets.js";
import * as dom from "./dom.js";
import { iter, ObservableMixin } from "./tools.js";
import { Halfspace, Polytope, Union } from "./geometry.js";
import { Objective, OnePairStreettAutomaton, AtomicProposition, parseProposition, traverseProposition } from "./logic.js";
import { Figure, autoProjection } from "./figure.js";
import { AxesPlot } from "./widgets-plot.js";
import { ValidationError, CheckboxInput, DropdownInput, MultiLineInput, MatrixInput, LineInput } from "./widgets-input.js";
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
        this.node = dom.DIV();
        this.problemSetup = problemSetup;
        let presetSelect = new DropdownInput(presets.setups);
        let presetButton = dom.INPUT({"type": "button", "value": "fill in"});
        presetButton.addEventListener("click", () => this.problemSetup.load(presetSelect.value));
        dom.appendChildren(this.node, [
            /*
            dom.H3({}, ["Load session from file"]),
            dom.P({}, [dom.INPUT({"type": "file", "disabled": "true"})]),
            dom.P({}, [
                dom.INPUT({"type": "button", "value": "resume session", "disabled": "true"}), " ",
                dom.INPUT({"type": "button", "value": "fill in setup only", "disabled": "true"}),
            ]),
            */
            dom.P({}, ["Start from a preset:"]),
            dom.P({}, [presetSelect.node, " ", presetButton])
        ]);
    }

}


/* Problem Setup

Specification of a linear stochastic system, its initial decomposition and an
objective with a live preview and consistency checks.
*/

// Widgets here take other inputs as dimension/shape args, to allow change

type ProblemCallback = (LSS, Halfspace[], string[], Objective, boolean) => void;

export class ProblemSetup extends ObservableMixin<null> {
    
    +node: HTMLFormElement;
    +ssDim: Input<number>;
    +csDim: Input<number>;
    +equation: EvolutionEquationInput;
    +preview: SystemPreview;
    +ss: Input<Polytope>;
    +rs: Input<Polytope>;
    +cs: Input<Polytope>;
    +predicates: Input<[Halfspace[], string[]]>;
    +objective: Input<Objective>;
    +analyseWhenReady: Input<boolean>;
    +callback: ProblemCallback;
    +system: AbstractedLSS;

    constructor(callback: ProblemCallback) {
        super();
        this.callback = callback;

        this.ssDim = new DropdownInput({"1-dimensional": 1, "2-dimensional": 2}, "2-dimensional");
        this.csDim = new DropdownInput({"1-dimensional": 1, "2-dimensional": 2}, "2-dimensional");
        this.equation = new EvolutionEquationInput(this.ssDim, this.csDim);
        this.ss = new PolytopeInput(this.ssDim, false);
        this.rs = new PolytopeInput(this.ssDim, false);
        this.cs = new PolytopeInput(this.csDim, false);
        this.predicates = new PredicatesInput(this.ssDim);
        this.objective = new ObjectiveInput(this.predicates);
        this.preview = new SystemPreview(this, this.objective.terms);

        const columns = dom.DIV({ "id": "inspector" }, [
            dom.DIV({ "class": "left" }, [
                this.preview.node,
                dom.H3({}, [
                    "Objective",
                    dom.DIV({ "class": "icons" }, [dom.infoBox("info-input-objective")])
                ]),
                this.objective.node
            ]),
            dom.DIV({ "class": "right" }, [
                dom.H3({}, [
                    "Control Space Polytope",
                    dom.DIV({ "class": "icons" }, [dom.infoBox("info-input-control")])
                ]),
                this.cs.node,
                dom.H3({}, [
                    "Random Space Polytope",
                    dom.DIV({ "class": "icons" }, [dom.infoBox("info-input-random")])
                ]),
                this.rs.node,
                dom.H3({}, [
                    "State Space Polytope",
                    dom.DIV({ "class": "icons" }, [dom.infoBox("info-input-state")])
                ]),
                this.ss.node,
                dom.H3({}, [
                    "Initial State Space Decomposition",
                    dom.DIV({ "class": "icons" }, [dom.infoBox("info-input-predicates")])
                ]),
                this.predicates.node
            ])
        ]);
        const submit = dom.INPUT({"type": "submit", "value": "run inspector"});
        submit.addEventListener("click", (e: Event) => {
            if (this.node.checkValidity()) {
                e.preventDefault();
                this.submit();
            }
        });
        this.analyseWhenReady = new CheckboxInput(true, "analyse at startup");
        this.node = dom.FORM({}, [
            dom.H3({}, ["Dimensions"]),
            dom.P({}, [this.ssDim.node, " state space"]),
            dom.P({}, [this.csDim.node, " control space"]),
            dom.H3({}, ["Evolution Equation"]), this.equation.node,
            columns,
            dom.H3({}, ["Continue"]),
            dom.P({}, [this.analyseWhenReady.node]),
            dom.P({}, [submit])
        ]);

        this.equation.A.attach(() => this.notify());
        this.equation.B.attach(() => this.notify());
        this.ss.attach(() => this.notify());
        this.rs.attach(() => this.notify());
        this.cs.attach(() => this.notify());
        this.predicates.attach(() => this.notify());
    }

    get lssIsValid(): boolean {
        return this.equation.isValid && this.ss.isValid && this.rs.isValid && this.cs.isValid;
    }

    get lss(): LSS {
        return new LSS(
            this.equation.A.value, this.equation.B.value,
            this.ss.value, this.rs.value, this.cs.value.toUnion()
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
        this.callback(this.lss, ...this.predicates.value, this.objective.value, this.analyseWhenReady.value);
    }

}


class SystemPreview {

    +node: HTMLDivElement;
    +setup: ProblemSetup;
    +terms: ObjectiveTermsInput;
    +plot: Plot;
    +layers: { [string]: FigureLayer };
    // Cache the last drawn system for easier proposition preview
    _system: ?AbstractedLSS;

    constructor(setup: ProblemSetup, terms: ObjectiveTermsInput): void {
        this.setup = setup;
        this.setup.attach(() => this.drawSystem());
        this.terms = terms;
        this.terms.attach(() => this.drawObjectiveTerm());
        this._system = null;
        let fig = new Figure();
        this.plot = new AxesPlot([660, 440], fig, autoProjection(3/2));
        this.layers = {
            objective: fig.newLayer({ "stroke": COLORS.selection, "fill": COLORS.selection }),
            state:     fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill-opacity": "0" }),
            outer:     fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": COLORS.no })
        };
        this.node = dom.DIV({ "class": "plot" }, [this.plot.node]);
        this.drawSystem();
    }

    drawSystem(): void {
        this._system = null;
        const stateShapes = [];
        const outerShapes = [];
        // Form results in a complete AbstractedLSS, show state space with
        // initial decomposition and mark outer states
        if (this.setup.systemIsValid) {
            const system = this.setup.system;
            this.plot.projection = autoProjection(3/2, ...system.extent);
            for (let state of system.states.values()) {
                (state.isOuter ? outerShapes : stateShapes).push({
                    kind: "polytope", vertices: state.polytope.vertices
                });
            }
            this._system = system;
        // Form resuls in a complete LSS without decomposition, show state
        // space polytope and mark outer states
        } else if (this.setup.lssIsValid) {
            const lss = this.setup.lss;
            this.plot.projection = autoProjection(6/5, ...lss.extent);
            stateShapes.push({ kind: "polytope", vertices: lss.xx.vertices });
            outerShapes.push(...lss.oneStepReachable.remove(lss.xx).polytopes.map(
                poly => ({ kind: "polytope", vertices: poly.vertices })
            ));
        // Form is not filled out sufficiently to preview a system
        } else {
            this.plot.projection = autoProjection(6/5);
        }
        this.layers.state.shapes = stateShapes;
        this.layers.outer.shapes = outerShapes;
    }

    drawObjectiveTerm(): void {
        const system = this._system;
        const term = this.terms.previewTerm;
        if (system == null || term == null) {
            this.layers.objective.shapes = [];
        } else {
            const shapes = [];
            for (let state of system.states.values()) {
                if (!state.isOuter && term.evalWith(_ => state.predicates.has(_.symbol))) {
                    shapes.push({ kind: "polytope", vertices: state.polytope.vertices });
                }
            }
            this.layers.objective.shapes = shapes;
        }
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
        this.node = dom.P({}, [
            dom.renderTeX("x_{t+1} =", dom.SPAN()),
            this.A.node,
            dom.renderTeX("x_t +", dom.SPAN()),
            this.B.node,
            dom.renderTeX("u_t + w_t", dom.SPAN())
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
class PolytopeInput extends ObservableMixin<null> implements Input<Polytope> {

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
            line => Halfspace.parse(line, this.variables),
            [5, 25]
        );
        this.predicates.attach(() => this.handleChange());
        let fig = new Figure();
        this.previewLayer = fig.newLayer({ "stroke": "#000", "stroke-width": "1", "fill": "#EEE" });
        this.preview = new AxesPlot([90, 90], fig, autoProjection(4/3));
        this.node = dom.DIV({ "class": "polytope-builder" }, [this.predicates.node, this.preview.node]);
        this.handleChange();
    }

    get value(): Polytope {
        return Polytope.ofDim(this.variables.length).intersection(this.predicates.value);
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
            "Invalid predicate specification '" + line.trim() + "'"
        );
        const name = match[1] == null ? "" : match[1];
        const pred = Halfspace.parse(match[2], this.variables);
        return [pred, name];
    }

}


// Objective specification
class ObjectiveInput extends ObservableMixin<null> implements Input<Objective> {

    +node: HTMLDivElement;
    +kind: Input<ObjectiveKind>;
    +coSafe: Input<boolean>;
    +terms: ObjectiveTermsInput;
    +formula: HTMLSpanElement;
    +coSafeLine: HTMLParagraphElement;

    constructor(predicates: Input<[Halfspace[], string[]]>): void {
        super();
        this.kind = new DropdownInput(presets.objectives, "Reachability");
        this.kind.attach(() => this.handleChange());
        this.coSafe = new CheckboxInput(false, "co-safe interpretation");
        this.coSafeLine = dom.P();
        this.terms = new ObjectiveTermsInput(this.kind, predicates);
        this.formula = dom.SPAN();
        this.node = dom.DIV({}, [
            dom.P({}, [this.kind.node, ": ", this.formula, ", where"]),
            this.terms.node,
            this.coSafeLine
        ]);
        this.handleChange();
    }

    get value(): Objective {
        return new Objective(
            this.kind.value, this.terms.value, (this.isCoSafeCompatible && this.coSafe.value)
        );
    }

    get text(): string {
        return this.kind.text + "\n" + this.terms.text;
    }

    set text(text: string): void {
        const lines = text.split("\n");
        if (lines.length < 2) throw new Error(
            "Invalid objective specification, requires at least two lines (name and if co-safe)"
        );
        this.kind.text = lines[0];
        this.terms.text = lines.slice(1, -1).join("\n");
        this.coSafe.text = lines[lines.length - 1];
    }

    get isValid(): boolean {
        return this.terms.isValid;
    }

    get isCoSafeCompatible(): boolean {
        return OnePairStreettAutomaton.parse(this.kind.value.automaton).isCoSafeCompatible;
    }
    
    handleChange(): void {
        const kind = this.kind.value;
        dom.renderTeX(kind.formula, this.formula);
        if (this.isCoSafeCompatible) {
            dom.replaceChildren(this.coSafeLine, [this.coSafe.node]);
        } else {
            dom.replaceChildren(this.coSafeLine, [
                this.kind.text + " objective has no co-safe interpretation"
            ]);
        }
        this.notify();
    }

}


class ObjectiveTermsInput extends ObservableMixin<null> implements Input<Proposition[]> {

    +node: HTMLDivElement;
    +kind: Input<ObjectiveKind>;
    +predicates: Input<[Halfspace[], string[]]>;
    inputs: Input<Proposition>[];
    previewTerm: ?Proposition;

    constructor(kind: Input<ObjectiveKind>, predicates: Input<[Halfspace[], string[]]>): void {
        super();
        this.kind = kind;
        this.kind.attach(() => this.updateTerms());
        this.predicates = predicates;
        this.predicates.attach(() => this.handleChange());
        this.inputs = [];
        this.previewTerm = null;
        this.node = dom.DIV({ "class": "objective-terms" });
        this.updateTerms();
    }

    get value(): Proposition[] {
        return this.inputs.map(_ => _.value);
    }

    get text(): string {
        return this.inputs.map(_ => _.text).join("\n")
    }
    
    set text(text: string): void {
        const lines = text.split("\n");
        for (let i = 0; i < this.inputs.length; i++) {
            this.inputs[i].text = (i < lines.length) ? lines[i] : "";
        }
    }

    get isValid(): boolean {
        return iter.every(this.inputs.map(_ => _.isValid));
    }

    setPreviewTerm(which: number): void {
        this.previewTerm = (which < 0 || !this.inputs[which].isValid) ? null : this.inputs[which].value;
        this.notify();
    }

    // Update term input fields to match variable requirements of objective
    updateTerms(): void {
        const variables = this.kind.value.variables;
        const inputs = [];
        const termNodes = [];
        for (let i = 0; i < variables.length; i++) {
            // TeXify name of proposition
            const label = dom.renderTeX(variables[i] + " =", dom.SPAN());
            // Preserve contents of previous term input fields
            const oldText = i < this.inputs.length ? this.inputs[i].text : "";
            const input = new LineInput(s => this.parseTerm(s), 60, oldText);
            input.attach(() => this.notify());
            inputs.push(input);
            // Preview of propositional formula in state space
            const preview = dom.SPAN({ "class": "preview" }, ["show"]);
            preview.addEventListener("mouseover", () => this.setPreviewTerm(i));
            preview.addEventListener("mouseout", () => this.setPreviewTerm(-1));
            termNodes.push(dom.P({}, [
                label, " ", input.node, " ", preview
            ]));
        }
        dom.replaceChildren(this.node, termNodes);
        this.inputs = inputs;
        this.setPreviewTerm(-1);
    }

    handleChange(): void {
        // React to changes in predicates by re-evaluating the term inputs,
        // which reference named predicates
        for (let input of this.inputs) {
            input.handleChange();
        }
        this.notify();
    }

    parseTerm(text: string): Proposition {
        const formula = parseProposition(text);
        const predicates = this.predicates.value;
        const predicateNames = new Set(predicates[1]);
        traverseProposition(prop => {
            if (prop instanceof AtomicProposition && !predicateNames.has(prop.symbol)) {
                throw new Error("Unknown linear predicate '" + prop.symbol + "'");
            }
        }, formula);
        return formula;
    }

}

