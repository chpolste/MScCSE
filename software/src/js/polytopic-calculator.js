// @flow
"use strict";

import type { FigureLayer } from "./figure.js";
import type { Halfspace, ConvexPolytope } from "./geometry.js";
import type { Vector, Matrix } from "./linalg.js";
import type { Input } from "./widgets-input.js";

import * as dom from "./dom.js";
import { Figure, autoProjection } from "./figure.js";
import { polytopeType } from "./geometry.js";
import { ObservableMixin, n2s } from "./tools.js";
import { SelectInput, SelectableNodes, MatrixInput } from "./widgets-input.js";
import { ShapePlot, AxesPlot } from "./widgets-plot.js";


const VAR_NAMES = "xy";


class PolytopeViewer {

    +input: HTMLTextAreaElement;
    +plot: AxesPlot;
    +layers: { [string]: FigureLayer };
    +vertices: SelectableNodes<Vector>;
    +halfspaces: SelectableNodes<Halfspace>;
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
        this.input.addEventListener("change", () => this.changeHandler());

        this.errorBox = dom.DIV({ "class": "error" });
        this.vertices = new SelectableNodes(PolytopeViewer.vertexToNode, "-", ", ");
        this.vertices.node.className = "vertices";
        this.vertices.attach(isClick => {
            if (!isClick) this.drawVertex();
        });
        this.halfspaces = new SelectableNodes(PolytopeViewer.halfspaceToNode, "-");
        this.halfspaces.node.className = "halfspaces";
        this.halfspaces.attach(isClick => {
            if (!isClick) this.drawHalfspace();
        });

        this.node = dom.DIV({ "class": "widget viewer" }, [
            dom.DIV({}, [dom.P({}, ["Vertex Input"]), this.input]),
            dom.DIV({}, [this.plot.node]),
            dom.DIV({}, [
                dom.P({}, ["Vertices"]), this.vertices.node,
                dom.P({}, ["Halfspaces"]), this.halfspaces.node,
                this.errorBox
            ])
        ]);
    }

    set polytope(poly: ConvexPolytope): void {
        this.input.value = JSON.stringify(poly.vertices);
        console.log(poly);
        this.changeHandler();
    }

    changeHandler(): void {
        try {
            const input = JSON.parse(this.input.value);
            const dim = input[0].length;
            const poly = polytopeType(dim).hull(input);
            if (poly.isEmpty) throw new Error("Polytope is empty");
            this.vertices.items = poly.vertices;
            this.halfspaces.items = poly.halfspaces;
            this.layers.poly.shapes = [{ "kind": "polytope", "vertices": poly.vertices }];
            this.plot.projection = autoProjection(4/3, ...poly.extent);
            this.setError();
        } catch (err) {
            this.halfspaces.items = [];
            this.vertices.items = [];
            this.layers.poly.shapes = [];
            this.plot.projection = autoProjection(4/3);
            this.setError(err.message);
        }
    }

    drawVertex(): void {
        const v = this.vertices.hoverSelection;
        this.layers.vertex.shapes = v == null ? [] : [{ kind: "arrow", origin: v, target: v }];
    }

    drawHalfspace(): void {
        const h = this.halfspaces.hoverSelection;
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

    static vertexToNode(v: Vector): HTMLSpanElement {
        return dom.SPAN({}, ["[" + v.map(_ => n2s(_, 3)).join(", ") + "]"]);
    }

    static halfspaceToNode(h: Halfspace): HTMLDivElement {
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
        return dom.DIV({}, [
            dom.DIV({}, [terms.join(" ")]),
            dom.DIV({}, [" < "]),
            dom.DIV({}, [n2s(h.offset)])
        ]);
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
        const send = dom.BUTTON({}, ["send to viewer"]);
        send.addEventListener("click", () => this.sendToViewer())
        // Preview
        const fig = new Figure();
        this.layer = fig.newLayer({ "stroke": "#000", "fill": "#EEE" });
        this.plot = new ShapePlot([100, 100], fig, autoProjection(1));
        // 2-column layout
        this.node = dom.DIV({ "class": "polytope-input" }, [
            this.input,
            dom.DIV({}, [send, this.plot.node])
        ]);
        this.handleChange();
    }
    
    get polytope(): ConvexPolytope {
        const input = JSON.parse(this.input.value);
        if (input.length === 0) throw new Error("polytope is empty");
        const dim = input[0].length;
        return polytopeType(dim).hull(input);
    }

    set polytope(polytope: ?ConvexPolytope): void {
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
    +transformation: Input<(ConvexPolytope, any) => ConvexPolytope>;
    +transformationForm: HTMLParagraphElement;
    +matrix: HTMLTextAreaElement;
    +errorBox: HTMLDivElement;
    +node: HTMLDivElement;

    constructor(viewer: PolytopeViewer): void {
        this.input = new PolytopeForm(viewer, false);
        this.input.attach(() => this.handleChange());

        this.matrix = dom.TEXTAREA({ "cols": "15", "rows": "4" });
        this.matrix.addEventListener("change", () => this.handleChange());

        this.transformationForm = dom.P();
        this.transformation = new SelectInput({
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

    +op: SelectInput<(ConvexPolytope, ConvexPolytope) => ConvexPolytope>;
    +arg1: PolytopeForm;
    +arg2: PolytopeForm;
    +result: PolytopeForm;
    +errorBox: HTMLDivElement;
    +node: HTMLDivElement;

    constructor(viewer: PolytopeViewer): void {
        this.op = new SelectInput({
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



// Assemble the app
document.addEventListener("DOMContentLoaded", function () {

    const viewer = new PolytopeViewer();
    const widget = dom.DIV();
    const widgets = new SelectInput({
        "Transformations": new TransformationWidget(viewer),
        "Minkowski/Pontryagin": new MinkowskiPontryaginWidget(viewer)
    }, "Transformations");
    widgets.attach(() => dom.replaceChildren(widget, [widgets.value.node]));
    // Initialize
    widgets.notify();

    const contentNode = document.getElementById("content");
    if (contentNode == null) throw new Error();
    dom.replaceChildren(contentNode, [
        viewer.node,
        dom.DIV({ "class": "widget" }, [widgets.node]),
        widget
    ]);

});

