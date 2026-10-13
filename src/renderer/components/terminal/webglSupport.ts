import { WebglAddon } from "@xterm/addon-webgl";

/**
 * Whether xterm's GPU (WebGL) renderer can actually initialize here.
 *
 * `WebglAddon` builds its GL state lazily from an async canvas event. When
 * context creation fails there — no GPU, a broken/absent driver, or a shimmed
 * host such as Windows 7 behind a Win10-API compatibility layer — it throws
 * from inside that callback, i.e. *outside* the `try/catch` around
 * `loadAddon`, and the uncaught error takes the whole renderer down.
 *
 * Probing with a throwaway canvas keeps us on the DOM renderer instead of
 * crashing. The result is cached: GPU support does not appear mid-session, and
 * a context lost later is still handled by `WebglAddon.onContextLoss`.
 */
let webglAvailable: boolean | null = null;

export function isWebglRendererAvailable(): boolean {
  if (webglAvailable === null) webglAvailable = probeWebgl();
  return webglAvailable;
}

/** Test seam: clears the cached probe result. */
export function resetWebglSupportCache(): void {
  webglAvailable = null;
}

function probeWebgl(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      (canvas.getContext("experimental-webgl" as "webgl") as WebGLRenderingContext | null);
    if (!gl || gl.isContextLost()) return false;
    // Release the throwaway context so it does not hold a GPU slot for the
    // lifetime of the renderer.
    const lose = gl.getExtension("WEBGL_lose_context") as { loseContext?: () => void } | null;
    lose?.loseContext?.();
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a WebGL addon only when the probe says it can work, wiring the standard
 * context-loss fallback. Returns `null` when WebGL is unavailable or the addon
 * fails synchronously, so callers fall back to the DOM renderer.
 */
export function createWebglAddon(): WebglAddon | null {
  if (!isWebglRendererAvailable()) return null;
  try {
    return new WebglAddon();
  } catch {
    return null;
  }
}
