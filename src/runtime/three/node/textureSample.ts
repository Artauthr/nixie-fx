import { LinearFilter, NearestFilter, type Texture } from "three";
import type { Node } from "three/webgpu";
import { texture } from "three/tsl";

/** Match WebGL's non-mip minification filters, including across fract UV seams. */
export function sampleNodeTexture(source: Texture, uv: Node<"vec2">) {
  // r184 WebGPURenderer generates mip levels whenever generateMipmaps is set,
  // even with LinearFilter/NearestFilter, and does not clamp its sampler LOD.
  // Implicit derivatives at a wrapped UV seam then sample an unrelated coarse
  // mip: alpha masks develop bright rectangular borders and atlases bleed.
  const nonMip =
    source.minFilter === LinearFilter || source.minFilter === NearestFilter;
  return texture(source, uv, nonMip ? 0 : null);
}
