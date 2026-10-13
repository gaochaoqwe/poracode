import type {
  AgentCapability,
  PromptSegment,
  ProjectLocation,
} from "@/shared/contracts";
import { inlinePromptSegmentText } from "@/shared/promptContent";
import { prepareOneShot } from "@/supervisor/oneShotSpawn";
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
import { buildGdsAgentArgs } from "./argv";
import { gdsAgentDetectionSpec, defaultGdsAgentCapabilities } from "./detection";
import { resolveGdsAgentEnv } from "./env";
import { resolveEmbeddedGdsAgentBinaryPath } from "./install";
import {
  buildGdsAgentOneShotArgs,
  GDS_AGENT_ONE_SHOT_TIMEOUT_MS,
  parseGdsAgentOneShotOutput,
  RJB_BACKEND_ENV_KEY,
} from "./oneShot";
import { detectGdsAgentInvalidSessionRef } from "./session";

// Re-exported so renderer/settings consumers and tests keep importing the
// keys from the adapter's public entry point.
export { GDS_AGENT_AGENT_SETTING_KEYS } from "./env";

/**
 * Adapter for the gdsAgent (gdsAgent) ACP harness.
 *
 * gdsAgent is a single self-contained exe that speaks the Agent Client Protocol
 * over stdio — the same surface as Cline, Gemini, Cursor, and the other
 * first-class ACP adapters — so this adapter is a thin shim: it owns gdsAgent's
 * argv shape and CLI metadata, and delegates every protocol concern to the
 * shared ACP runtime in `../acp`.
 *
 * Provider-specific behavior lives entirely inside this module:
 * - offline install / embedded resolution (a separately shipped `gdsAgent.exe`,
 *   pinned under `embedded-runtimes/gds-agent/`)
 * - auth + endpoint (panel `model/apiKey/baseUrl` → `ANTHROPIC_MODEL` /
 *   `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL`, read directly as env)
 * - one-shot generation (the exe switched into its bundled CLI's `-p` print
 *   mode via `RJB_GDSAGENT_BACKEND=1`)
 *
 * No shared runtime file gets a gdsAgent branch; the renderer side follows
 * the same rule via the manifest / provider plugin folders.
 */
export interface GdsAgentAcpAdapterOptions {
  /**
   * The AgentEmployee data dir the supervisor is actually running out of. `baseDir`
   * differs from the default `resolveAgentEmployeePaths()` root in dev
   * (`~/.agentemployee-dev`) and for a custom data root, and the offline installer
   * writes to that same base dir — so resolving the embedded copy from the
   * default root would look in the wrong place and never detect the install.
   */
  baseDir?: string;
  /**
   * Reads gdsAgent's effective `agentSettings.gds-agent` at spawn time.
   * Exposed as this adapter's {@link AgentAdapter.baseSpawnEnv} so the
   * provider/model/apiKey/baseUrl a user saved in the gdsAgent settings
   * panel ride EVERY spawn lane the shared runtime drives off the adapter —
   * one-shot generation (titles, commits, judges), PTY launches, and subagent
   * children — not just the ACP structured session, which merges the same
   * values explicitly. Read lazily per call because the built-in adapter
   * instance is reused across settings refreshes; a captured value would go
   * stale on the next panel edit.
   */
  readAgentSettings?: (kind: string) => Record<string, boolean | string> | undefined;
}

