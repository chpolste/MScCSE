// @flow
"use strict";

import * as dom from "./dom.js";
import { n2s } from "./tools.js";
import { Polygon, union } from "./geometry.js";
import { Figure, autoProjection } from "./figure.js";
import { InteractivePlot } from "./widgets-plot.js";
import { LineInput, SelectableNodes } from "./widgets-input.js";


type PolytopeItem = {
    polytope: Polygon,
    fill: string
}

document.addEventListener("DOMContentLoaded", function () {

    const contentNode = document.getElementById("content");
    if (contentNode == null) throw new Error();

    const fig = new Figure();
    const plot = new InteractivePlot([100, 100], fig, autoProjection(1));

    // Mouseover polytope
    const high2Layer = fig.newLayer({ "fill": "none", "stroke": "#000", "stroke-width": "3" });
    // Selected polytope
    const high1Layer = fig.newLayer({ "fill": "#069" });
    // All polytopes
    const polyLayer = fig.newLayer({ "fill": "none", "stroke": "#000", "stroke-width": "1" });

    // ...
    const $polytopes: PolytopeItem[] = [];

    function refreshPlot(): void {
        const sx = plotSizeX.value;
        const sy = plotSizeY.value;
        // Resize
        plot.size = [sx, sy];
        // Update projection
        if ($polytopes.length === 0) {
            plot.projection = autoProjection(sx/sy);
        } else {
            plot.projection = autoProjection(sx/sy, ...union.extent($polytopes.map(_ => _.polytope)));
        }
        plot.referenceProjection = plot.projection;
    }

    function refreshShapes(): void {
        polyLayer.shapes = $polytopes.map(_ => ({
            kind: "polytope",
            vertices: _.polytope.vertices
        }));
    }

    // Plot resize inputs
    const plotSizeX = new LineInput(_ => parseInt(_), 5, "600");
    const plotSizeY = new LineInput(_ => parseInt(_), 5, "600");
    plotSizeX.attach(refreshPlot);
    plotSizeY.attach(refreshPlot);

    // Interactive list of all displayed polytopes
    const polyList = new SelectableNodes((item: PolytopeItem) => {
        return dom.DIV({ "class": "poly" }, [
            "Vertices: ", item.polytope.vertices.map(_ => "[" + _.map(n => n2s(n, 2)).join(",") + "]").join(", ")
        ]);
    }, "no polygons");

    polyList.attach(() => {
        const clicked = polyList.selection;
        high1Layer.shapes = clicked != null ? [{ kind: "polytope", vertices: clicked.polytope.vertices }] : [];
        const hovered = polyList.hoverSelection;
        high2Layer.shapes = hovered != null ? [{ kind: "polytope", vertices: hovered.polytope.vertices }] : [];
    });

    // New polygon input
    const shapeInput = dom.TEXTAREA({ rows: "6", cols: "50" }, []);
    const addShape = dom.BUTTON({}, ["add"]);
    addShape.addEventListener("click", function () {
        try {
            const raw = shapeInput.value;
            const arr = JSON.parse(raw);
            const poly = Polygon.hull(arr);
            $polytopes.push({ polytope: poly, fill: "none" });
            if ($polytopes.length === 1) refreshPlot();
            polyList.items = $polytopes;
            refreshShapes();
        } catch (err) {
            console.log(err.message);
        }
    });

    // Initialize
    refreshPlot();

    // Build application
    dom.replaceChildren(contentNode, [
        dom.DIV({ "class": "col-l" }, [
            plot.node,
            dom.H3({}, ["Settings"]),
            dom.P({}, ["Size of preview: ", plotSizeX.node, " by ", plotSizeY.node])
        ]),
        dom.DIV({ "class": "col-r" }, [
            dom.H3({}, [addShape, " a polygon"]),
            shapeInput,
            dom.H3({}, ["Polygons"]),
            polyList.node
        ])
    ]);

});

