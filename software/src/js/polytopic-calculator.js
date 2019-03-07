// @flow
"use strict";

import type { FigureLayer } from "./figure.js";
import type { Vector, Matrix } from "./linalg.js";
import type { Input } from "./widgets-input.js";

import * as dom from "./dom.js";
import { Figure, autoProjection } from "./figure.js";
import { Halfspace, Polytope } from "./geometry.js";
import { minkowski, apply } from "./linalg.js";
import { just, ObservableMixin, n2s, arr } from "./tools.js";
import { DropdownInput, MatrixInput } from "./widgets-input.js";
import { ShapePlot, AxesPlot } from "./widgets-plot.js";


const VAR_NAMES = "xy";


function texifyVertex(v: Vector): string {
    if (v.length === 1) {
        return "\\OneByOne{" + n2s(v[0], 4) + "}";
    } else if (v.length === 2) {
        return "\\TwoByOne{" + n2s(v[0], 4) + "}{" + n2s(v[1], 4) + "}";
    }
    throw new Error();
}


class PolytopeViewer {

    +input: HTMLTextAreaElement;
    +plot: AxesPlot;
    +layers: { [string]: FigureLayer };
    +vertices: HTMLDivElement;
    +halfspaces: HTMLDivElement;
    +tex: HTMLTextAreaElement;
    +errorBox: HTMLDivElement;
    +node: HTMLDivElement;

    constructor(): void {

        const fig = new Figure();
        this.layers = {
            poly: fig.newLayer({ "stroke": "#000", "fill": "#EEE" }),
            halfspace: fig.newLayer({ "stroke": "#000", "fill": "#000", "fill-opacity": "0.2" }),
            vertex: fig.newLayer({ "stroke": "#000", "stroke-width": "5", "fill": "#000" })
        };
        this.plot = new AxesPlot([400, 300], fig, autoProjection(4/3));

        this.input = dom.TEXTAREA({ "cols": "30", "rows": "10" }, []);
        this.input.addEventListener("change", () => this.handleChange());

        this.errorBox = dom.DIV({ "class": "error" });
        this.vertices = dom.DIV({ "class": "vertices" }, ["-"]);
        this.halfspaces = dom.DIV({ "class": "halfspaces" }, ["-"]);
        this.tex = dom.TEXTAREA({ "class": "tex", "rows": "3", "cols": "60" });

        this.node = dom.DIV({ "class": "widget viewer" }, [
            dom.DIV({}, [dom.P({}, ["Vertex Input"]), this.input]),
            dom.DIV({}, [this.plot.node]),
            dom.DIV({}, [
                dom.P({}, ["TeX"]), this.tex,
                dom.P({}, ["Vertices"]), this.vertices,
                dom.P({}, ["Halfspaces"]), this.halfspaces,
                this.errorBox
            ])
        ]);
    }

    set polytope(poly: Polytope): void {
        this.input.value = JSON.stringify(poly.vertices);
        this.handleChange();
    }

    handleChange(): void {
        try {
            const input = JSON.parse(this.input.value);
            const dim = input[0].length;
            const poly = Polytope.ofDim(dim).hull(input);
            if (poly.isEmpty) throw new Error("Polytope is empty");
            dom.replaceChildren(this.vertices, arr.intersperse(", ",
                poly.vertices.map(_ => this._vertexToNode(_))
            ));
            dom.replaceChildren(this.halfspaces, poly.halfspaces.map(_ => this._halfspaceToNode(_)));
            this.tex.value = "\\Hull \\Big( \\Big\\{ " + poly.vertices.map(texifyVertex).join(", ") + " \\Big\\} \\Big)";
            this.layers.poly.shapes = [{ "kind": "polytope", "vertices": poly.vertices }];
            this.plot.projection = autoProjection(4/3, ...poly.extent);
            this.setError();
        } catch (err) {
            dom.replaceChildren(this.vertices, ["-"]);
            dom.replaceChildren(this.halfspaces, ["-"]);
            this.tex.value = "";
            this.layers.poly.shapes = [];
            this.plot.projection = autoProjection(4/3);
            this.setError(err.message);
        }
    }

    drawVertex(v: ?Vector): void {
        this.layers.vertex.shapes = v == null ? [] : [{ kind: "arrow", origin: v, target: v }];
    }

    drawHalfspace(h: ?Halfspace): void {
        this.layers.halfspace.shapes = h == null ? [] : [{
            kind: "halfspace", normal: h.normal, offset: h.offset
        }];
    }

    setError(message: ?string): void {
        if (message == null) {
            dom.removeChildren(this.errorBox);
        } else {
            dom.replaceChildren(this.errorBox, [message]);
        }
    }

