import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentCapability,
  PromptSegment,
  ProjectLocation,
  ResolvedMcpServer,
} from "@/shared/contracts";
import { inlinePromptSegmentText } from "@/shared/promptContent";
import { EXTRACTION_PROMPT } from "@/supervisor/contextExtractor";
import { prepareOneShot } from "@/supervisor/oneShotSpawn";
import { resolveWslHelpersDir } from "@/supervisor/wsl/wslDeploy";
import { createAcpStructuredSession } from "../acp";
import {
  buildAgentCommand,
  detectAgentInstall,
  detectProbeLocation,
  mergeSpawnEnv,
  type AgentAdapter,
  type AgentEnvContext,
  type CreateStructuredSessionInput,
  type RunOneShotInput,
} from "../base";
import { primeAgentBinaryPath, resolveAgentBinaryPath } from "../binaryResolver";
import { CLINE_AUTO_APPROVE_CONFIG_OPTION_ID } from "./autoApprove";
import { buildClineArgs } from "./argv";
import { clineMcpSettingsPath, persistClineMcpServer, persistClineProviderConfig } from "./config";
import { clineDetectionSpec, defaultClineCapabilities } from "./detection";
import { resolveClineEnv } from "./env";
import { resolveEmbeddedClineBinaryPath } from "./install";
import {
  buildClineOneShotArgs,
  CLINE_ONE_SHOT_TIMEOUT_MS,
  parseClineOneShotOutput,
} from "./oneShot";
import { detectClineInvalidSessionRef } from "./session";

// Re-exported so renderer/settings consumers and tests keep importing the
// keys from the adapter's public entry point.
export { CLINE_AGENT_SETTING_KEYS } from "./env";

/**
 * Adapter for the Cline CLI's ACP mode (`cline --acp`).
 *
 * Cline speaks the Agent Client Protocol over stdio — the same surface as
 * Gemini, Cursor, Copilot, and the other first-class ACP adapters — so this
 * adapter is a thin shim: it owns Cline's argv shape and CLI metadata, and
 * delegates every protocol concern to the shared ACP runtime in `../acp`.
 *
 * Provider-specific behavior lives entirely inside this module:
 * - argv (`--acp`, and `--id` to resume — `--resume`/`--session-id` are not
 *   Cline flags; the provider/model/endpoint ride the launch env instead)
 * - auth (the `CLINE_API_KEY`/`CLINE_PROVIDER` gate plus a persisted
 *   `providers.json`; `cline auth` itself is interactive, surfaced as a
 *   synthesized terminal auth method via the detection spec)
 * - one-shot generation (`cline --json`, NDJSON parsed by `./oneShot`) and the
 *   context-extraction shell (positional prompt after the flags)
 *
 * No shared runtime file gets a Cline branch; the renderer side follows the
 * same rule via the manifest / provider plugin folders.
 */
export interface ClineAdapterOptions {
  /**
   * The AgentEmployee data dir the supervisor is actually running out of. `baseDir`
   * differs from the default `resolveAgentEmployeePaths()` root in dev
   * (`~/.agentemployee-dev`) and for a custom data root, and the offline installer
   * writes to that same base dir — so resolving the embedded copy from the
   * default root would look in the wrong place and never detect the install.
   */
  baseDir?: string;
  /**
   * Reads Cline's effective `agentSettings.cline` at spawn time. Exposed as
   * this adapter's {@link AgentMetadata.baseSpawnEnv} so the provider/model/
   * apiKey/baseUrl a user saved in the Cline settings panel ride EVERY spawn
   * lane the shared runtime drives off the adapter — one-shot generation
   * (titles, commits, judges), context extraction, PTY launches, and subagent
   * children — not just the ACP structured session and auth commands, which
   * merge the same values explicitly. Read lazily per call because the
   * built-in adapter instance is reused across settings refreshes; a captured
   * value would go stale on the next panel edit.
   */
  readAgentSettings?: (kind: string) => Record<string, boolean | string> | undefined;
}

