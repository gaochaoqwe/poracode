import type { AgentCapability } from "@/shared/contracts";
import { humanizeModelId, probeAcpCapabilities } from "../acp";
import {
  buildAgentCommand,
  envVarAuthProbe,
  type DetectionSpec,
} from "../base";
import { buildContextSizeCapabilities } from "../contextWindowLabel";
import { getAgentProbeCwd } from "../probeCwd";
import { DSH_AGENT_AGENT_SETTING_KEYS, configuredDshAgentBinaryPath } from "./env";

/**
 * dshAgent (DeepSeek Harness) runs as an ACP subprocess (`dshAgent.exe`) and
 * exposes models, modes, approval policies, and permission requests through the
 * Agent Client Protocol. We do not declare any model list statically —
 * `capabilitiesProbe` fills `models`, `efforts`, `modes`, `approvalPolicies`,
 * etc. at detection time from the real agent response. `deepseek-v4-flash` is a
 * best-effort placeholder for one-shot generation when capabilities have not
 * been probed yet (the live capabilities override it after the first detection
 * pass).
 */
export const defaultDshAgentCapabilities: AgentCapability = {
  models: [],
  efforts: [],
  modelEfforts: {},
  modes: [],
  approvalPolicies: [],
  sandboxModes: [],
  supportsResume: true,
  supportsOneShot: true,
  supportsDirectInput: true,
  liveInputMode: "terminal",
  presentationMode: "terminal",
  presentationModes: ["terminal", "gui"],
  defaultApprovalPolicy: "never",
  bypassPermissions: { approvalPolicy: "never" },
  mcpScope: { terminal: "launch", gui: "launch" },
  settingDefs: [],
};

/**
 * Treat an API key saved in the dshAgent settings panel as authenticated.
 *
 * The panel writes `agentSettings.dsh-agent.apiKey`, which launch forwards as
 * `DEEPSEEK_API_KEY`; a user who configured a gateway there is signed in for
 * every practical purpose even though `process.env.DEEPSEEK_API_KEY` is unset in
 * the supervisor. This probe runs before the env heuristic so a panel-configured
 * credential is not reported as "missing" (which would block the composer with a
 * spurious sign-in prompt).
 */
export const dshAgentSettingsAuthProbe = async (ctx: {
  agentSettings?: Record<string, boolean | string>;
}): Promise<"authenticated" | undefined> => {
  const apiKey = ctx.agentSettings?.[DSH_AGENT_AGENT_SETTING_KEYS.apiKey];
  return typeof apiKey === "string" && apiKey.trim().length > 0 ? "authenticated" : undefined;
};

type DshAgentModelOption = {
  id: string;
  label: string;
  description?: string;
  tooltipDescription?: string;
};

/**
 * The model the user configured in the panel, shaped as a capability entry.
 *
 * dsh only advertises models over ACP after an authenticated `newSession`, and
 * that catalog never contains a free-form id the user typed for a custom
 * gateway. Surface the configured model as a selectable entry regardless of
 * what the probe returned — it is the exact id launch forwards via `DSH_MODEL`,
 * so the composer must be able to select it.
 */
export function configuredDshAgentModels(
  agentSettings: Record<string, boolean | string> | undefined,
): DshAgentModelOption[] {
  const model = agentSettings?.[DSH_AGENT_AGENT_SETTING_KEYS.model];
  if (typeof model !== "string" || model.trim().length === 0) return [];
  const id = model.trim();
  return [{ id, label: humanizeDshAgentModelId(id) }];
}

/**
 * Put the panel-configured model at the front of the detected catalog, keeping
 * the probe's richer entry when both name the same id. Without this the user's
 * custom model is selectable in Settings but invisible in the composer.
 */
export function mergeDshAgentModels(
  configured: DshAgentModelOption[],
  probed: DshAgentModelOption[] | undefined,
): DshAgentModelOption[] {
  const detected = probed ?? [];
  if (configured.length === 0) return detected;
  const detectedIds = new Set(detected.map((model) => model.id));
  return [...configured.filter((model) => !detectedIds.has(model.id)), ...detected];
}

/**
 * Whether the panel points dshAgent at a specific endpoint rather than its own
 * account. A key or a base URL means the user brought their own OpenAI-
 * compatible provider, so the models dsh advertises for its own account are
 * irrelevant — only the model id the user typed is valid there.
 */
export function hasCustomDshAgentEndpoint(
  agentSettings: Record<string, boolean | string> | undefined,
): boolean {
  const key = agentSettings?.[DSH_AGENT_AGENT_SETTING_KEYS.apiKey];
  const baseUrl = agentSettings?.[DSH_AGENT_AGENT_SETTING_KEYS.baseUrl];
  return (
    (typeof key === "string" && key.trim().length > 0) ||
    (typeof baseUrl === "string" && baseUrl.trim().length > 0)
  );
}