    _vertexToNode(v: Vector): HTMLSpanElement {
        const node = dom.SPAN({ "class": "item" }, ["[" + v.map(_ => n2s(_, 3)).join(", ") + "]"]);
        node.addEventListener("mouseover", () => this.drawVertex(v));
        node.addEventListener("mouseout", () => this.drawVertex(null));
        return node;
    }

    _halfspaceToNode(h: Halfspace): HTMLDivElement {
        const terms = [];
        for (let i = 0; i < h.dim; i++) {
            if (h.normal[i] === 0) {
                continue
            } else if (h.normal[i] < 0) {
                terms.push("-");
            } else if (terms.length > 0) {
                terms.push("+");
            }
            if (h.normal[i] !== 1 && h.normal[i] !== -1) {
                terms.push(n2s(Math.abs(h.normal[i])));
            }
            terms.push(VAR_NAMES[i]);
        }
        const node = dom.DIV({ "class": "item" }, [
            dom.DIV({}, [terms.join(" ")]),
            dom.DIV({}, [" < "]),
            dom.DIV({}, [n2s(h.offset)])
        ]);
        node.addEventListener("mouseover", () => this.drawHalfspace(h));
        node.addEventListener("mouseout", () => this.drawHalfspace(null));
        return node;
    }

}


class PolytopeForm extends ObservableMixin<null> {

    +viewer: PolytopeViewer;
    +input: HTMLTextAreaElement;
    +plot: ShapePlot;
    +layer: FigureLayer;
    +node: HTMLDivElement;

    constructor(viewer: PolytopeViewer, readOnly: boolean): void {
        super();
        this.viewer = viewer;
        // Vertex input
        this.input = dom.TEXTAREA({ "cols": "15", "rows": "8" })
        if (!readOnly) this.input.addEventListener("change", () => this.handleChange());
        // Connect to viewer
        const send = dom.createButton({}, ["send to viewer"], () => this.sendToViewer());
        // Preview
        const fig = new Figure();
        this.layer = fig.newLayer({ "stroke": "#000", "fill": "#EEE" });
        this.plot = new ShapePlot([100, 100], fig, autoProjection(1));
        // 2-column layout
        let cls = "polytope-input";
        if (readOnly) cls += " read-only";
        this.node = dom.DIV({ "class": cls }, [
            this.input,
            dom.DIV({}, [send, this.plot.node])
        ]);
        this.handleChange();
    }

    get text(): string {
        return this.input.value;
    }

    set text(txt: string): void {
        this.input.value = txt;
        this.handleChange();
    }
    
    get polytope(): Polytope {
        const input = JSON.parse(this.input.value);
        if (input.length === 0) throw new Error("polytope is empty");
        const dim = input[0].length;
        return Polytope.ofDim(dim).hull(input);
    }

    set polytope(polytope: ?Polytope): void {
        this.input.value = polytope != null ? JSON.stringify(polytope.vertices) : "";
        this.handleChange();
    }

    handleChange(): void {
        try {
            const polytope = this.polytope;
            if (polytope.isEmpty) throw new Error("Polytope is empty");
            this.layer.shapes = [{ "kind": "polytope", "vertices": polytope.vertices }];
            this.plot.projection = autoProjection(1, ...polytope.extent);
            this.setError();
        } catch (err) {
            this.layer.shapes = [];
            this.plot.projection = autoProjection(1);
            this.setError(err.message);
        }
        this.notify();
    }

    sendToViewer(): void {
        if (this.polytope != null) {
            this.viewer.polytope = this.polytope;
        }
    }

    setError(message?: string): void {
        this.input.className = message == null ? "" : "error";
        this.input.title = message == null ? "" : message;
    }

}


function progressDiv(text?: string): HTMLDivElement {
    if (text == null) text = "▶";
    return dom.DIV({ "class": "progress" }, [text]);
}


class TransformationWidget {

    +input: PolytopeForm;
    +output: PolytopeForm;
    +transformation: Input<(Polytope, any) => Polytope>;
    +transformationForm: HTMLParagraphElement;
    +matrix: HTMLTextAreaElement;
    +errorBox: HTMLDivElement;
    +node: HTMLDivElement;

