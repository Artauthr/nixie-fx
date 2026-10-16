import { Application, Mesh, Rectangle, Texture } from "pixi.js";
import {
  createMaterialInstance,
  normalizeShaderGraph,
} from "../../src/runtime/schema/materials";
import {
  PixiVfxEffectInstance,
  normalizePixiVfxEffect,
} from "../../src/runtime/pixi/renderer";
import { createPixiVfx2dProjection } from "../../src/runtime/pixi/projection";

export async function sampleTrailMaterials() {
  const app = new Application();
  await app.init({
    width: 128,
    height: 64,
    backgroundAlpha: 0,
    autoStart: false,
    preference: "webgl",
  });
  const graph = normalizeShaderGraph({
    id: "trail-pixel",
    colorVersion: 1,
    blend: "normal",
    nodes: [{ id: "tint", type: "param", params: { name: "Tint" } }],
    params: [
      {
        name: "Tint",
        type: "color",
        default: [0.5, 0.25, 0, 1],
        scope: "per-material",
      },
    ],
    edges: [
      {
        id: "base",
        source: "tint",
        sourceHandle: "Out",
        target: "out",
        targetHandle: "baseColor",
      },
    ],
    outputs: { baseColor: "base" },
  });
  const effect = normalizePixiVfxEffect({
    emitters: [
      {
        id: "trail",
        maxParticles: 1,
        loop: false,
        modules: { trails: true, velocity: true, color: false },
        spawn: {
          shape: "point",
          rate: 0,
          bursts: [{ time: 0, count: 1, probability: 1 }],
        },
        initializeParticle: {
          lifetime: { mode: "constant", value: 10 },
          velocity: { mode: "vector", min: [2, 0, 0], max: [2, 0, 0] },
        },
        advanced: {
          trails: {
            material: createMaterialInstance(graph, "trail"),
            inheritColor: false,
            ratio: 1,
            width: { mode: "constant", value: 0.5 },
            length: { mode: "constant", value: 4 },
            lifetime: { mode: "constant", value: 5 },
            minVertexDistance: 0.001,
          },
        },
      },
    ],
  });
  const instance = new PixiVfxEffectInstance({
    effect,
    materialGraphProvider: () => graph,
    projection: createPixiVfx2dProjection({
      originX: 8,
      originY: 32,
      pixelsPerUnit: 40,
      yAxis: "down",
    }),
    fallbackTextures: {
      circle: Texture.WHITE,
      square: Texture.WHITE,
      triangleShard: Texture.WHITE,
      quadShard: Texture.WHITE,
      grassShard: Texture.WHITE,
    },
    seed: 7,
  });
  app.stage.addChild(instance.root);
  for (let i = 1; i <= 30; i++) instance.update(1 / 60, i / 60);
  // Isolate the ribbon's pixels so the particle head cannot make this pass.
  instance.root.children[1]!.visible = false;
  const mesh = instance.root.children[0] as Mesh;
  const result = app.renderer.extract.pixels({
    target: app.stage,
    frame: new Rectangle(0, 0, 128, 64),
  });
  let count = 0;
  let red = 0;
  let green = 0;
  for (let i = 0; i < result.pixels.length; i += 4) {
    const alpha = result.pixels[i + 3]! / 255;
    if (alpha < 0.1) continue;
    count++;
    red += result.pixels[i]! / alpha;
    green += result.pixels[i + 1]! / alpha;
  }
  const output = {
    count,
    red: red / count,
    green: green / count,
    indices: mesh.geometry.indexBuffer!.data.length,
  };
  instance.destroy();
  app.destroy(true);
  return output;
}
