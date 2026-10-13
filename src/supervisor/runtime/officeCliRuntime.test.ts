import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUNDLED_OFFICECLI_DIR_ENV,
  officeCliRuntimeEnv,
  officeCliTargetDirName,
  prependBundledOfficeCliToPath,
  resolveBundledOfficeCli,
  type OfficeCliRuntime,
} from "./officeCliRuntime";

const runtime: OfficeCliRuntime = {
  exePath: "C:\\oc\\officecli.exe",
  binDir: "C:\\oc",
};

describe("prependBundledOfficeCliToPath", () => {
  it("prepends the bin dir and is idempotent", () => {
    expect(
      prependBundledOfficeCliToPath({ PATH: "C:\\Windows" }, "PATH", undefined, runtime),
    ).toEqual({ PATH: "C:\\oc;C:\\Windows" });
    expect(
      prependBundledOfficeCliToPath({ PATH: "C:\\oc;C:\\Windows" }, "PATH", undefined, runtime),
    ).toEqual({ PATH: "C:\\oc;C:\\Windows" });
  });

  it("matches the existing bin dir case-insensitively", () => {
    expect(
      prependBundledOfficeCliToPath({ PATH: "c:\\OC;C:\\Windows" }, "PATH", undefined, runtime),
    ).toEqual({ PATH: "c:\\OC;C:\\Windows" });
  });

  it("returns the env unchanged without a runtime", () => {
    expect(
      prependBundledOfficeCliToPath({ PATH: "C:\\Windows" }, "PATH", undefined, undefined),
    ).toEqual({ PATH: "C:\\Windows" });
  });
});

describe("resolveBundledOfficeCli", () => {
  const original = process.env[BUNDLED_OFFICECLI_DIR_ENV];
  afterEach(() => {
    if (original === undefined) delete process.env[BUNDLED_OFFICECLI_DIR_ENV];
    else process.env[BUNDLED_OFFICECLI_DIR_ENV] = original;
  });

  it("returns undefined without the env var", () => {
    delete process.env[BUNDLED_OFFICECLI_DIR_ENV];
    expect(resolveBundledOfficeCli()).toBeUndefined();
  });

  it.runIf(process.platform === "win32")("resolves officecli.exe and disables self-update", () => {
    const root = mkdtempSync(join(tmpdir(), "oc-runtime-"));
    try {
      process.env[BUNDLED_OFFICECLI_DIR_ENV] = root;
      const dir = join(root, officeCliTargetDirName());
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "officecli.exe"), "");
      const resolved = resolveBundledOfficeCli();
      expect(resolved?.binDir).toBe(dir);
      expect(resolved?.exePath).toBe(join(dir, "officecli.exe"));
      expect(officeCliRuntimeEnv(resolved!)).toEqual({ OFFICECLI_SKIP_UPDATE: "1" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "win32")("returns undefined when the binary is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "oc-runtime-missing-"));
    try {
      process.env[BUNDLED_OFFICECLI_DIR_ENV] = root;
      expect(resolveBundledOfficeCli()).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
