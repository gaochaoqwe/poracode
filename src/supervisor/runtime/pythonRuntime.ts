import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Bundled CPython runtime.
 *
 * AgentEmployee ships a CPython interpreter (with `python-docx`, `lxml`, `Pillow`,
 * `matplotlib`, … pre-installed) so agents can run Python — document image
 * insertion, plotting — without the user installing anything and without a
 * network, mirroring the pinned-Node pattern (`./pinnedNode.ts`).
 *
 * Layout: `resources/python/<platform>-<arch>/` holds an extracted
 * `python-build-standalone` distribution (Windows `python.exe` at its root).
 * Packaged builds expose `resources/python` as the `python` resources dir; the
 * main process passes its absolute path down via {@link BUNDLED_PYTHON_DIR_ENV}.
 *
 * Only the Windows host is shipped for now; WSL/Linux and macOS are later work.
 */
export const BUNDLED_PYTHON_DIR_ENV = "AGENTEMPLOYEE_BUNDLED_PYTHON_DIR";

export interface PythonRuntime {
  /** Absolute path to the interpreter executable. */
  pythonPath: string;
  /** Directory to prepend to PATH so a bare `python` resolves to this runtime. */
  binDir: string;
}

/** `<platform>-<arch>` subdirectory name, e.g. `win32-x64`. */
export function pythonTargetDirName(): string {
  return `${process.platform}-${process.arch}`;
}

/**
 * Resolve the bundled interpreter, or `undefined` when it is not shipped for
 * this platform / not present on disk (callers then leave `python` alone).
 */
export function resolveBundledPythonRuntime(): PythonRuntime | undefined {
  const root = process.env[BUNDLED_PYTHON_DIR_ENV];
  if (!root || process.platform !== "win32") return undefined;
  const dir = join(root, pythonTargetDirName());
  const pythonPath = join(dir, "python.exe");
  return existsSync(pythonPath) ? { pythonPath, binDir: dir } : undefined;
}

/**
 * Extra env for running the bundled interpreter: keep bytecode out of the
 * (read-only) resources dir and force UTF-8 so Chinese output survives.
 */
export function pythonRuntimeEnv(runtime: PythonRuntime, cacheDir: string): Record<string, string> {
  void runtime;
  return {
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONPYCACHEPREFIX: join(cacheDir, "pyc"),
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };
}

/**
 * Prepend the bundled interpreter's directory to a PATH value so a bare
 * `python`/`python3` resolves to AgentEmployee's runtime. Returns the env unchanged
 * when no runtime is bundled or it is already present.
 */
export function prependBundledPythonToPath(
  env: Record<string, string>,
  pathKey: "Path" | "PATH",
  currentPath: string | undefined,
  runtime: PythonRuntime | undefined = resolveBundledPythonRuntime(),
): Record<string, string> {
  if (!runtime) return env;
  const existing = env[pathKey] ?? currentPath ?? "";
  const segments = existing.split(";").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment.toLowerCase() === runtime.binDir.toLowerCase())) {
    return env;
  }
  return { ...env, [pathKey]: [runtime.binDir, ...segments].join(";") };
}
