/**
 * Offline Cline runtime installer.
 *
 * AgentEmployee no longer ships Cline inside the desktop installer. Users receive a
 * separate `cline.exe` (Bun-compiled Windows binary) and install it from the
 * Cline settings panel via "Offline install…". The supervisor copies the
 * chosen binary into `<agentemployeeBaseDir>/embedded-runtimes/cline/cline.exe`
 * and writes a `.installed` marker carrying version + sha256 + source.
 *
 * Detection then prefers that embedded binary over any `cline` on PATH so
 * enterprise fleets can pin a specific build.
 *
 * The installer is deliberately idempotent and best-effort:
 *   - Already installed at the same sha256 → no-op.
 *   - Different binary → copy next to the install, atomic rename.
 *   - Copy / version probe fails → stage dir is removed, previous install
 *     (if any) is preserved.
 *
 * No state lives outside `<installDir>`; deleting it is a full reset.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  closeSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { resolveAgentEmployeePaths } from "@/shared/agentemployeePaths";

const INSTALL_DIR_NAME = "cline";
const INSTALLED_MARKER = ".installed";
const BINARY_NAME = process.platform === "win32" ? "cline.exe" : "cline";
/** Real `cline.exe` is ~144 MB; reject obvious stubs / wrong files. */
const MIN_OFFLINE_PACKAGE_BYTES = 1 * 1024 * 1024;
const VERSION_PROBE_TIMEOUT_MS = 15_000;

interface InstalledMarker {
  package: string;
  version: string;
  sha256: string;
  installedAt: string;
  /** Present on offline installs; older markers omit it. */
  source?: string;
}

export interface InstallClineOfflineResult {
  ok: boolean;
  reason?: string;
  installDir?: string;
  version?: string;
}

export type ProbeClineVersion = (binaryPath: string) => Promise<string>;

function readInstalledMarker(installDir: string): InstalledMarker | undefined {
  const path = join(installDir, INSTALLED_MARKER);
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (typeof raw.package !== "string" || typeof raw.version !== "string") return undefined;
    if (typeof raw.sha256 !== "string") return undefined;
    return {
      package: raw.package,
      version: raw.version,
      sha256: raw.sha256,
      installedAt: typeof raw.installedAt === "string" ? raw.installedAt : new Date().toISOString(),
      ...(typeof raw.source === "string" ? { source: raw.source } : {}),
    };
  } catch {
    return undefined;
  }
}

