import {
  Buffer,
  BufferUsage,
  Mesh,
  MeshGeometry,
  Texture,
  type Shader,
} from "pixi.js";
import type { ParticleEmitterDefinition } from "../../engine/particles";
import {
  sampleParticleScalarValue,
  sampleParticleGradientColor,
  sampleParticleGradientAlpha,
} from "../../engine/particles";
import { sampleIndependentTrailColor } from "../trailColor";
import type { Vec4 } from "../../engine/math";

export interface TrailPoint {
  x: number;
  y: number;
  timeSeconds: number;
  lifetimeSeconds: number;
  distanceFromHead: number;
  pixelSize: number;
  tint: number;
  alpha: number;
  widthPx: number;
  maxLengthPx?: number;
  seed: number;
  pixelsPerWorldUnit: number;
}

/** One draw for every ribbon in an emitter, with retained high-water buffers. */
export class PixiTrailMesh {
  readonly mesh: Mesh<MeshGeometry, Shader>;
  private capacity = 0;
  private positions = new Float32Array(0);
  private uvs = new Float32Array(0);
  private colors = new Float32Array(0);
  private fades = new Float32Array(0);
  private indices = new Uint32Array(0);
  private readonly colorBuffer = new Buffer({
    data: this.colors,
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
  });
  private readonly fadeBuffer = new Buffer({
    data: this.fades,
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
  });
  private readonly color: Vec4 = [1, 1, 1, 1];

  constructor(shader: Shader, blend: string) {
    const geometry = new MeshGeometry({
      positions: this.positions,
      uvs: this.uvs,
      indices: this.indices,
      shrinkBuffersToFit: false,
    });
    geometry.batchMode = "no-batch";
    geometry.addAttribute("aColor", {
      buffer: this.colorBuffer,
      format: "float32x4",
    });
    geometry.addAttribute("aTrailFade", {
      buffer: this.fadeBuffer,
      format: "float32",
    });
    // Graph output is premultiplied. A neutral PMA texture prevents Pixi's
    // source-dependent blend adjustment from applying a second alpha multiply.
    this.mesh = new Mesh({ geometry, shader, texture: Texture.WHITE });
    this.mesh.blendMode =
      blend === "opaque" ? "none" : blend === "additive" ? "add" : "normal";
    this.mesh.visible = false;
  }

  draw(
    histories: ReadonlyMap<string, { points: TrailPoint[] }>,
    emitter: ParticleEmitterDefinition,
    time: number,
  ): number {
    let required = 0;
    for (const { points } of histories.values())
      if (points.length >= 2) required += points.length * 2;
    if (required > this.capacity) {
      this.capacity = Math.max(required, this.capacity * 2, 64);
      this.positions = new Float32Array(this.capacity * 2);
      this.uvs = new Float32Array(this.capacity * 2);
      this.colors = new Float32Array(this.capacity * 4);
      this.fades = new Float32Array(this.capacity);
      this.indices = new Uint32Array(this.capacity * 3);
      this.mesh.geometry.positions = this.positions;
      this.mesh.geometry.uvs = this.uvs;
      this.colorBuffer.data = this.colors;
      this.fadeBuffer.data = this.fades;
    }
    const settings = emitter.advanced.trails;
    let vertices = 0;
    let indices = 0;
    for (const { points } of histories.values()) {
      if (points.length < 2) continue;
      const start = vertices;
      const length = Math.max(points[0]!.distanceFromHead, 0.000001);
      for (let i = 0; i < points.length; i++) {
        const point = points[i]!;
        const prev = points[Math.max(0, i - 1)]!;
        const next = points[Math.min(points.length - 1, i + 1)]!;
        const t = Math.min(
          1,
          point.distanceFromHead / (point.maxLengthPx ?? length),
        );
        const age = Math.min(
          1,
          Math.max(0, (time - point.timeSeconds) / point.lifetimeSeconds),
        );
        const width =
          point.widthPx *
          Math.max(
            0,
            sampleParticleScalarValue(settings.widthOverTrail, t, point.seed),
          );
        let dx = next.x - prev.x;
        let dy = next.y - prev.y;
        const magnitude = Math.hypot(dx, dy);
        if (magnitude < 0.000001) {
          dx = 0;
          dy = 1;
        } else {
          dx /= magnitude;
          dy /= magnitude;
        }
        const sx = -dy * width * 0.5;
        const sy = dx * width * 0.5;
        const color = this.color;
        color[0] = ((point.tint >>> 16) & 255) / 255;
        color[1] = ((point.tint >>> 8) & 255) / 255;
        color[2] = (point.tint & 255) / 255;
        color[3] = point.alpha;
        if (!settings.inheritColor)
          sampleIndependentTrailColor(settings, age, t, color);
        else if (settings.color) {
          sampleParticleGradientColor(settings.color, t, color);
          color[3] = sampleParticleGradientAlpha(settings.color, t);
        }
        const u =
          settings.textureMode === "tile"
            ? point.distanceFromHead /
              Math.max(0.000001, point.pixelsPerWorldUnit)
            : point.distanceFromHead / length;
        for (let edge = 0; edge < 2; edge++) {
          const v = vertices + edge;
          const side = edge === 0 ? -1 : 1;
          this.positions[v * 2] = point.x + side * sx;
          this.positions[v * 2 + 1] = point.y + side * sy;
          this.uvs[v * 2] = u;
          this.uvs[v * 2 + 1] = edge;
          this.colors.set(color, v * 4);
          this.fades[v] = (1 - t) * (1 - age);
        }
        vertices += 2;
      }
      for (let a = start; a < vertices - 2; a += 2) {
        this.indices[indices++] = a;
        this.indices[indices++] = a + 1;
        this.indices[indices++] = a + 2;
        this.indices[indices++] = a + 1;
        this.indices[indices++] = a + 3;
        this.indices[indices++] = a + 2;
      }
    }
    this.mesh.visible = indices > 0;
    if (indices) {
      this.mesh.geometry.getBuffer("aPosition").update();
      this.mesh.geometry.getBuffer("aUV").update();
      this.colorBuffer.update();
      this.fadeBuffer.update();
      // Only the live index range is drawn; backing storage is retained.
      this.mesh.geometry.indices = this.indices.subarray(0, indices);
    }
    return indices / 6;
  }

  destroy(): void {
    this.mesh.shader?.destroy();
    this.mesh.geometry.destroy(true);
    this.mesh.destroy();
  }
}