/**
 * Build the stdio MCP entry Cline loads from its own settings file.
 *
 * Cline does not consume the `mcpServers` the host sends over ACP, and surfaces
 * remote HTTP servers inconsistently — so app-controls is exposed as a local
 * stdio server: AgentEmployee's bundled `mcp-filter.mjs` proxy, run under the app's
 * Electron-as-Node (`ELECTRON_RUN_AS_NODE=1`), forwarding to the per-thread
 * app-controls HTTP endpoint (URL + bearer token) carried in the filter config.
 * This needs no user-installed Node and no network beyond loopback.
 *
 * Returns `null` when app-controls is absent or the helper is not staged.
 */
function clineStdioEntry(
  server: ResolvedMcpServer | undefined,
  name: string,
): { command: string; args: string[]; env: Record<string, string> } | null {
  const helpersDir = resolveWslHelpersDir();
  if (!server || !helpersDir) return null;
  const workerPath = join(helpersDir, "mcp-filter.mjs");
  if (!existsSync(workerPath)) return null;
  const filterConfig = Buffer.from(
    JSON.stringify({
      server: {
        name,
        transport: server.transport,
        ...(server.timeoutMs !== undefined ? { timeoutMs: server.timeoutMs } : {}),
      },
      disabledTools: [],
    }),
    "utf8",
  ).toString("base64url");
  return {
    command: process.execPath,
    args: [workerPath],
    env: {
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      AGENTEMPLOYEE_MCP_FILTER_CONFIG: filterConfig,
    },
  };
}