function isRejectedSourcePath(sourcePath: string): boolean {
  const normalized = resolve(sourcePath).toLowerCase().replace(/\//g, "\\");
  return (
    normalized.includes("\\windows\\system32\\") ||
    normalized.includes("\\windows\\syswow64\\") ||
    normalized.includes("\\windows\\system\\")
  );
}

function hasPeMzHeader(filePath: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(filePath, "r");
    const buf = Buffer.alloc(2);
    const bytesRead = readSync(fd, buf, 0, 2, 0);
    return bytesRead === 2 && buf[0] === 0x4d && buf[1] === 0x5a;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Validate a user-picked offline package before copying it into the
 * AgentEmployee data directory. Returns a stable reason code on failure.
 */
export function validateClineOfflinePackage(
  sourcePath: string,
  options?: { minBytes?: number },
): string | undefined {
  if (typeof sourcePath !== "string" || sourcePath.trim().length === 0) {
    return "cline-source-missing";
  }
  const absolute = resolve(sourcePath);
  if (!existsSync(absolute)) {
    return "cline-source-missing";
  }
  let stat;
  try {
    stat = statSync(absolute);
  } catch {
    return "cline-source-unreadable";
  }
  if (!stat.isFile()) {
    return "cline-source-not-file";
  }
  if (isRejectedSourcePath(absolute)) {
    return "cline-source-path-rejected";
  }
  const minBytes = options?.minBytes ?? MIN_OFFLINE_PACKAGE_BYTES;
  if (stat.size < minBytes) {
    return "cline-source-too-small";
  }
  if (process.platform === "win32" && !hasPeMzHeader(absolute)) {
    return "cline-source-not-pe";
  }
  return undefined;
}

/**
 * Run `cline.exe --version` and return the first semver-ish token from stdout.
 */
export async function probeClineBinaryVersion(
  binaryPath: string,
  timeoutMs = VERSION_PROBE_TIMEOUT_MS,
): Promise<string> {
  return await new Promise<string>((resolvePromise, reject) => {
    const child = spawn(binaryPath, ["--version"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`cline-version-probe-timeout:${timeoutMs}`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const text = `${stdout}\n${stderr}`;
      const match = text.match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/);
      if (match?.[1]) {
        resolvePromise(match[1]);
        return;
      }
      reject(
        new Error(
          `cline-version-probe-failed:exit=${code ?? "null"}:output=${text.trim().slice(0, 200)}`,
        ),
      );
    });
  });
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/**
 * Install (or refresh) Cline from a local offline package path.
 *
 * Safe to call repeatedly: the marker sha256 is the source of truth, so a
 * second invocation with the same binary is a no-op. Different binary →
 * atomic swap. Failure during copy/probe → stage dir is removed, previous
 * install (if any) is preserved.
 */
export async function installClineFromOfflinePackage(
  sourcePath: string,
  baseDir?: string,
  options?: {
    minBytes?: number;
    probeVersion?: ProbeClineVersion;
  },
): Promise<InstallClineOfflineResult> {
  const validationReason = validateClineOfflinePackage(sourcePath, {
    ...(options?.minBytes !== undefined ? { minBytes: options.minBytes } : {}),
  });
  if (validationReason) {
    return { ok: false, reason: validationReason };
  }

  const absoluteSource = resolve(sourcePath);
  const sha256 = sha256File(absoluteSource);
  const paths = resolveAgentEmployeePaths(baseDir);
  const installDir = join(paths.baseDir, "embedded-runtimes", INSTALL_DIR_NAME);
  const binaryPath = join(installDir, BINARY_NAME);
  const marker = readInstalledMarker(installDir);
  if (marker && marker.sha256 === sha256 && existsSync(binaryPath)) {
    return { ok: true, installDir, version: marker.version };
  }

  const stageDir = `${installDir}.stage-${process.pid}`;
  if (existsSync(stageDir)) {
    rmSync(stageDir, { recursive: true, force: true });
  }
  mkdirSync(stageDir, { recursive: true });
  const stagedBinary = join(stageDir, BINARY_NAME);

  try {
    copyFileSync(absoluteSource, stagedBinary);
    const probe = options?.probeVersion ?? probeClineBinaryVersion;
    const version = await probe(stagedBinary);
    const newMarker: InstalledMarker = {
      package: "cline",
      version,
      sha256,
      installedAt: new Date().toISOString(),
      source: "offline-package",
    };
    writeFileSync(join(stageDir, INSTALLED_MARKER), `${JSON.stringify(newMarker, null, 2)}\n`);
    if (existsSync(installDir)) {
      rmSync(installDir, { recursive: true, force: true });
    }
    renameSync(stageDir, installDir);
    return { ok: true, installDir, version };
  } catch (error) {
    rmSync(stageDir, { recursive: true, force: true });
    return {
      ok: false,
      reason: `cline-offline-install-failed:${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Resolve the absolute path to the embedded `cline` binary if it has been
 * installed via offline package. Returns `undefined` when the installer
 * hasn't run yet, hasn't completed, or was wiped.
 */
export function resolveEmbeddedClineBinaryPath(baseDir?: string): string | undefined {
  const paths = resolveAgentEmployeePaths(baseDir);
  const installDir = join(paths.baseDir, "embedded-runtimes", INSTALL_DIR_NAME);
  const marker = readInstalledMarker(installDir);
  if (!marker) return undefined;
  const candidate = join(installDir, BINARY_NAME);
  return existsSync(candidate) ? candidate : undefined;
}
