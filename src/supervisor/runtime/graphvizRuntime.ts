import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Bundled Graphviz runtime.
 *
 * The Python `graphviz` package is a thin wrapper that shells out to the `dot`
 * executable, so AgentEmployee also ships the Graphviz binaries (Windows x64) —
 * offline, no user install — mirroring the bundled CPython/Node pattern.
 *
 * Layout: `resources/graphviz/<platform>-<arch>/` with the usual Graphviz tree
 * (`bin/dot.exe`, `lib/`, `share/graphviz/…`). The main process passes its root
 * down via {@link BUNDLED_GRAPHVIZ_DIR_ENV}.
 */
export const BUNDLED_GRAPHVIZ_DIR_ENV = "AGENTEMPLOYEE_BUNDLED_GRAPHVIZ_DIR";

export interface GraphvizRuntime {
  /** Root of the Graphviz distribution (holds `bin/`, `lib/`, `share/`). */
  root: string;
  /** Directory containing `dot.exe` — prepended to PATH. */
  binDir: string;
}

export function graphvizTargetDirName(): string {
  return `${process.platform}-${process.arch}`;
}

/** Resolve the bundled Graphviz, or `undefined` when not shipped/present. */
export function resolveBundledGraphviz(): GraphvizRuntime | undefined {
  const root = process.env[BUNDLED_GRAPHVIZ_DIR_ENV];
  if (!root || process.platform !== "win32") return undefined;
  const dir = join(root, graphvizTargetDirName());
  const binDir = join(dir, "bin");
  return existsSync(join(binDir, "dot.exe")) ? { root: dir, binDir } : undefined;
}

/**
 * Point Graphviz at its own config/plugin tree. Without `GVBINDIR` a relocated
 * install cannot find `config6`/`gvplugin_*`, and `dot` fails to render.
 */
export function graphvizRuntimeEnv(runtime: GraphvizRuntime): Record<string, string> {
  return { GVBINDIR: runtime.root };
}

/** Prepend Graphviz's `bin` to PATH so a bare `dot` resolves to the bundle. */
export function prependBundledGraphvizToPath(
  env: Record<string, string>,
  pathKey: "Path" | "PATH",
  currentPath: string | undefined,
  runtime: GraphvizRuntime | undefined = resolveBundledGraphviz(),
): Record<string, string> {
  if (!runtime) return env;
  const existing = env[pathKey] ?? currentPath ?? "";
  const segments = existing.split(";").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment.toLowerCase() === runtime.binDir.toLowerCase())) {
    return env;
  }
  return { ...env, [pathKey]: [runtime.binDir, ...segments].join(";") };
}