export function createGdsAgentAcpAdapter(options: GdsAgentAcpAdapterOptions = {}): AgentAdapter {
  const { baseDir } = options;
  let capabilities: AgentCapability = defaultGdsAgentCapabilities;

  const resolveEmbedded = (): string | undefined => resolveEmbeddedGdsAgentBinaryPath(baseDir);

  /**
   * Resolve the gdsAgent binary, preferring an offline-installed copy under
   * `embedded-runtimes/gds-agent/`. Falls back to the generic PATH probe only
   * when no offline install exists — that's how enterprise admins can pin a
   * specific gdsAgent build across the fleet. The embedded copy lives under the
   * same AgentEmployee data dir regardless of the current project location, so
   * resolution is location-independent. WSL never sees the Windows embedded
   * copy, so it stays on PATH.
   */
  function resolveGdsAgentBinary(location: ProjectLocation): string | undefined {
    const embedded = location.kind === "wsl" ? undefined : resolveEmbedded();
    if (embedded) return embedded;
    return resolveAgentBinaryPath(location, "gdsAgent");
  }

  /**
   * Resolve the binary for a one-shot spawn. Prefers the offline install via
   * {@link resolveGdsAgentBinary} and only then the bare `gdsAgent` name, so
   * a one-shot still finds an offline-installed copy that is not on PATH.
   */
  function resolveOneShotBinary(location: ProjectLocation): string {
    return resolveGdsAgentBinary(location) ?? "gdsAgent";
  }

  /**
   * Translate the panel's saved settings into cc-haha's launch env. Unlike
   * Cline there is no `providers.json` to persist — every field maps straight
   * to a process env var the agent reads directly.
   */
  function gdsAgentSpawnEnv(
    agentSettings: Record<string, boolean | string> | undefined,
  ): Record<string, string> {
    return resolveGdsAgentEnv(agentSettings);
  }

  return {
    kind: gdsAgentDetectionSpec.kind,
    label: gdsAgentDetectionSpec.label,
    binary: gdsAgentDetectionSpec.binary,
    get capabilities() {
      return capabilities;
    },
    /**
     * The settings-panel credential, endpoint, and model, applied to every
     * adapter-driven spawn lane. Recomputed on each read so a panel edit lands
     * on the next spawn; `{}` when nothing is configured so the property is
     * always present. Note this env intentionally does NOT carry
     * `RJB_GDSAGENT_BACKEND` — the ACP-mode exe switches itself into backend mode
     * internally; only the one-shot lane sets it (see {@link runOneShot}).
     */
    get baseSpawnEnv(): Record<string, string> {
      return gdsAgentSpawnEnv(options.readAgentSettings?.(gdsAgentDetectionSpec.kind));
    },
    // OAuth safety on WSL: gdsAgent is Windows-only, so a WSL location has no
    // embedded binary and the adapter falls back to PATH; the bundled CLI's
    // interactive login would not xdg-open a browser inside the distro anyway.
    spawnEnv: {
      wsl: { BROWSER: "/bin/true" },
    },

    async detectInstall(ctx) {
      // Prefer an offline-installed binary over PATH (same pattern Cline uses).
      const location = detectProbeLocation(ctx);
      const embedded = location.kind === "wsl" ? undefined : resolveEmbedded();
      if (embedded && location.kind === "windows") {
        primeAgentBinaryPath("windows", "gdsAgent", embedded);
      }
      const settings = ctx?.agentSettings ?? options.readAgentSettings?.(gdsAgentDetectionSpec.kind);
      const status = await detectAgentInstall(ctx, {
        ...gdsAgentDetectionSpec,
        baseSpawnEnv: gdsAgentSpawnEnv(settings),
        ...(embedded ? { binary: embedded } : {}),
      });
      capabilities = status.capabilities;
      return status;
    },

    buildLaunchArgv(location, config, prompt, _sessionRef, _launchOptions) {
      // No session id is pre-assigned: gdsAgent allocates the id over ACP and
      // the shared runtime discovers it after `initialize`.
      return {
        binary: resolveGdsAgentBinary(location) ?? "gdsAgent",
        args: buildGdsAgentArgs(config, prompt),
      };
    },

    buildResumeArgv(location, config, prompt, sessionRef, _launchOptions) {
      // Resume is handled over the ACP protocol (gdsAgent's ACP entry ignores
      // argv), so the same argv applies.
      void sessionRef;
      return {
        binary: resolveGdsAgentBinary(location) ?? "gdsAgent",
        args: buildGdsAgentArgs(config, prompt),
      };
    },

    async createStructuredSession(input: CreateStructuredSessionInput) {
      // cc-haha loads MCP servers from its own settings file, not the
      // `mcpServers` handed to `session/new` over ACP, so app-controls /
      // knowledge are not attached here (a known limitation for the harness).
      const env = mergeSpawnEnv(input.env, gdsAgentSpawnEnv(input.agentSettings));
      const command = buildAgentCommand(
        input.projectLocation,
        "gdsAgent",
        buildGdsAgentArgs(input.config, ""),
        resolveGdsAgentBinary(input.projectLocation),
        env,
      );
      return createAcpStructuredSession(command, input);
    },
    async buildAcpAuthCommand(ctx?: AgentEnvContext) {
      const location = detectProbeLocation(ctx);
      const env = gdsAgentSpawnEnv(ctx?.agentSettings);
      return buildAgentCommand(location, "gdsAgent", ["--acp"], resolveGdsAgentBinary(location), env);
    },

    createInitialSessionRef() {
      // gdsAgent assigns its own session id over ACP; we never pre-mint on the
      // supervisor side.
      return undefined;
    },

    formatPromptSegments(segments: PromptSegment[]) {
      // gdsAgent ACP sessions receive prompts through the protocol stream, not
      // as `@path` file references. Concatenate text segments verbatim and
      // ignore attachment segments — the renderer's composer already stages
      // attachment text into the prompt upstream of this hook.
      const text = segments.map(inlinePromptSegmentText).join("");
      return text;
    },

    detectInvalidSessionRef: detectGdsAgentInvalidSessionRef,

    // Placeholder default for one-shot generation before the ACP probe fills
    // `capabilities.models`. The detection engine overwrites this with the
    // live model list at the first detection pass.
    defaultOneShotModel: "gdsAgent-sonnet-4.5",

    /**
     * Run a one-shot through the bundled CLI's `-p` print mode.
     *
     * The exe is an ACP server by default, so the one-shot env must switch it
     * into backend mode (`RJB_GDSAGENT_BACKEND=1`); otherwise it would serve ACP
     * over stdio and hang waiting for protocol frames. The `ANTHROPIC_*`
     * endpoint/credential/model ride the same env the ACP session uses, read
     * lazily so a settings edit lands on the next call.
     */
    async runOneShot(input: RunOneShotInput): Promise<string> {
      const env = {
        ...gdsAgentSpawnEnv(options.readAgentSettings?.(gdsAgentDetectionSpec.kind)),
        [RJB_BACKEND_ENV_KEY]: "1",
      };
      const { spec, spawn } = prepareOneShot(input.location, {
        command: resolveOneShotBinary(input.location),
        args: buildGdsAgentOneShotArgs(input.model, input.prompt),
        env,
      });
      const raw = await spawn(spec, "", GDS_AGENT_ONE_SHOT_TIMEOUT_MS, input.signal);
      const result = parseGdsAgentOneShotOutput(raw);
      if (result.text) return result.text;
      throw new Error(result.error ?? "gdsAgent one-shot produced no output");
    },
  };
}