export function createClineAdapter(options: ClineAdapterOptions = {}): AgentAdapter {
  const { baseDir } = options;
  let capabilities: AgentCapability = defaultClineCapabilities;

  const resolveEmbedded = (): string | undefined => resolveEmbeddedClineBinaryPath(baseDir);

  /**
   * Resolve the Cline binary, preferring an offline-installed copy under
   * `embedded-runtimes/cline/`. Falls back to the generic PATH probe only
   * when no offline install exists — that's how enterprise admins can pin
   * a specific Cline version across the fleet even against users who
   * happen to have their own `cline` on PATH.
   *
   * The embedded copy lives under the same AgentEmployee data dir regardless
   * of the current project location, so resolution is location-independent.
   * WSL never sees the Windows embedded copy (nor a POSIX one), so it stays
   * on PATH — matching `detectInstall` below.
   */
  function resolveClineBinary(location: ProjectLocation): string | undefined {
    const embedded = location.kind === "wsl" ? undefined : resolveEmbedded();
    if (embedded) return embedded;
    return resolveAgentBinaryPath(location, "cline");
  }

  /**
   * Resolve the binary for a one-shot / context-extraction spawn. Prefers the
   * offline install via {@link resolveClineBinary} and only then the bare
   * `cline` name, so a one-shot still finds an offline-installed copy that is
   * not on PATH. A bare `cline` here is exactly what made title generation
   * fall through to the next agent when Cline was installed offline.
   */
  function resolveOneShotBinary(location: ProjectLocation): string {
    return resolveClineBinary(location) ?? "cline";
  }

  /**
   * Translate the panel's saved settings into Cline's launch env, first
   * persisting the endpoint config to the AgentEmployee-owned `providers.json` /
   * `models.json` those env vars point at. Returns `{}` when nothing is
   * configured so `baseSpawnEnv` is always present.
   */
  function clineSpawnEnv(
    agentSettings: Record<string, boolean | string> | undefined,
  ): Record<string, string> {
    const settingsPath = persistClineProviderConfig(baseDir, agentSettings);
    return resolveClineEnv(agentSettings, settingsPath) ?? {};
  }

  return {
    kind: clineDetectionSpec.kind,
    label: clineDetectionSpec.label,
    binary: clineDetectionSpec.binary,
    ...(clineDetectionSpec.update ? { update: clineDetectionSpec.update } : {}),
    get capabilities() {
      return capabilities;
    },
    /**
     * The settings-panel credential, provider, model, and persisted config
     * path, applied to every adapter-driven spawn lane. Cline cannot
     * authenticate without them: `CLINE_API_KEY` is the only door past its ACP
     * auth gate a BYO endpoint can take, and `CLINE_PROVIDER_SETTINGS_PATH`
     * carries the base URL that has no env var. A probe or one-shot that omits
     * them runs against Cline's own account and returns `auth_required`, so
     * title generation, context extraction, PTY launches, and subagent
     * children all need them just as much as the ACP session does.
     * Recomputed on each read so a panel edit lands on the next spawn; `{}`
     * when nothing is configured so the property is always present.
     */
    get baseSpawnEnv(): Record<string, string> {
      return clineSpawnEnv(options.readAgentSettings?.(clineDetectionSpec.kind));
    },
    // OAuth safety on WSL: match Gemini so an interactive `cline auth` flow
    // doesn't try to xdg-open a browser inside the distro and hang the PTY.
    spawnEnv: {
      wsl: { BROWSER: "/bin/true" },
    },

    async detectInstall(ctx) {
      // Prefer an offline-installed binary over PATH (same pattern OpenCode
      // uses for version-gated installs). WSL never sees the Windows
      // embedded-runtimes copy, so it stays on PATH/`command -v`.
      const location = detectProbeLocation(ctx);
      const embedded = location.kind === "wsl" ? undefined : resolveEmbedded();
      if (embedded && location.kind === "windows") {
        primeAgentBinaryPath("windows", "cline", embedded);
      }
      const settings = ctx?.agentSettings ?? options.readAgentSettings?.(clineDetectionSpec.kind);
      const status = await detectAgentInstall(ctx, {
        ...clineDetectionSpec,
        baseSpawnEnv: clineSpawnEnv(settings),
        ...(embedded ? { binary: embedded } : {}),
      });
      capabilities = status.capabilities;
      return status;
    },

    buildLaunchArgv(location, config, prompt, _sessionRef, _launchOptions) {
      // No session id is pre-assigned: Cline has no flag to seed one (its CLI
      // rejects `--session-id`), so it allocates the id over ACP and the shared
      // runtime discovers it after `initialize` — matching
      // `createInitialSessionRef` below.
      return {
        binary: resolveClineBinary(location) ?? "cline",
        args: buildClineArgs(config, prompt),
      };
    },

    buildResumeArgv(location, config, prompt, sessionRef, _launchOptions) {
      return {
        binary: resolveClineBinary(location) ?? "cline",
        args: buildClineArgs(config, prompt, sessionRef.providerSessionId),
      };
    },

    async createStructuredSession(input: CreateStructuredSessionInput) {
      // Cline ignores the `mcpServers` handed to `session/new` over ACP; it only
      // reads its own `cline_mcp_settings.json`. Persist AgentEmployee's app-controls
      // (per-thread URL + token) there before the session opens so the agent
      // actually receives `fill_document_template` and the other app tools.
      const appControls = input.mcpServers?.find((server) => server.id === "app-controls");
      const appControlsEntry = clineStdioEntry(appControls, "agentemployee");
      if (!appControlsEntry) {
        // Silent loss here is what leaves the agent with no diff_paths /
        // fill_document_template and pushing it to hand-roll scripts instead.
        console.warn(
          "[cline] app-controls MCP not attached (%s); the agent will have no app-controls tools.",
          !appControls
            ? "app-controls server was not resolved for this launch — check AGENTEMPLOYEE_APP_CONTROLS_MCP_URL/TOKEN and that the built-in app-controls MCP is enabled"
            : "mcp-filter.mjs helper is missing under the WSL helpers dir",
        );
      }
      persistClineMcpServer(baseDir, "agentemployee", appControlsEntry);
      // The knowledge base rides the same file: Cline only loads servers from
      // its own settings, so a thread that opted in gets kb_* only via this entry.
      const knowledge = input.mcpServers?.find((server) => server.id === "knowledge");
      const knowledgeEntry = clineStdioEntry(knowledge, "knowledge");
      persistClineMcpServer(baseDir, "knowledge", knowledgeEntry);
      if (knowledge && !knowledgeEntry) {
        console.warn(
          "[cline] knowledge base MCP not attached (mcp-filter.mjs helper missing) — the agent will have no kb_* tools.",
        );
      }
      if (appControlsEntry) {
        console.log(
          "[cline] app-controls MCP entry written to %s (proxy %d args) — Cline loads servers only from this file",
          clineMcpSettingsPath(),
          appControlsEntry.args.length,
        );
      }
      // The credential, provider id, model, and the persisted config path all
      // travel in env (see `clineSpawnEnv`); the ACP session then negotiates
      // the per-thread model/mode over `configOptions` after `initialize`.
      const env = mergeSpawnEnv(input.env, clineSpawnEnv(input.agentSettings));
      const command = buildAgentCommand(
        input.projectLocation,
        "cline",
        buildClineArgs(input.config, ""),
        resolveClineBinary(input.projectLocation),
        env,
      );
      return createAcpStructuredSession(command, input, {
        // Cline's only real auto-approval mechanism. Its `allow_always`
        // permission option is a no-op (see ./autoApprove.ts), so the shared
        // runtime drives this boolean switch instead.
        autoApproveConfigOptionId: CLINE_AUTO_APPROVE_CONFIG_OPTION_ID,
        // Cline ignores the `mcpServers` handed to `session/new` over ACP
        // entirely; it only loads servers from `cline_mcp_settings.json`, which
        // `createStructuredSession` writes above. So no assumed MCP transport
        // capability is declared here.
      });
    },
    async buildAcpAuthCommand(ctx?: AgentEnvContext) {
      const location = detectProbeLocation(ctx);
      // Auth probe runs in a fresh ACP session, so it needs the same
      // `CLINE_*` env (and persisted config path) as a real launch.
      const env = clineSpawnEnv(ctx?.agentSettings);
      return buildAgentCommand(location, "cline", ["--acp"], resolveClineBinary(location), env);
    },

    createInitialSessionRef() {
      // Cline assigns its own session id over ACP; we never pre-mint on the
      // supervisor side.
      return undefined;
    },

    formatPromptSegments(segments: PromptSegment[]) {
      // Cline ACP sessions receive prompts through the protocol stream, not
      // as `@path` file references. Concatenate text segments verbatim and
      // ignore attachment segments — the renderer's composer already stages
      // attachment text into the prompt upstream of this hook.
      const text = segments.map(inlinePromptSegmentText).join("");
      return text;
    },

    detectInvalidSessionRef: detectClineInvalidSessionRef,

    // Placeholder default for one-shot generation before the ACP probe fills
    // `capabilities.models`. The detection engine overwrites this with the
    // live model list at the first detection pass.
    defaultOneShotModel: "gdsAgent-sonnet-4.5",

    /**
     * Run a one-shot through `cline --json` and return the final assistant
     * text.
     *
     * Cline's default one-shot output is a styled TUI stream whose first line
     * is the model's ANSI-escaped reasoning preamble — parsing it as the answer
     * is what garbled thread titles. `--json` emits NDJSON instead, and
     * {@link parseClineOneShotOutput} reads the finished turn's `run_result`.
     *
     * The prompt is a POSITIONAL argument (`-p` is `--plan`, not "prompt"); the
     * provider, key, and endpoint come from `baseSpawnEnv` (`CLINE_*`), read
     * lazily so a settings edit lands on the next call. The binary is resolved
     * like the ACP lanes so an offline-installed copy — which is not on PATH —
     * is still found.
     */
    async runOneShot(input: RunOneShotInput): Promise<string> {
      const env = clineSpawnEnv(options.readAgentSettings?.(clineDetectionSpec.kind));
      const { spec, spawn } = prepareOneShot(input.location, {
        command: resolveOneShotBinary(input.location),
        args: buildClineOneShotArgs(input.model, input.prompt),
        env,
      });
      const raw = await spawn(spec, "", CLINE_ONE_SHOT_TIMEOUT_MS, input.signal);
      const result = parseClineOneShotOutput(raw);
      if (result.text) return result.text;
      throw new Error(result.error ?? "Cline one-shot produced no output");
    },
    buildContextExtractionCommand(sessionRef, location, model) {
      // `--id` is Cline's resume-by-id flag (`--resume`/`--session-id` do not
      // exist and the CLI rejects them). Flags precede the positional prompt,
      // matching the usage line `cline [options] [command] [prompt]`.
      return {
        command: resolveOneShotBinary(location),
        args: [
          "--id",
          sessionRef.providerSessionId,
          "-m",
          model ?? "gdsAgent-sonnet-4.5",
          EXTRACTION_PROMPT,
        ],
        stdin: "",
      };
    },
  };
}
