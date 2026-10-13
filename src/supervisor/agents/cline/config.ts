/**
 * Persist Cline's BYO-endpoint config into the CLI's own credential store.
 *
 * WHY THIS EXISTS. Cline carries the provider's base URL and its custom model
 * ids in `<data>/settings/providers.json` + a sibling `models.json` — there is
 * no env var for either. `CLINE_PROVIDER_SETTINGS_PATH` lets us point Cline at
 * a AgentEmployee-owned copy instead of the user's `~/.cline`, so configuring the
 * panel never overwrites a real `cline auth` login.
 *
 * The file shape is load-bearing (verified against the 3.0.65 binary):
 * - `providers.json` is zod-validated; `version` must be the literal `1`,
 *   `updatedAt` must be an RFC3339 `…Z` instant, and `settings.baseUrl` must
 *   parse as a URL. Any of those wrong and Cline reads the file as EMPTY —
 *   silently dropping every provider, including ones written by `cline auth`.
 * - `models.json` is what makes a user-authored model id selectable. Without
 *   it `session/new` falls back to the provider's built-in default (`gpt-4o`
 *   for `openai-compatible`) no matter what `providers.json` names.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { resolveAgentEmployeePaths } from "@/shared/agentemployeePaths";
import { CLINE_AGENT_SETTING_KEYS, CLINE_OPENAI_COMPATIBLE_PROVIDER } from "./env";

/** Context window Cline stamps on a user-authored model entry it has no info for. */
const CUSTOM_MODEL_CONTEXT_WINDOW = 128_000;

function trimNonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** AgentEmployee-owned Cline config dir — never the user's `~/.cline`. */
export function clineConfigDir(baseDir?: string): string {
  return join(resolveAgentEmployeePaths(baseDir).baseDir, "cline");
}

export function clineProvidersPath(baseDir?: string): string {
  return join(clineConfigDir(baseDir), "providers.json");
}

export function clineModelsPath(baseDir?: string): string {
  return join(clineConfigDir(baseDir), "models.json");
}

/**
 * Cline's own MCP settings file — the default data-dir's `settings/`, NOT the
 * AgentEmployee-owned dir. Verified against the bundled `cline` 3.x CLI: `cline
 * config mcp` reports `<data-dir>/settings/cline_mcp_settings.json`, and an ACP
 * session loads servers ONLY from there (it ignores both the `mcpServers` the
 * host passes over ACP and any file under `CLINE_PROVIDER_SETTINGS_PATH`, which
 * redirects `providers.json` alone). Default data-dir is `~/.cline/data`;
 * AgentEmployee passes neither `--config` nor `--data-dir`, so the default applies.
 */
export function clineMcpSettingsPath(): string {
  const dataDir = process.env.CLINE_DATA_DIR ?? join(homedir(), ".cline", "data");
  return join(dataDir, "settings", "cline_mcp_settings.json");
}

/** Windows launcher that bakes the env into a file (Cline drops stdio `env`). */
export function clineMcpWrapperPath(baseDir?: string): string {
  return clineMcpWrapperPathFor(baseDir, "agentemployee");
}

function clineMcpWrapperPathFor(baseDir: string | undefined, name: string): string {
  return join(clineConfigDir(baseDir), `${name}-mcp.cmd`);
}

