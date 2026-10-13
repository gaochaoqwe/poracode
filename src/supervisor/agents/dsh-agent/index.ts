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
import { resolveAgentBinaryPath } from "../binaryResolver";
import { buildDshAgentArgs } from "./argv";
import { dshAgentDetectionSpec, defaultDshAgentCapabilities } from "./detection";
import { configuredDshAgentBinaryPath, resolveDshAgentEnv } from "./env";
import {
  buildDshAgentOneShotArgs,
  DSH_AGENT_ONE_SHOT_TIMEOUT_MS,
  DSH_BACKEND_ENV_KEY,
  DSH_HEADLESS_MODE_VALUE,
  parseDshAgentOneShotOutput,
} from "./oneShot";
import { detectDshAgentInvalidSessionRef } from "./session";

// Re-exported so renderer/settings consumers and tests keep importing the
// keys from the adapter's public entry point.
export { DSH_AGENT_AGENT_SETTING_KEYS } from "./env";

/**
 * Adapter for the dshAgent (DeepSeek Harness) ACP harness.
 *
 * dshAgent is our Bun-compiled launcher that forwards the Agent Client Protocol
 * to the official DeepSeek Harness (`dsh --profile acp`) over stdio — the same
 * surface as Cline, Gemini, Cursor, and the other first-class ACP adapters — so
 * this adapter is a thin shim: it owns dshAgent's argv shape and CLI metadata,
 * and delegates every protocol concern to the shared ACP runtime in `../acp`.
 *
 * Provider-specific behavior lives entirely inside this module:
 * - portable launcher resolution (a user-picked `dshAgent.exe` path stored in
 *   the settings panel as `binaryPath`; the bundle carries its node-runtime +
 *   node_modules beside it, so it runs in place — no copy is needed)
 * - auth + endpoint (panel `model/apiKey/baseUrl` → `DSH_MODEL` /
 *   `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL`, read directly as env)
 * - one-shot generation (the launcher switched into `dsh --profile headless`
 *   via `DSH_AGENT_MODE=headless`)
 *
 * No shared runtime file gets a dshAgent branch; the renderer side follows
 * the same rule via the manifest / provider plugin folders.
 */
export interface DshAgentAcpAdapterOptions {
  /**
   * Reads dshAgent's effective `agentSettings.dsh-agent` at spawn time. Exposed
   * as this adapter's {@link AgentAdapter.baseSpawnEnv} so the
   * provider/model/apiKey/baseUrl/binaryPath a user saved in the dshAgent
   * settings panel ride EVERY spawn lane the shared runtime drives off the
   * adapter — one-shot generation (titles, commits, judges), PTY launches, and
   * subagent children — not just the ACP structured session, which merges the
   * same values explicitly. Read lazily per call because the built-in adapter
   * instance is reused across settings refreshes; a captured value would go
   * stale on the next panel edit.
   */
  readAgentSettings?: (kind: string) => Record<string, boolean | string> | undefined;
}

