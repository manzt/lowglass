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

const N = 100000;
const [w, h] = [600, 600];
const data = /** @type {const} */ ([
  Float32Array.from({ length: N }).map((_) => (Math.random() - 0.5) * 2),
  Float32Array.from({ length: N }).map((_) => (Math.random() - 0.5) * 2),
]);
const scales = create_scales(data, w, h);

const canvas = create_canvas({ width: w, height: h });
const context = canvas.getContext("webgpu");
if (!context) {
  throw new Error("WebGPU is not supported");
}

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format });

const [x_buffer, y_buffer] = data.map((arr) => {
  const buffer = device.createBuffer({
    size: arr.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Float32Array(buffer.getMappedRange()).set(arr);
  buffer.unmap();
  return buffer;
});

const xylayout = device.createBindGroupLayout({
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: { type: "read-only-storage" },
    },
    {
      binding: 1,
      visibility: GPUShaderStage.VERTEX,
      buffer: { type: "read-only-storage" },
    },
  ],
});

const uniforms = new Float32Array(50);
const u_zoom = uniforms.subarray(0, 16);
const u_window_scale = uniforms.subarray(16, 32);
const u_untransform = uniforms.subarray(32, 48);
const ubuffer = device.createBuffer({
  size: uniforms.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
{
  const mats = window_transform(scales.x, scales.y, w, h);
  u_window_scale.set(mats[0]);
  u_untransform.set(mats[1]);
}

const ulayout = device.createBindGroupLayout({
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: { type: "uniform" },
    },
  ],
});
const module = device.createShaderModule({
  code: await fetch(new URL("shader.wgsl", import.meta.url)).then((r) =>
    r.text()
  ),
});
const pipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout({
    bindGroupLayouts: [xylayout, ulayout],
  }),
  vertex: { module, entryPoint: "vert", buffers: [] },
  fragment: {
    module,
    entryPoint: "frag",
    targets: [
      {
        format,
        blend: {
          color: {
            srcFactor: "src-alpha",
            dstFactor: "one-minus-src-alpha",
            operation: "add",
          },
          alpha: {
            srcFactor: "src-alpha",
            dstFactor: "one-minus-src-alpha",
            operation: "add",
          },
        },
      },
    ],
  },
  primitive: { topology: "triangle-list" },
});

const xygroup = device.createBindGroup({
  layout: xylayout,
  entries: [
    { binding: 0, resource: { buffer: x_buffer } },
    { binding: 1, resource: { buffer: y_buffer } },
  ],
});

const ugroup = device.createBindGroup({
  layout: ulayout,
  entries: [{ binding: 0, resource: { buffer: ubuffer } }],
});

function render() {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        clearValue: [1, 1, 1, 1],
        loadOp: "clear",
        storeOp: "store",
        view: context.getCurrentTexture().createView(),
      },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, xygroup);
  pass.setBindGroup(1, ugroup);
  pass.draw(6, N);
  pass.end();
  device.queue.submit([encoder.finish()]);
}

function zoomed({ k, x, y }) {
  const mat = [
    [k, 0, 0, 0],
    [0, k, 0, 0],
    [0, 0, 1, 0],
    [x, y, 0, 1],
  ];
  u_zoom.set(mat.flat());
  device.queue.writeBuffer(ubuffer, 0, uniforms);
  render();
}

d3.select(context.canvas).call(
  d3
    .zoom()
    .scaleExtent([0.1, 1000])
    .on("zoom", ({ transform }) => zoomed(transform)),
);

zoomed(d3.zoomIdentity);

document.body.appendChild(canvas);