    constructor(viewer: PolytopeViewer): void {
        this.input = new PolytopeForm(viewer, false);
        this.input.attach(() => this.handleChange());

        this.matrix = dom.TEXTAREA({ "cols": "15", "rows": "3" });
        this.matrix.addEventListener("change", () => this.handleChange());

        this.transformationForm = dom.P();
        this.transformation = new DropdownInput({
            "apply left": (p, m) => p.apply(m),
            "apply right": (p, m) => p.applyRight(m),
            "translate": (p, m) => p.translate(m)
        }, "apply left");
        this.transformation.attach(() => this.handleChange());

        this.output = new PolytopeForm(viewer, true);
        this.errorBox = dom.DIV({ "class": "error" });

        this.node = dom.DIV({ "class": "widget" }, [
            this.input.node,
            progressDiv(),
            dom.DIV({}, [
                dom.P({}, [this.transformation.node]),
                this.matrix
            ]),
            progressDiv(),
            this.output.node,
            this.errorBox
        ]);

        this.handleChange();
    }

    handleChange(): void {
        try {
            const polytope = this.input.polytope;
            const matrix = JSON.parse(this.matrix.value);
            this.output.polytope = this.transformation.value(polytope, matrix);
            dom.removeChildren(this.errorBox);
        } catch (err) {
            this.output.polytope = null;
            dom.replaceChildren(this.errorBox, [err.message]);
        }
    }

}


class MinkowskiPontryaginWidget {

    +op: DropdownInput<(Polytope, Polytope) => Polytope>;
    +arg1: PolytopeForm;
    +arg2: PolytopeForm;
    +result: PolytopeForm;
    +errorBox: HTMLDivElement;
    +node: HTMLDivElement;

    constructor(viewer: PolytopeViewer): void {
        this.op = new DropdownInput({
            "+": (p, q) => p.minkowski(q),
            "-": (p, q) => p.pontryagin(q)
        });
        this.op.attach(() => this.handleChange());
        this.arg1 = new PolytopeForm(viewer, false);
        this.arg1.attach(() => this.handleChange());
        this.arg2 = new PolytopeForm(viewer, false);
        this.arg2.attach(() => this.handleChange());
        this.result = new PolytopeForm(viewer, true);
        this.errorBox = dom.DIV({ "class": "error" });
        this.node = dom.DIV({ "class": "widget" }, [
            this.arg1.node,
            dom.DIV({}, [this.op.node]),
            this.arg2.node,
            progressDiv("="),
            this.result.node,
            this.errorBox
        ]);
        this.handleChange();
    }

    handleChange(): void {
        try {
            const arg1 = this.arg1.polytope;
            const arg2 = this.arg2.polytope;
            this.result.polytope = this.op.value(arg1, arg2);
            dom.removeChildren(this.errorBox);
        } catch (err) {
            this.result.polytope = null;
            dom.replaceChildren(this.errorBox, [err.message]);
        }
    }

}


class OperatorsWidget extends ObservableMixin<null> {

    +matrixA: HTMLTextAreaElement;
    +matrixB: HTMLTextAreaElement;
    +inputs: { [string]: PolytopeForm };
    +op: Input<(Matrix, Matrix) => Polytope>;
    +node: HTMLDivElement;

    constructor(viewer: PolytopeViewer): void {
        super();
        this.matrixA = dom.TEXTAREA({ "cols": "15", "rows": "3" });
        this.matrixA.addEventListener("change", () => this.handleChange());
        this.matrixB = dom.TEXTAREA({ "cols": "15", "rows": "3" });
        this.matrixB.addEventListener("change", () => this.handleChange());

        this.inputs = {
            x: new PolytopeForm(viewer, false),
            u: new PolytopeForm(viewer, false),
            y: new PolytopeForm(viewer, false),
            w: new PolytopeForm(viewer, false),
            r: new PolytopeForm(viewer, true)
        };
        this.inputs.x.attach(() => this.handleChange());
        this.inputs.u.attach(() => this.handleChange());
        this.inputs.y.attach(() => this.handleChange());
        this.inputs.w.attach(() => this.handleChange());

        this.op = new DropdownInput({
            "Post(X, U)": (A, B) => this.post(A, B),
            "Act(X, {Y})": (A, B) => this.act(A, B),
            "ActR(X, {Y})": (A, B) => this.actR(A, B),
            "Pre(X, U, {Y})": (A, B) => this.pre(A, B),
            "PreR(X, U, {Y})": (A, B) => this.preR(A, B)
        }, "Post(X, U)");
        this.op.attach(() => this.handleChange());

        this.node = dom.DIV({}, [
            dom.DIV({ "class": "widget" }, [
                progressDiv("x' = "),
                dom.DIV({ "class": "eq-matrix" }, [this.matrixA]),
                progressDiv("x + "),
                dom.DIV({ "class": "eq-matrix" }, [this.matrixB]),
                progressDiv("u + w")
            ]),
            dom.DIV({ "class": "widget" }, [
                dom.DIV({}, [dom.P({}, ["X"]), this.inputs.x.node]),
                dom.DIV({}, [dom.P({}, ["U"]), this.inputs.u.node]),
                dom.DIV({}, [dom.P({}, ["Y"]), this.inputs.y.node]),
                dom.DIV({}, [dom.P({}, ["W"]), this.inputs.w.node])
            ]),
            dom.DIV({ "class": "widget" }, [
                dom.DIV({}, [this.op.node]),
                progressDiv("="),
                this.inputs.r.node
            ])
        ]);

        this.handleChange();
    }

