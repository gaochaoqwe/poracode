import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUNDLED_PYTHON_DIR_ENV,
  prependBundledPythonToPath,
  pythonTargetDirName,
  resolveBundledPythonRuntime,
  type PythonRuntime,
} from "./pythonRuntime";

const runtime: PythonRuntime = { pythonPath: "C:\\py\\python.exe", binDir: "C:\\py" };

describe("prependBundledPythonToPath", () => {
  it("prepends the runtime dir to PATH", () => {
    const env = prependBundledPythonToPath({ PATH: "C:\\Windows" }, "PATH", undefined, runtime);
    expect(env.PATH).toBe("C:\\py;C:\\Windows");
  });

  it("is idempotent when the runtime is already on PATH", () => {
    const env = prependBundledPythonToPath(
      { PATH: "C:\\py;C:\\Windows" },
      "PATH",
      undefined,
      runtime,
    );
    expect(env.PATH).toBe("C:\\py;C:\\Windows");
  });

  it("returns the env unchanged when no runtime is bundled", () => {
    expect(
      prependBundledPythonToPath({ PATH: "C:\\Windows" }, "PATH", undefined, undefined),
    ).toEqual({
      PATH: "C:\\Windows",
    });
  });
});

describe("resolveBundledPythonRuntime", () => {
  const original = process.env[BUNDLED_PYTHON_DIR_ENV];
  afterEach(() => {
    if (original === undefined) delete process.env[BUNDLED_PYTHON_DIR_ENV];
    else process.env[BUNDLED_PYTHON_DIR_ENV] = original;
  });

  it("returns undefined without the env var", () => {
    delete process.env[BUNDLED_PYTHON_DIR_ENV];
    expect(resolveBundledPythonRuntime()).toBeUndefined();
  });

  it.runIf(process.platform === "win32")("resolves the interpreter when present", () => {
    const root = mkdtempSync(join(tmpdir(), "py-runtime-"));
    try {
      process.env[BUNDLED_PYTHON_DIR_ENV] = root;
      const dir = join(root, pythonTargetDirName());
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "python.exe"), "");
      expect(resolveBundledPythonRuntime()?.binDir).toBe(dir);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
