import * as d3 from "https://esm.sh/d3@7.8.5";

export function create_canvas({ width, height } = {}) {
  let dpr = window.devicePixelRatio || 1;
  let canvas = Object.assign(document.createElement("canvas"), {
    width: width * dpr,
    height: height * dpr
  });
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  return canvas;
}

export function window_transform(x_scale, y_scale, width, height) {
  // A function that creates the two matrices a webgl shader needs, in addition to the zoom state,
  // to stay aligned with canvas and d3 zoom.

  // width and height are svg parameters; x and y scales project from the data x and y into the
  // the webgl space.

  // Given two d3 scales in coordinate space, create two matrices that project from the original
  // space into [-1, 1] webgl space.

  // return the magnitude of a scale.
  let gap = (arr) => arr[1] - arr[0];
  let x_mid = d3.mean(x_scale.domain());
  let y_mid = d3.mean(y_scale.domain());

  let xmulti = gap(x_scale.range()) / gap(x_scale.domain());
  let ymulti = gap(y_scale.range()) / gap(y_scale.domain());

  // translates from data space to scaled space.
  const m1 = [
    [xmulti, 0, 0, 0],
    [0, ymulti, 0, 0],
    [0, 0, 1, 0],
    [
      -xmulti * x_mid + d3.mean(x_scale.range()),
      -ymulti * y_mid + d3.mean(y_scale.range()),
      0,
      1
    ]
  ];

  // translate from scaled space to webgl space.
  // The '2' here is because webgl space runs from -1 to 1; the shift at the end is to
  // shift from [0, 2] to [-1, 1]
  const m2 = [
    [2 / width, 0, 0, 0], // First column
    [0, -2 / height, 0, 0], // Second column
    [0, 0, 1, 0], // Third column (unchanged for z-axis in 2D transformations)
    [-1, 1, 0, 1] // Fourth column, with translations adjusted for WebGL space
  ];

  return [m1.flat(), m2.flat()];
}

export function create_scales(data, w, h) {
  let square_box = d3.min([w, h]);
  let d = { x: data[0], y: data[1] };
  let scales = {};
  for (let [name, dim] of [["x", w], ["y", h]]) {
    let buffer = (dim - square_box) / 2;
    scales[name] = d3
      .scaleLinear()
      .domain(d3.extent(d[name]))
      .range([buffer, dim - buffer]);
  }
  return scales;
}