    handleChange(): void {
        try {
            const A = JSON.parse(this.matrixA.value);
            const B = JSON.parse(this.matrixB.value);
            this.inputs.r.polytope = this.op.value(A, B);
        } catch (err) {
            this.inputs.r.polytope = null;
        }
        this.notify();
    }

    // TODO: use proper union-based operators from system

    post(A: Matrix, B: Matrix): Polytope {
        const x = this.inputs.x.polytope;
        const u = this.inputs.u.polytope;
        const w = this.inputs.w.polytope;
        return Polytope.ofDim(x.dim).hull(
            minkowski.axpy(A, x.vertices, minkowski.axpy(B, u.vertices, w.vertices))
        );
    }

    act(A: Matrix, B: Matrix): Polytope {
        const x = this.inputs.x.polytope;
        const y = this.inputs.y.polytope;
        const w = this.inputs.w.polytope;
        return Polytope.ofDim(x.dim).hull(
            minkowski.xmy(y.vertices, minkowski.axpy(A, x.vertices, w.vertices))
        ).applyRight(B);
    }

    actR(A: Matrix, B: Matrix): Polytope {
        const x = this.inputs.x.polytope;
        const y = this.inputs.y.polytope;
        const w = this.inputs.w.polytope;
        const poly = Polytope.ofDim(x.dim).hull(minkowski.axpy(A, x.vertices, w.vertices));
        return y.pontryagin(poly).applyRight(B);
    }


    pre(A: Matrix, B: Matrix): Polytope {
        const x = this.inputs.x.polytope;
        const u = this.inputs.u.polytope;
        const y = this.inputs.y.polytope;
        const w = this.inputs.w.polytope;
        const Bus = u.vertices.map(_ => apply(B, _));
        return Polytope.ofDim(x.dim).hull(
            minkowski.xmy(y.vertices, minkowski.axpy(B, u.vertices, w.vertices))
        ).applyRight(A).intersect(x);
    }

    preR(A: Matrix, B: Matrix): Polytope {
        const x = this.inputs.x.polytope;
        const u = this.inputs.u.polytope;
        const y = this.inputs.y.polytope;
        const w = this.inputs.w.polytope;
        const Bus = u.vertices.map(_ => apply(B, _));
        return Polytope.ofDim(x.dim).hull(
            minkowski.xmy(y.pontryagin(w).vertices, Bus)
        ).applyRight(A).intersect(x);
    }

    serialize(): { [string]: string } {
        return {
            "A": this.matrixA.value,
            "B": this.matrixB.value,
            "X": this.inputs.x.text,
            "U": this.inputs.u.text,
            "Y": this.inputs.y.text,
            "W": this.inputs.w.text
        };
    }

    load(data: { [string]: string }): void {
        this.matrixA.value = data.A;
        this.matrixB.value = data.B;
        this.inputs.x.text = data.X;
        this.inputs.u.text = data.U;
        this.inputs.y.text = data.Y;
        this.inputs.w.text = data.W;
    }

}


function toExportURL(ops: OperatorsWidget): string {
    const data = ops.serialize();
    return window.btoa(JSON.stringify(data));
}



// Assemble the app
document.addEventListener("DOMContentLoaded", function () {

    const viewer = new PolytopeViewer();

    const operators = new OperatorsWidget(viewer);

    const widget = dom.DIV();
    const widgets = new DropdownInput({
        "Transformations": new TransformationWidget(viewer),
        "Minkowski/Pontryagin": new MinkowskiPontryaginWidget(viewer),
        "Polytopic Operators": operators
    }, "Polytopic Operators");
    widgets.attach(() => dom.replaceChildren(widget, [widgets.value.node]));
    // Initialize
    widgets.notify();

    const contentNode = just(document.getElementById("content"));
    dom.replaceChildren(contentNode, [
        viewer.node,
        dom.DIV({ "class": "widget" }, [widgets.node]),
        widget
    ]);

    // Load from #-part of URL if set at startup
    if (window.location.hash.length > 0) {
        const hash = window.location.hash.substring(1);
        const data = JSON.parse(window.atob(hash));
        operators.load(data);
    }

    operators.attach(() => {
        window.location.hash = "#" + toExportURL(operators);
    });

});

