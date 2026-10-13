import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUNDLED_GRAPHVIZ_DIR_ENV,
  graphvizRuntimeEnv,
  graphvizTargetDirName,
  prependBundledGraphvizToPath,
  resolveBundledGraphviz,
  type GraphvizRuntime,
} from "./graphvizRuntime";

const runtime: GraphvizRuntime = { root: "C:\\gv", binDir: "C:\\gv\\bin" };

describe("prependBundledGraphvizToPath", () => {
  it("prepends the bin dir and is idempotent", () => {
    expect(
      prependBundledGraphvizToPath({ PATH: "C:\\Windows" }, "PATH", undefined, runtime),
    ).toEqual({ PATH: "C:\\gv\\bin;C:\\Windows" });
    expect(
      prependBundledGraphvizToPath({ PATH: "C:\\gv\\bin;C:\\Windows" }, "PATH", undefined, runtime),
    ).toEqual({ PATH: "C:\\gv\\bin;C:\\Windows" });
  });

  it("returns the env unchanged without a runtime", () => {
    expect(
      prependBundledGraphvizToPath({ PATH: "C:\\Windows" }, "PATH", undefined, undefined),
    ).toEqual({ PATH: "C:\\Windows" });
  });
});

describe("resolveBundledGraphviz", () => {
  const original = process.env[BUNDLED_GRAPHVIZ_DIR_ENV];
  afterEach(() => {
    if (original === undefined) delete process.env[BUNDLED_GRAPHVIZ_DIR_ENV];
    else process.env[BUNDLED_GRAPHVIZ_DIR_ENV] = original;
  });

  it("returns undefined without the env var", () => {
    delete process.env[BUNDLED_GRAPHVIZ_DIR_ENV];
    expect(resolveBundledGraphviz()).toBeUndefined();
  });

  it.runIf(process.platform === "win32")("resolves dot.exe and sets GVBINDIR", () => {
    const root = mkdtempSync(join(tmpdir(), "gv-runtime-"));
    try {
      process.env[BUNDLED_GRAPHVIZ_DIR_ENV] = root;
      const dir = join(root, graphvizTargetDirName());
      mkdirSync(join(dir, "bin"), { recursive: true });
      writeFileSync(join(dir, "bin", "dot.exe"), "");
      const resolved = resolveBundledGraphviz();
      expect(resolved?.binDir).toBe(join(dir, "bin"));
      expect(graphvizRuntimeEnv(resolved!)).toEqual({ GVBINDIR: dir });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
