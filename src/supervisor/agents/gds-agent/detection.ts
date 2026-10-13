import type { AgentCapability } from "@/shared/contracts";
import { humanizeModelId, probeAcpCapabilities } from "../acp";
import {
  buildAgentCommand,
  envVarAuthProbe,
  type DetectionSpec,
} from "../base";
import { buildContextSizeCapabilities } from "../contextWindowLabel";
import { getAgentProbeCwd } from "../probeCwd";
import { GDS_AGENT_AGENT_SETTING_KEYS } from "./env";

/**
 * gdsAgent (gdsAgent) runs as an ACP subprocess (`gdsAgent.exe --acp`) and
 * exposes models, modes, approval policies, and permission requests through the
 * Agent Client Protocol. We do not declare any model list statically —
 * `capabilitiesProbe` fills `models`, `efforts`, `modes`, `approvalPolicies`,
 * etc. at detection time from the real agent response. `gdsAgent-sonnet-4.5` is a
 * best-effort placeholder for one-shot generation when capabilities have not
 * been probed yet (the live capabilities override it after the first detection
 * pass).
 */
export const defaultGdsAgentCapabilities: AgentCapability = {
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
 * Treat an API key saved in the gdsAgent settings panel as authenticated.
 *
 * The panel writes `agentSettings.gds-agent.apiKey`, which launch forwards as
 * `ANTHROPIC_AUTH_TOKEN`; a user who configured a gateway there is signed in
 * for every practical purpose even though `process.env.ANTHROPIC_AUTH_TOKEN`
 * is unset in the supervisor. This probe runs before the env heuristic so a
 * panel-configured credential is not reported as "missing" (which would block
 * the composer with a spurious sign-in prompt).
 */
export const gdsAgentSettingsAuthProbe = async (ctx: {
  agentSettings?: Record<string, boolean | string>;
}): Promise<"authenticated" | undefined> => {
  const apiKey = ctx.agentSettings?.[GDS_AGENT_AGENT_SETTING_KEYS.apiKey];
  return typeof apiKey === "string" && apiKey.trim().length > 0 ? "authenticated" : undefined;
};

type GdsAgentModelOption = {
  id: string;
  label: string;
  description?: string;
  tooltipDescription?: string;
};

/**
 * The model the user configured in the panel, shaped as a capability entry.
 *
 * cc-haha only advertises models over ACP after an authenticated `newSession`,
 * and that catalog never contains a free-form id the user typed for a custom
 * gateway. Surface the configured model as a selectable entry regardless of
 * what the probe returned — it is the exact id launch forwards via
 * `ANTHROPIC_MODEL`, so the composer must be able to select it.
 */
export function configuredGdsAgentModels(
  agentSettings: Record<string, boolean | string> | undefined,
): GdsAgentModelOption[] {
  const model = agentSettings?.[GDS_AGENT_AGENT_SETTING_KEYS.model];
  if (typeof model !== "string" || model.trim().length === 0) return [];
  const id = model.trim();
  return [{ id, label: humanizeGdsAgentModelId(id) }];
}

/**
 * Put the panel-configured model at the front of the detected catalog, keeping
 * the probe's richer entry when both name the same id. Without this the user's
 * custom model is selectable in Settings but invisible in the composer.
 */
export function mergeGdsAgentModels(
  configured: GdsAgentModelOption[],
  probed: GdsAgentModelOption[] | undefined,
): GdsAgentModelOption[] {
  const detected = probed ?? [];
  if (configured.length === 0) return detected;
  const detectedIds = new Set(detected.map((model) => model.id));
  return [...configured.filter((model) => !detectedIds.has(model.id)), ...detected];
}

/**
 * Whether the panel points gdsAgent at a specific endpoint rather than its
 * own account. A key or a base URL means the user brought their own
 * Anthropic-compatible provider, so the models cc-haha advertises for its own
 * account are irrelevant — only the model id the user typed is valid there.
 */
export function hasCustomGdsAgentEndpoint(
  agentSettings: Record<string, boolean | string> | undefined,
): boolean {
  const key = agentSettings?.[GDS_AGENT_AGENT_SETTING_KEYS.apiKey];
  const baseUrl = agentSettings?.[GDS_AGENT_AGENT_SETTING_KEYS.baseUrl];
  return (
    (typeof key === "string" && key.trim().length > 0) ||
    (typeof baseUrl === "string" && baseUrl.trim().length > 0)
  );
}

/**
 * The composer's model list for gdsAgent.
 *
 * When the panel is configured for a custom endpoint, expose ONLY the model
 * the user typed: the probed catalog belongs to cc-haha's own account (e.g.
 * `gdsAgent-sonnet-4.5`) and none of it is reachable through the user's gateway.
 * With no custom endpoint, keep the merge so a configured model id — and the
 * probe's richer entry for it — still surface.
 */
export function gdsAgentComposerModels(
  agentSettings: Record<string, boolean | string> | undefined,
  probed: GdsAgentModelOption[] | undefined,
): GdsAgentModelOption[] {
  const configured = configuredGdsAgentModels(agentSettings);
  if (hasCustomGdsAgentEndpoint(agentSettings)) return configured;
  return mergeGdsAgentModels(configured, probed);
}

/**
 * Humanize gdsAgent's model ids. cc-haha emits ids that already include a
 * vendor prefix (e.g. `anthropic/gdsAgent-sonnet-4.5`), so we drop the
 * `anthropic/` segment and title-case the rest.
 */
export function humanizeGdsAgentModelId(id: string): string {
  return humanizeModelId(id.replace(/^anthropic\//, ""));
}

export const gdsAgentDetectionSpec: DetectionSpec = {
  kind: "gds-agent",
  label: "gdsAgent",
  binary: "gdsAgent",
  capabilities: defaultGdsAgentCapabilities,
  // No `statusProbe` — the only auth signal we can read without a protocol
  // round-trip is a panel-configured key or `ANTHROPIC_AUTH_TOKEN` env. The
  // detection engine overwrites the auth state with the protocol-derived value
  // when the capabilities probe succeeds, which is the source of truth.
  authProbes: [gdsAgentSettingsAuthProbe, envVarAuthProbe(["ANTHROPIC_AUTH_TOKEN"])],
  async capabilitiesProbe(ctx) {
    if (!ctx.executablePath) return undefined;
    // The endpoint, credential, and model reach the probe through
    // `ctx.probeEnv`, which `detectAgentInstall` merges from the adapter's
    // `baseSpawnEnv` (the `ANTHROPIC_*` trio). Without them cc-haha's
    // `newSession` returns `auth_required` and detection would report
    // "missing" with no models even though the user configured a working
    // provider.
    const probeArgs = ["--acp"];
    const probeEnv = ctx.probeEnv;
    const probeCmd =
      ctx.location.kind === "wsl"
        ? buildAgentCommand(ctx.location, "gdsAgent", probeArgs, ctx.executablePath, probeEnv)
        : buildAgentCommand(ctx.location, ctx.executablePath, probeArgs, undefined, probeEnv);
    const probeCwd = ctx.location.kind === "wsl" ? "/tmp" : getAgentProbeCwd(ctx.location);
    const probeResult = await probeAcpCapabilities(probeCmd.command, probeCmd.args, probeCwd, {
      timeoutMs: 15_000,
      modelLabel: humanizeGdsAgentModelId,
      ...(probeCmd.env ? { env: probeCmd.env } : {}),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
      label: `gds-agent:${ctx.location.kind}`,
    });

    if (!probeResult) {
      const fallbackModels = configuredGdsAgentModels(ctx.agentSettings);
      return fallbackModels.length ? { models: fallbackModels } : undefined;
    }

    const models = gdsAgentComposerModels(ctx.agentSettings, probeResult.models);
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
