import { PerspectiveCamera, Scene, Vector2 } from "three";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { createDefaultSceneBloom } from "../../schema/scene";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  init: () => Promise.resolve(),
  native: true,
  stopped: vi.fn(),
  disposed: vi.fn(),
  lost: vi.fn(),
  updated: vi.fn(),
}));
vi.mock("three/webgpu", async (original) => ({
  ...(await original<object>()),
  WebGPURenderer: class {
    backend = {
      ...(state.native
        ? { isWebGPUBackend: true }
        : { gl: { getExtension: () => ({ loseContext: state.lost }) } }),
    };
    _animation = { stop: state.stopped };
    _nodes = { nodeFrame: { update: state.updated, frameId: 1 } };
    info = { autoReset: true, reset: vi.fn(), frame: 0 };
    toneMapping = 0;
    onDeviceLost?: unknown;
    init = () => state.init();
    dispose = state.disposed;
  },
}));
import {
  ThreeNodeRenderPipeline,
  beginThreeWebGpuFrame,
  createThreeWebGpuRenderer,
  disposeThreeWebGpuRenderer,
} from "./pipeline";
beforeEach(() => {
  vi.clearAllMocks();
  state.native = true;
  state.init = () => Promise.resolve();
});
describe("host-owned renderer lifecycle", () => {
  it("stops Three's private heartbeat and advances only on an explicit frame", async () => {
    const { renderer, backend } = await createThreeWebGpuRenderer();
    expect(backend).toBe("webgpu");
    expect(state.stopped).toHaveBeenCalledOnce();
    expect(state.updated).not.toHaveBeenCalled();
    beginThreeWebGpuFrame(renderer);
    expect(state.updated).toHaveBeenCalledOnce();
    disposeThreeWebGpuRenderer(renderer);
    expect(state.disposed).toHaveBeenCalledOnce();
  });
  it("labels and releases the separate WebGL2 fallback context", async () => {
    state.native = false;
    const { renderer, backend } = await createThreeWebGpuRenderer({
      forceWebGL: true,
    });
    expect(backend).toBe("webgl2-fallback");
    disposeThreeWebGpuRenderer(renderer);
    expect(state.lost).toHaveBeenCalledOnce();
  });
  it("disposes late initialization after cancellation", async () => {
    let finish!: () => void;
    state.init = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    const controller = new AbortController();
    const pending = createThreeWebGpuRenderer({ signal: controller.signal });
    controller.abort();
    finish();
    await expect(pending).rejects.toThrow();
    expect(state.disposed).toHaveBeenCalledOnce();
    expect(state.stopped).toHaveBeenCalledOnce();
  });
  it("releases initialization failures", async () => {
    state.init = () => Promise.reject(new Error("Adapter unavailable"));
    await expect(createThreeWebGpuRenderer()).rejects.toThrow(
      "Adapter unavailable",
    );
    expect(state.disposed).toHaveBeenCalledOnce();
  });
});

describe("legacy bloom compatibility", () => {
  it("preserves UnrealBloomPass's composite intensity without converting the glow", async () => {
    const legacy = new UnrealBloomPass(new Vector2(32, 32), 1, 0, 1);
    expect(legacy.compositeMaterial.fragmentShader).toContain(
      "3.0 * bloomStrength",
    );
    const { renderer } = await createThreeWebGpuRenderer();
    const pipeline = new ThreeNodeRenderPipeline(
      renderer,
      new Scene(),
      new PerspectiveCamera(),
    );
    const internals = pipeline as unknown as {
      bloomPass: {
        strength: { value: number };
        threshold: { value: number };
        radius: { value: number };
      };
      pipeline: { outputColorTransform: boolean };
    };
    pipeline.setBloom({
      ...createDefaultSceneBloom(),
      enabled: true,
      intensity: 4,
      threshold: 1.2,
      scatter: 0.7,
    });
    expect(internals.bloomPass.strength.value).toBe(3);
    expect(internals.bloomPass.threshold.value).toBe(1.2);
    expect(internals.bloomPass.radius.value).toBe(0.7);
    expect(internals.pipeline.outputColorTransform).toBe(false);
    pipeline.setBloom({ ...createDefaultSceneBloom(), intensity: 2 });
    expect(internals.bloomPass.strength.value).toBe(1.5);
    pipeline.dispose();
    legacy.dispose();
    disposeThreeWebGpuRenderer(renderer);
  });
});