export function createDshAgentAcpAdapter(options: DshAgentAcpAdapterOptions = {}): AgentAdapter {
  let capabilities: AgentCapability = defaultDshAgentCapabilities;

  function readSettings(): Record<string, boolean | string> | undefined {
    return options.readAgentSettings?.(dshAgentDetectionSpec.kind);
  }

  /**
   * Resolve the dshAgent launcher, preferring the portable path the user
   * picked in the settings panel. Falls back to the generic PATH probe only
   * when no path is configured. The launcher runs in place (its node-runtime
   * and node_modules live beside it), so any location works.
   */
  function resolveDshAgentBinary(location: ProjectLocation): string | undefined {
    const configured = configuredDshAgentBinaryPath(readSettings());
    if (configured) return configured;
    return resolveAgentBinaryPath(location, "dshAgent");
  }

  /**
   * Resolve the binary for a one-shot spawn. Prefers the configured launcher
   * and only then the bare `dshAgent` name.
   */
  function resolveOneShotBinary(location: ProjectLocation): string {
    return resolveDshAgentBinary(location) ?? "dshAgent";
  }

  /**
   * Translate the panel's saved settings into dsh's launch env. Unlike Cline
   * there is no `providers.json` to persist — every field maps straight to a
   * process env var the agent reads directly.
   */
  function dshAgentSpawnEnv(
    agentSettings: Record<string, boolean | string> | undefined,
  ): Record<string, string> {
    return resolveDshAgentEnv(agentSettings);
  }

  return {
    kind: dshAgentDetectionSpec.kind,
    label: dshAgentDetectionSpec.label,
    binary: dshAgentDetectionSpec.binary,
    get capabilities() {
      return capabilities;
    },
    /**
     * The settings-panel credential, endpoint, and model, applied to every
     * adapter-driven spawn lane. Recomputed on each read so a panel edit lands
     * on the next spawn; `{}` when nothing is configured so the property is
     * always present. Note this env intentionally does NOT carry
     * `DSH_AGENT_MODE` — the launcher serves ACP by default; only the one-shot
     * lane sets it (see {@link runOneShot}).
     */
    get baseSpawnEnv(): Record<string, string> {
      return dshAgentSpawnEnv(readSettings());
    },

    async detectInstall(ctx) {
      const settings = ctx?.agentSettings ?? readSettings();
      const configuredBinary = configuredDshAgentBinaryPath(settings);
      const status = await detectAgentInstall(ctx, {
        ...dshAgentDetectionSpec,
        baseSpawnEnv: dshAgentSpawnEnv(settings),
        ...(configuredBinary ? { binary: configuredBinary } : {}),
      });
      capabilities = status.capabilities;
      return status;
    },

    buildLaunchArgv(location, config, prompt, _sessionRef, _launchOptions) {
      // No session id is pre-assigned: dsh allocates the id over ACP and the
      // shared runtime discovers it after `initialize`.
      return {
        binary: resolveDshAgentBinary(location) ?? "dshAgent",
        args: buildDshAgentArgs(config, prompt),
      };
    },

    buildResumeArgv(location, config, prompt, sessionRef, _launchOptions) {
      // Resume is handled over the ACP protocol (the launcher ignores argv), so
      // the same argv applies.
      void sessionRef;
      return {
        binary: resolveDshAgentBinary(location) ?? "dshAgent",
        args: buildDshAgentArgs(config, prompt),
      };
    },

    async createStructuredSession(input: CreateStructuredSessionInput) {
      // dsh loads MCP servers from its own profile config, not the `mcpServers`
      // handed to `session/new` over ACP, so app-controls / knowledge are not
      // attached here (a known limitation for the harness).
      const env = mergeSpawnEnv(input.env, dshAgentSpawnEnv(input.agentSettings));
      const command = buildAgentCommand(
        input.projectLocation,
        "dshAgent",
        buildDshAgentArgs(input.config, ""),
        resolveDshAgentBinary(input.projectLocation),
        env,
      );
      return createAcpStructuredSession(command, input);
    },
    async buildAcpAuthCommand(ctx?: AgentEnvContext) {
      const location = detectProbeLocation(ctx);
      const env = dshAgentSpawnEnv(ctx?.agentSettings);
      return buildAgentCommand(
        location,
        "dshAgent",
        [],
        resolveDshAgentBinary(location),
        env,
      );
    },

    createInitialSessionRef() {
      // dsh assigns its own session id over ACP; we never pre-mint on the
      // supervisor side.
      return undefined;
    },

    formatPromptSegments(segments: PromptSegment[]) {
      // dsh ACP sessions receive prompts through the protocol stream, not as
      // `@path` file references. Concatenate text segments verbatim and ignore
      // attachment segments — the renderer's composer already stages attachment
      // text into the prompt upstream of this hook.
      const text = segments.map(inlinePromptSegmentText).join("");
      return text;
    },

    detectInvalidSessionRef: detectDshAgentInvalidSessionRef,

    // Placeholder default for one-shot generation before the ACP probe fills
    // `capabilities.models`. The detection engine overwrites this with the
    // live model list at the first detection pass.
    defaultOneShotModel: "deepseek-v4-flash",

    /**
     * Run a one-shot through `dsh --profile headless`.
     *
     * The launcher is an ACP server by default, so the one-shot env must switch
     * it into headless mode (`DSH_AGENT_MODE=headless`); otherwise it would
     * serve ACP over stdio and hang waiting for protocol frames. The
     * `DEEPSEEK_*` endpoint/credential ride the same env the ACP session uses,
     * read lazily so a settings edit lands on the next call. The model is
     * forwarded as `DSH_MODEL`, preferring the one-shot's selected model over
     * the panel default.
     */
    async runOneShot(input: RunOneShotInput): Promise<string> {
      const env = {
        ...dshAgentSpawnEnv(readSettings()),
        [DSH_BACKEND_ENV_KEY]: DSH_HEADLESS_MODE_VALUE,
        ...(input.model?.trim()
          ? { DSH_MODEL: input.model.trim() }
          : {}),
      };
      const { spec, spawn } = prepareOneShot(input.location, {
        command: resolveOneShotBinary(input.location),
        args: buildDshAgentOneShotArgs(input.model, input.prompt),
        env,
      });
      const raw = await spawn(spec, "", DSH_AGENT_ONE_SHOT_TIMEOUT_MS, input.signal);
      const result = parseDshAgentOneShotOutput(raw);
      if (result.text) return result.text;
      throw new Error(result.error ?? "dshAgent one-shot produced no output");
    },
  };
}
