import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebglAddon, isWebglRendererAvailable, resetWebglSupportCache } from "./webglSupport";

/** Loosely-typed spy: `getContext` is heavily overloaded, so cast through unknown. */
function getContextSpy() {
  return vi.spyOn(HTMLCanvasElement.prototype, "getContext") as unknown as {
    mockImplementation(fn: (...args: unknown[]) => unknown): void;
    mockReturnValue(value: unknown): void;
    readonly mock: { calls: unknown[][] };
  };
}

function fakeGl() {
  const loseContext = vi.fn<() => void>();
  const gl = {
    isContextLost: () => false,
    getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext } : null),
  };
  return { gl, loseContext };
}

describe("isWebglRendererAvailable", () => {
  afterEach(() => {
    resetWebglSupportCache();
    vi.restoreAllMocks();
  });

  it("returns false when context creation throws", () => {
    getContextSpy().mockImplementation(() => {
      throw new Error("WebGL is not available");
    });
    expect(isWebglRendererAvailable()).toBe(false);
  });

  it("returns false when every context type is null", () => {
    getContextSpy().mockReturnValue(null);
    expect(isWebglRendererAvailable()).toBe(false);
  });

  it("returns true and releases the throwaway context when WebGL works", () => {
    const { gl, loseContext } = fakeGl();
    getContextSpy().mockReturnValue(gl);
    expect(isWebglRendererAvailable()).toBe(true);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("caches the probe result", () => {
    const spy = getContextSpy();
    spy.mockReturnValue(null);
    isWebglRendererAvailable();
    const afterFirstProbe = spy.mock.calls.length;
    expect(afterFirstProbe).toBeGreaterThan(0);
    isWebglRendererAvailable();
    // A cached probe must not touch the canvas again.
    expect(spy.mock.calls).toHaveLength(afterFirstProbe);
  });
});

describe("createWebglAddon", () => {
  afterEach(() => {
    resetWebglSupportCache();
    vi.restoreAllMocks();
  });

  it("returns null instead of building the addon when WebGL is unavailable", () => {
    getContextSpy().mockReturnValue(null);
    expect(createWebglAddon()).toBeNull();
  });
});
