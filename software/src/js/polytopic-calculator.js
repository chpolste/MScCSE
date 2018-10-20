// @flow
"use strict";

import type { FigureLayer } from "./figure.js";
import type { Halfspace } from "./geometry.js";
import type { Vector } from "./linalg.js";

import * as dom from "./dom.js";
import { Figure, autoProjection } from "./figure.js";
import { polytopeType } from "./geometry.js";
import { n2s } from "./tools.js";
import { SelectInput, SelectableNodes, MatrixInput } from "./widgets-input.js";
import { AxesPlot } from "./widgets-plot.js";


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
            poly: fig.newLayer({ "stroke": "#000", "fill": "none" }),
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

        this.node = dom.DIV({ "class": "viewer cols" }, [
            dom.DIV({ "class": "left" }, [dom.P({}, ["Vertex Input"]), this.input]),
            dom.DIV({ "class": "left" }, [this.plot.node]),
            dom.DIV({ "class": "right" }, [
                dom.P({}, ["Vertices"]), this.vertices.node,
                dom.P({}, ["Halfspaces"]), this.halfspaces.node,
                this.errorBox
            ])
        ]);
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




// Assemble the app
document.addEventListener("DOMContentLoaded", function () {

    const polytopeViewer = new PolytopeViewer();

    const contentNode = document.getElementById("content");
    if (contentNode == null) throw new Error();
    dom.replaceChildren(contentNode, [
        dom.DIV({ "class": "widget" }, [polytopeViewer.node]),
        //dom.DIV({ "class": "widget" }, [
            //dom.P({}, ["Evolution Equation Evaluation"]),
            //dom.P({}, ["2-Operator"]),
            //dom.P({}, ["3-Operator"])
        //]),
        //dom.DIV({ "class": "widget" }, [
            //dom.P({}, ["Transformation"])
        //]),
        //dom.DIV({ "class": "widget" }, [
            //dom.P({}, ["Minkowski Sum/Pontryagin Difference"])
        //])
    ]);


});
