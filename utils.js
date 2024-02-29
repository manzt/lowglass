/// <reference types="npm:@types/d3" />
import * as d3 from "https://esm.sh/d3@7.8.5";

/** @param {{ width: number, height: number }} options */
export function create_canvas({ width, height }) {
  const dpr = globalThis.devicePixelRatio || 1;
  const canvas = Object.assign(document.createElement("canvas"), {
    width: width * dpr,
    height: height * dpr,
  });
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  return canvas;
}

/**
 * @param {import("npm:@types/d3").ScaleLinear<number, number>} xScale
 * @param {import("npm:@types/d3").ScaleLinear<number, number>} yScale
 * @param {number} width
 * @param {number} height
 */
export function window_transform(xScale, yScale, width, height) {
  // A function that creates the two matrices a webgl shader needs, in addition to the zoom state,
  // to stay aligned with canvas and d3 zoom.

  // width and height are svg parameters; x and y scales project from the data x and y into the
  // the webgl space.

  // Given two d3 scales in coordinate space, create two matrices that project from the original
  // space into [-1, 1] webgl space.

  // return the magnitude of a scale.
  const gap = (/** @type{[number, number]} */ arr) => arr[1] - arr[0];
  const x_mid = d3.mean(xScale.domain());
  const y_mid = d3.mean(yScale.domain());

  // @ts-expect-error - range and domain are defined
  const xmulti = gap(xScale.range()) / gap(xScale.domain());
  // @ts-expect-error - range and domain are defined
  const ymulti = gap(yScale.range()) / gap(yScale.domain());

  // translates from data space to scaled space.
  const m1 = [
    [xmulti, 0, 0, 0],
    [0, ymulti, 0, 0],
    [0, 0, 1, 0],
    [
      -xmulti * x_mid + d3.mean(xScale.range()),
      -ymulti * y_mid + d3.mean(yScale.range()),
      0,
      1,
    ],
  ];

  // translate from scaled space to webgl space.
  // The '2' here is because webgl space runs from -1 to 1; the shift at the end is to
  // shift from [0, 2] to [-1, 1]
  const m2 = [
    [2 / width, 0, 0, 0], // First column
    [0, -2 / height, 0, 0], // Second column
    [0, 0, 1, 0], // Third column (unchanged for z-axis in 2D transformations)
    [-1, 1, 0, 1], // Fourth column, with translations adjusted for WebGL space
  ];

  return [m1.flat(), m2.flat()];
}

/**
 * @param {[ArrayLike<number>, ArrayLike<number>]} data
 * @param {number} w
 * @param {number} h
 */
export function create_scales(data, w, h) {
  const square_box = d3.min([w, h]);
  const d = { x: data[0], y: data[1] };
  const scales = {
    x: d3.scaleLinear(),
    y: d3.scaleLinear(),
  };
  for (const [name, dim] of /** @type {const} */ ([["x", w], ["y", h]])) {
    const buffer = (dim - square_box) / 2;
    scales[name] = scales[name]
      .domain(d3.extent(d[name]))
      .range([buffer, dim - buffer]);
  }
  return scales;
}