function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function buildCmdWrapper(entry: {
  command: string;
  args: string[];
  env: Record<string, string>;
}): string {
  const lines = ["@echo off"];
  for (const [key, value] of Object.entries(entry.env)) lines.push(`set "${key}=${value}"`);
  lines.push([`"${entry.command}"`, ...entry.args.map((arg) => `"${arg}"`)].join(" "));
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * Install (or remove) AgentEmployee's app-controls MCP server in Cline's own MCP
 * settings file.
 *
 * WHY THIS EXISTS. Cline's ACP session does NOT consume the `mcpServers` the
 * host passes in `session/new` — verified against cline 3.x: it silently
 * ignores them and only loads servers from its own `cline_mcp_settings.json`.
 * AgentEmployee already owns Cline's settings root via `CLINE_PROVIDER_SETTINGS_PATH`,
 * so writing the entry here is what actually reaches the agent.
 *
 * It is written as a **stdio** server (not the app-controls HTTP URL): Cline
 * surfaces remote HTTP servers inconsistently, while stdio is proven reliable.
 * `command` runs AgentEmployee's bundled `mcp-filter.mjs` proxy under the app's own
 * Electron-as-Node (`ELECTRON_RUN_AS_NODE=1`), which forwards to the per-thread
 * app-controls HTTP endpoint (its `?thread=` query and bearer token ride in the
 * filter config). No user-installed Node or network is required.
 *
 * Merge-preserving: other servers the user configured are kept. A `null`
 * argument removes the `agentemployee` entry; a no-op leaves a file without a
 * `agentemployee` entry untouched.
 */
export function persistClineAppControlsMcp(
  baseDir: string | undefined,
  entry: { command: string; args: string[]; env: Record<string, string> } | null,
): void {
  persistClineMcpServer(baseDir, "agentemployee", entry);
}

/**
 * Merge-preserving write of one AgentEmployee-owned stdio server into Cline's MCP
 * settings. `name` is the key Cline shows the server under; other servers the
 * user configured are kept. A `null` entry removes it.
 */
export function persistClineMcpServer(
  baseDir: string | undefined,
  name: string,
  entry: { command: string; args: string[]; env: Record<string, string> } | null,
): void {
  const path = clineMcpSettingsPath();
  const root = readJsonObject(path);
  const servers = isRecord(root.mcpServers) ? { ...root.mcpServers } : {};
  if (entry) {
    if (process.platform === "win32") {
      // Cline does not forward a stdio entry's `env` to the child, so the
      // Electron-as-Node switch and filter config must be baked into a launcher
      // script instead. `cmd.exe` is on PATH; args are honoured.
      const wrapperPath = clineMcpWrapperPathFor(baseDir, name);
      writeText(wrapperPath, buildCmdWrapper(entry));
      servers[name] = {
        transport: { type: "stdio", command: "cmd.exe", args: ["/c", wrapperPath] },
      };
    } else {
      servers[name] = { transport: { type: "stdio", ...entry } };
    }
  } else if (name in servers) {
    delete servers[name];
  } else {
    return;
  }
  const next = { ...root, mcpServers: servers };
  if (equal(root, next)) return;
  writeJson(path, next);
}

function readJsonObject(path: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Order-insensitive deep compare, so a benign key reorder is not a rewrite. */
function stableStringify(value: unknown): string {
  const sort = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(sort);
    if (isRecord(node)) {
      return Object.fromEntries(
        Object.keys(node)
          .sort()
          .map((key) => [key, sort(node[key])]),
      );
    }
    return node;
  };
  return JSON.stringify(sort(value));
}

function equal(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/**
 * Write `providers.json` (and, for the custom model, `models.json`) under the
 * AgentEmployee-owned Cline config dir, then return the `providers.json` path for
 * `CLINE_PROVIDER_SETTINGS_PATH`. Returns `undefined` when there is no API key
 * to persist — matching {@link resolveClineEnv}, which also declines to open the
 * gate in that case.
 *
 * Merge-preserving: a pre-existing entry keeps every `settings` field AgentEmployee
 * does not own (an OAuth `auth` block, `headers`, …) and a `cline auth` login's
 * `tokenSource: "oauth"` is not demoted to `manual`. Writes are skipped when
 * nothing changed, so calling this on every spawn is cheap.
 */
export function persistClineProviderConfig(
  baseDir: string | undefined,
  agentSettings: Record<string, boolean | string> | undefined,
): string | undefined {
  const apiKey = trimNonEmpty(agentSettings?.[CLINE_AGENT_SETTING_KEYS.apiKey]);
  if (!apiKey) return undefined;

  const provider = CLINE_OPENAI_COMPATIBLE_PROVIDER;
  const model = trimNonEmpty(agentSettings?.[CLINE_AGENT_SETTING_KEYS.model]);
  const baseUrl = trimNonEmpty(agentSettings?.[CLINE_AGENT_SETTING_KEYS.baseUrl]);
  const providersPath = clineProvidersPath(baseDir);

  try {
    const root = readJsonObject(providersPath);
    const providers = isRecord(root.providers) ? root.providers : {};
    const existing = isRecord(providers[provider])
      ? (providers[provider] as Record<string, unknown>)
      : {};
    const tokenSource = existing.tokenSource === "oauth" ? "oauth" : "manual";

    const settings: Record<string, string> = { provider, apiKey };
    if (model) settings.model = model;
    if (baseUrl) settings.baseUrl = baseUrl;

    if (
      root.version !== 1 ||
      root.lastUsedProvider !== provider ||
      !equal(existing.settings, settings) ||
      existing.tokenSource !== tokenSource
    ) {
      writeJson(providersPath, {
        ...root,
        version: 1,
        modes: isRecord(root.modes) ? root.modes : {},
        lastUsedProvider: provider,
        providers: {
          ...providers,
          [provider]: { settings, updatedAt: new Date().toISOString(), tokenSource },
        },
      });
    }
  } catch {
    // A read-only or otherwise unwritable data dir must not take down a spawn;
    // Cline simply falls back to whatever config it already has.
  }

  // `models.json` only matters for the custom-model provider, and only once the
  // endpoint is known — Cline's own migration skips a half-written entry too.
  if (model && baseUrl) {
    const modelsPath = clineModelsPath(baseDir);
    try {
      const root = readJsonObject(modelsPath);
      const providers = isRecord(root.providers) ? root.providers : {};
      const existing = isRecord(providers[provider])
        ? (providers[provider] as Record<string, unknown>)
        : {};
      const existingModels = isRecord(existing.models) ? existing.models : {};
      const desired = {
        provider: { name: "OpenAI Compatible", baseUrl, defaultModelId: model },
        models: {
          ...existingModels,
          [model]: {
            id: model,
            name: model,
            contextWindow: CUSTOM_MODEL_CONTEXT_WINDOW,
            maxInputTokens: CUSTOM_MODEL_CONTEXT_WINDOW,
            capabilities: ["streaming", "tools", "images"],
          },
        },
      };
      if (root.version !== 1 || !equal(existing, desired)) {
        writeJson(modelsPath, {
          ...root,
          version: 1,
          providers: { ...providers, [provider]: desired },
        });
      }
    } catch {
      // See above — best effort.
    }
  }

  return providersPath;
}
