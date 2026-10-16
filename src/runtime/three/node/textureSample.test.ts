import { describe, expect, it } from "vitest";
import {
  Texture,
  LinearFilter,
  NearestFilter,
  LinearMipmapLinearFilter,
  NearestMipmapNearestFilter,
} from "three";
import { vec2 } from "three/tsl";
import { sampleNodeTexture } from "./textureSample";

describe("node texture minification matches WebGL", () => {
  for (const minFilter of [LinearFilter, NearestFilter]) {
    it(`uses level zero for non-mip filter ${minFilter}, even with generated mips`, () => {
      const source = new Texture();
      source.minFilter = minFilter;
      source.generateMipmaps = true;
      const sample = sampleNodeTexture(source, vec2(0.999, 0.5));
      expect(sample.levelNode).toMatchObject({ value: 0 });
      expect(source.generateMipmaps).toBe(true);
      source.dispose();
    });
  }
  for (const minFilter of [
    LinearMipmapLinearFilter,
    NearestMipmapNearestFilter,
  ]) {
    it(`retains automatic LOD for authored mip filter ${minFilter}`, () => {
      const source = new Texture();
      source.minFilter = minFilter;
      expect(sampleNodeTexture(source, vec2(0.5)).levelNode).toBeNull();
      source.dispose();
    });
  }
});