/**
 * The composer's model list for dshAgent.
 *
 * When the panel is configured for a custom endpoint, expose ONLY the model
 * the user typed: the probed catalog belongs to dsh's own account and none of
 * it is reachable through the user's gateway. With no custom endpoint, keep the
 * merge so a configured model id — and the probe's richer entry for it — still
 * surface.
 */
export function dshAgentComposerModels(
  agentSettings: Record<string, boolean | string> | undefined,
  probed: DshAgentModelOption[] | undefined,
): DshAgentModelOption[] {
  const configured = configuredDshAgentModels(agentSettings);
  if (hasCustomDshAgentEndpoint(agentSettings)) return configured;
  return mergeDshAgentModels(configured, probed);
}

/**
 * Humanize dshAgent's model ids. DeepSeek emits plain ids (e.g.
 * `deepseek-v4-pro`), so we pass them straight through `humanizeModelId`.
 */
export function humanizeDshAgentModelId(id: string): string {
  return humanizeModelId(id);
}

export const dshAgentDetectionSpec: DetectionSpec = {
  kind: "dsh-agent",
  label: "dshAgent",
  binary: "dshAgent",
  capabilities: defaultDshAgentCapabilities,
  // No `statusProbe` — the only auth signal we can read without a protocol
  // round-trip is a panel-configured key or `DEEPSEEK_API_KEY` env. The
  // detection engine overwrites the auth state with the protocol-derived value
  // when the capabilities probe succeeds, which is the source of truth.
  authProbes: [dshAgentSettingsAuthProbe, envVarAuthProbe(["DEEPSEEK_API_KEY"])],
  async capabilitiesProbe(ctx) {
    // Prefer the panel-configured portable launcher path over PATH; the
    // detection engine has already resolved `ctx.executablePath` for us from
    // the adapter's `binary` (which we override with the configured path in
    // `detectInstall`), so this is a defensive check only.
    const binary = configuredDshAgentBinaryPath(ctx.agentSettings) ?? ctx.executablePath;
    if (!binary) return undefined;
    // The endpoint, credential, and model reach the probe through
    // `ctx.probeEnv`, which `detectAgentInstall` merges from the adapter's
    // `baseSpawnEnv` (the `DEEPSEEK_*` trio + `DSH_MODEL`). Without them dsh's
    // `newSession` returns `auth_required` and detection would report "missing"
    // with no models even though the user configured a working provider.
    const probeArgs: string[] = [];
    const probeEnv = ctx.probeEnv;
    const probeCmd =
      ctx.location.kind === "wsl"
        ? buildAgentCommand(ctx.location, "dshAgent", probeArgs, binary, probeEnv)
        : buildAgentCommand(ctx.location, binary, probeArgs, undefined, probeEnv);
    const probeCwd = ctx.location.kind === "wsl" ? "/tmp" : getAgentProbeCwd(ctx.location);
    const probeResult = await probeAcpCapabilities(probeCmd.command, probeCmd.args, probeCwd, {
      timeoutMs: 15_000,
      modelLabel: humanizeDshAgentModelId,
      ...(probeCmd.env ? { env: probeCmd.env } : {}),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
      label: `dsh-agent:${ctx.location.kind}`,
    });

    if (!probeResult) {
      const fallbackModels = configuredDshAgentModels(ctx.agentSettings);
      return fallbackModels.length ? { models: fallbackModels } : undefined;
    }

    const models = dshAgentComposerModels(ctx.agentSettings, probeResult.models);
    const modelTokens = new Map<string, number>();
    return {
      ...(models.length ? { models } : {}),
      ...(probeResult.efforts?.length ? { efforts: probeResult.efforts } : {}),
      ...(probeResult.defaultEffort ? { defaultEffort: probeResult.defaultEffort } : {}),
      ...(probeResult.thinkingModels ? { thinkingModels: probeResult.thinkingModels } : {}),
      ...(probeResult.modes?.length ? { modes: probeResult.modes } : {}),
      ...(probeResult.approvalPolicies?.length
        ? { approvalPolicies: probeResult.approvalPolicies }
        : {}),
      ...(probeResult.slashCommands?.length ? { slashCommands: probeResult.slashCommands } : {}),
      ...buildContextSizeCapabilities(modelTokens),
      ...(probeResult.authLogoutSupported ? { authLogoutSupported: true } : {}),
      ...(probeResult.authState ? { authState: probeResult.authState } : {}),
    };
  },
};
