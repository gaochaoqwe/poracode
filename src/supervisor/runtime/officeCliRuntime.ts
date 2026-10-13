import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Bundled OfficeCLI runtime.
 *
 * OfficeCLI is a single self-contained binary that reads and writes `.docx`,
 * `.xlsx`, and `.pptx` without a Microsoft Office install. AgentEmployee ships it
 * (Windows x64) so agents can build and inspect Office documents offline,
 * mirroring the bundled CPython/Graphviz pattern.
 *
 * Layout: `resources/officecli/<platform>-<arch>/officecli.exe`. The main
 * process passes its root down via {@link BUNDLED_OFFICECLI_DIR_ENV}.
 *
 * Only the Windows host is shipped for now; WSL projects cannot run a Windows
 * `.exe` through this runtime (interop is not guaranteed) and macOS/Linux
 * artifacts are later work.
 */
export const BUNDLED_OFFICECLI_DIR_ENV = "AGENTEMPLOYEE_BUNDLED_OFFICECLI_DIR";

export interface OfficeCliRuntime {
  /** Absolute path to the OfficeCLI executable. */
  exePath: string;
  /** Directory to prepend to PATH so a bare `officecli` resolves to this binary. */
  binDir: string;
}

/** `<platform>-<arch>` subdirectory name, e.g. `win32-x64`. */
export function officeCliTargetDirName(): string {
  return `${process.platform}-${process.arch}`;
}

/** Executable base name for a platform — no extension on POSIX. */
function officeCliExecutableName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "officecli.exe" : "officecli";
}

/**
 * Resolve the bundled OfficeCLI, or `undefined` when it is not shipped for this
 * platform / not present on disk (callers then leave `officecli` alone).
 */
export function resolveBundledOfficeCli(): OfficeCliRuntime | undefined {
  const root = process.env[BUNDLED_OFFICECLI_DIR_ENV];
  if (!root || process.platform !== "win32") return undefined;
  const dir = join(root, officeCliTargetDirName());
  const exePath = join(dir, officeCliExecutableName(process.platform));
  return existsSync(exePath) ? { exePath, binDir: dir } : undefined;
}

/**
 * Extra env for the bundled binary.
 *
 * `OFFICECLI_SKIP_UPDATE=1` is deliberate: the CLI checks for updates in the
 * background by default (`~/.officecli/config.json`). A shipped binary that
 * self-updates drifts away from the version the installer pinned, which makes
 * both the packaged artifact and bug reports non-reproducible. Users who want a
 * newer OfficeCLI install it themselves and the PATH entry wins.
 */
export function officeCliRuntimeEnv(
  runtime: OfficeCliRuntime | undefined = resolveBundledOfficeCli(),
): Record<string, string> {
  if (!runtime) return {};
  return {
    OFFICECLI_SKIP_UPDATE: "1",
  };
}

/**
 * Prepend the bundled binary's directory to a PATH value so a bare `officecli`
 * resolves to AgentEmployee's copy. Returns the env unchanged when no runtime is
 * bundled or it is already present.
 */
export function prependBundledOfficeCliToPath(
  env: Record<string, string>,
  pathKey: "Path" | "PATH",
  currentPath: string | undefined,
  runtime: OfficeCliRuntime | undefined = resolveBundledOfficeCli(),
): Record<string, string> {
  if (!runtime) return env;
  const existing = env[pathKey] ?? currentPath ?? "";
  const segments = existing.split(";").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment.toLowerCase() === runtime.binDir.toLowerCase())) {
    return env;
  }
  return { ...env, [pathKey]: [runtime.binDir, ...segments].join(";") };
}
