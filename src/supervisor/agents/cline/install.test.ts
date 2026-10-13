import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installClineFromOfflinePackage,
  resolveEmbeddedClineBinaryPath,
} from "./install";

const BINARY_NAME = process.platform === "win32" ? "cline.exe" : "cline";

function workspaceDir(bucket: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "cline-install-"));
  bucket.push(dir);
  return dir;
}

/** Fake offline package: MZ header + enough bytes to pass size checks. */
function writeFakePackage(dir: string, name = BINARY_NAME, bytes = 2048): string {
  const path = join(dir, name);
  const buf = Buffer.alloc(bytes, 0);
  buf[0] = 0x4d;
  buf[1] = 0x5a;
  writeFileSync(path, buf);
  return path;
}

describe("installClineFromOfflinePackage", () => {
  const workspaces: string[] = [];

  afterEach(() => {
    while (workspaces.length > 0) {
      const dir = workspaces.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("installs a valid offline package (happy path)", async () => {
    const workspace = workspaceDir(workspaces);
    const sourceDir = workspaceDir(workspaces);
    const sourcePath = writeFakePackage(sourceDir);

    const result = await installClineFromOfflinePackage(sourcePath, workspace, {
      minBytes: 64,
      probeVersion: async () => "3.0.65",
    });

    expect(result.ok).toBe(true);
    expect(result.version).toBe("3.0.65");
    expect(result.installDir).toBe(join(workspace, "embedded-runtimes", "cline"));
    expect(existsSync(join(result.installDir!, BINARY_NAME))).toBe(true);

    const marker = JSON.parse(
      readFileSync(join(result.installDir!, ".installed"), "utf8"),
    ) as Record<string, unknown>;
    expect(marker.package).toBe("cline");
    expect(marker.version).toBe("3.0.65");
    expect(marker.source).toBe("offline-package");
    expect(typeof marker.sha256).toBe("string");
  });

  it("returns a clear reason when the source path does not exist", async () => {
    const workspace = workspaceDir(workspaces);
    const result = await installClineFromOfflinePackage(
      join(workspace, "missing-cline.exe"),
      workspace,
      { minBytes: 64 },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("cline-source-missing");
  });

  it("returns a failure when the version probe rejects", async () => {
    const workspace = workspaceDir(workspaces);
    const sourceDir = workspaceDir(workspaces);
    const sourcePath = writeFakePackage(sourceDir);

    const result = await installClineFromOfflinePackage(sourcePath, workspace, {
      minBytes: 64,
      probeVersion: async () => {
        throw new Error("cline-version-probe-failed:exit=1");
      },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("cline-offline-install-failed");
    expect(existsSync(join(workspace, "embedded-runtimes", "cline"))).toBe(false);
  });

  it("skips reinstall when marker sha256 matches the source", async () => {
    const workspace = workspaceDir(workspaces);
    const sourceDir = workspaceDir(workspaces);
    const sourcePath = writeFakePackage(sourceDir);

    const first = await installClineFromOfflinePackage(sourcePath, workspace, {
      minBytes: 64,
      probeVersion: async () => "3.0.65",
    });
    expect(first.ok).toBe(true);

    let probeCalls = 0;
    const second = await installClineFromOfflinePackage(sourcePath, workspace, {
      minBytes: 64,
      probeVersion: async () => {
        probeCalls += 1;
        return "9.9.9";
      },
    });
    expect(second.ok).toBe(true);
    expect(second.version).toBe("3.0.65");
    expect(probeCalls).toBe(0);
  });

  it("runs the full install when the marker is missing", async () => {
    const workspace = workspaceDir(workspaces);
    const sourceDir = workspaceDir(workspaces);
    const sourcePath = writeFakePackage(sourceDir);

    // Pre-create install dir without a marker — should still install.
    const installDir = join(workspace, "embedded-runtimes", "cline");
    mkdirSync(installDir, { recursive: true });

    const result = await installClineFromOfflinePackage(sourcePath, workspace, {
      minBytes: 64,
      probeVersion: async () => "3.0.65",
    });
    expect(result.ok).toBe(true);
    expect(existsSync(join(installDir, ".installed"))).toBe(true);
    expect(existsSync(join(installDir, BINARY_NAME))).toBe(true);
  });
});

describe("resolveEmbeddedClineBinaryPath", () => {
  const workspaces: string[] = [];

  afterEach(() => {
    while (workspaces.length > 0) {
      const dir = workspaces.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined when the marker is missing", () => {
    const workspace = workspaceDir(workspaces);
    expect(resolveEmbeddedClineBinaryPath(workspace)).toBeUndefined();
  });

  it("returns the binary path when marker and binary exist", async () => {
    const workspace = workspaceDir(workspaces);
    const sourceDir = workspaceDir(workspaces);
    const sourcePath = writeFakePackage(sourceDir);

    await installClineFromOfflinePackage(sourcePath, workspace, {
      minBytes: 64,
      probeVersion: async () => "3.0.65",
    });

    const resolved = resolveEmbeddedClineBinaryPath(workspace);
    expect(resolved).toBe(join(workspace, "embedded-runtimes", "cline", BINARY_NAME));
  });
});
