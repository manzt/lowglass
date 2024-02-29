import * as d3 from "https://esm.sh/d3@7.8.5";
import * as lib from "./lib.js";

let N = 100000;
let [w, h] = [600, 600];
let data = [
  Float32Array.from({ length: N }).map((_) => (Math.random() - 0.5) * 2),
  Float32Array.from({ length: N }).map((_) => (Math.random() - 0.5) * 2),
];
let scales = lib.create_scales(data, w, h);

let canvas = lib.create_canvas({ width: w, height: h });
let context = canvas.getContext("webgpu");
let adapter = await navigator.gpu.requestAdapter();
let device = await adapter.requestDevice();
let format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format });

let [x_buffer, y_buffer] = data.map((arr) => {
  let buffer = device.createBuffer({
    size: arr.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Float32Array(buffer.getMappedRange()).set(arr);
  buffer.unmap();
  return buffer;
});

let xylayout = device.createBindGroupLayout({
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

let uniforms = new Float32Array(50);
let u_zoom = uniforms.subarray(0, 16);
let u_window_scale = uniforms.subarray(16, 32);
let u_untransform = uniforms.subarray(32, 48);
let ubuffer = device.createBuffer({
  size: uniforms.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
{
  let mats = lib.window_transform(scales.x, scales.y, w, h);
  u_window_scale.set(mats[0]);
  u_untransform.set(mats[1]);
}

let ulayout = device.createBindGroupLayout({
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: { type: "uniform" },
    },
  ],
});
let code = `
@group(0) @binding(0) var<storage, read> x_values : array<f32>;
@group(0) @binding(1) var<storage, read> y_values : array<f32>;
@group(1) @binding(0) var<uniform> uni: Uniforms;
struct Uniforms {
zoom: mat4x4<f32>,
window_scale: mat4x4<f32>,
untransform: mat4x4<f32>,
};
struct VertexOutput {
@builtin(position) pos: vec4<f32>,
@location(1) quad_position: vec2f,
};

@vertex
fn vert(@builtin(instance_index) instance_index: u32, @builtin(vertex_index) vertex_index: u32) -> VertexOutput {
let x = x_values[instance_index];
let y = y_values[instance_index];
let t = uni.untransform * uni.zoom * uni.window_scale;
let k = uni.zoom[0][0];
let size = exp(log(k) * 0.5)/ 1000.0;
let quad_pos = array(
  vec2f(0, 0),
  vec2f(1, 0),
  vec2f(0, 1),
  vec2f(0, 1),
  vec2f(1, 0),
  vec2f(1, 1),
); 
let qp = quad_pos[vertex_index] - 0.5;
let xy = vec4<f32>(x, y, 1.0, 1.0) + vec4f(qp * size, 0.0, 0.0);
let pos = t * xy;
return VertexOutput(pos, qp);
}

const center: vec2<f32> = vec2<f32>(0.0, 0.0);

@fragment fn frag(input: VertexOutput) -> @location(0) vec4<f32> {
if (distance(input.quad_position, center) > 0.5) {
  discard;
}
let opacity = 0.5;
return vec4<f32>(0.0, 0.0, 0.0, opacity);
}
`;
let module = device.createShaderModule({ code });
let pipeline = device.createRenderPipeline({
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

let xygroup = device.createBindGroup({
  layout: xylayout,
  entries: [
    { binding: 0, resource: { buffer: x_buffer } },
    { binding: 1, resource: { buffer: y_buffer } },
  ],
});

let ugroup = device.createBindGroup({
  layout: ulayout,
  entries: [{ binding: 0, resource: { buffer: ubuffer } }],
});

function render() {
  let encoder = device.createCommandEncoder();
  let pass = encoder.beginRenderPass({
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
  let mat = [
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
