import type { AgentCapability, AgentTerminalAuthMethod } from "@/shared/contracts";
import { humanizeModelId, probeAcpCapabilities } from "../acp";
import {
  batchWslCommandsAsync,
  buildAgentCommand,
  envVarAuthProbe,
  type DetectionSpec,
} from "../base";
import { buildContextSizeCapabilities } from "../contextWindowLabel";
import { getAgentProbeCwd } from "../probeCwd";
import { CLINE_AUTO_APPROVE_CONFIG_OPTION_ID } from "./autoApprove";
import { CLINE_AGENT_SETTING_KEYS } from "./env";

// Cline runs as an ACP subprocess (`cline --acp`) and exposes models, modes,
// approval policies, and permission requests through the Agent Client
// Protocol. We do not declare any model list statically — `capabilitiesProbe`
// fills `models`, `efforts`, `modes`, `approvalPolicies`, etc. at detection
// time from the real agent response. `gdsAgent-sonnet-4.5` is a best-effort
// placeholder for one-shot generation when capabilities have not been probed
// yet (the live capabilities override it after the first detection pass).
export const defaultClineCapabilities: AgentCapability = {
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

// Cline stores its credentials and config under `~/.cline` after `cline auth`.
// Treat the directory's presence as "authenticated" so the Settings UI shows
// the right state before the ACP probe reports a definitive auth signal.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const configDirAuthProbe = async (ctx: {
  location: { kind: string; distro?: string };
  signal?: AbortSignal;
}) => {
  if (ctx.location.kind === "wsl") {
    const [result] = await batchWslCommandsAsync(
      // The probe context guarantees `distro` is set when kind === "wsl".
      ctx.location.distro as string,
      ["test -d ~/.cline && echo yes"],
      ctx.signal,
    );
    return result?.ok && result.stdout.trim() === "yes" ? "authenticated" : "missing";
  }
  return existsSync(join(homedir(), ".cline")) ? "authenticated" : "missing";
};

/**
 * Treat an API key saved in the Cline settings panel as authenticated.
 *
 * The panel writes `agentSettings.cline.apiKey`, which launch forwards as
 * `CLINE_API_KEY`; a user who configured a gateway there is signed in for
 * every practical purpose even though neither `process.env.CLINE_API_KEY`
 * nor `~/.cline` exists. This probe runs before the env/config-dir
 * heuristics so a panel-configured credential is not reported as "missing"
 * (which would block the composer with a spurious sign-in prompt).
 */
export const clineSettingsAuthProbe = async (ctx: {
  agentSettings?: Record<string, boolean | string>;
}): Promise<"authenticated" | undefined> => {
  const apiKey = ctx.agentSettings?.[CLINE_AGENT_SETTING_KEYS.apiKey];
  return typeof apiKey === "string" && apiKey.trim().length > 0 ? "authenticated" : undefined;
};

type ClineModelOption = {
  id: string;
  label: string;
  description?: string;
  tooltipDescription?: string;
};

/**
 * The model the user configured in the panel, shaped as a capability entry.
 *
 * Cline only advertises models over ACP after an authenticated `newSession`,
 * and that catalog never contains a free-form id the user typed for a custom
 * gateway. Surface the configured model as a selectable entry regardless of
 * what the probe returned — it is the exact id launch forwards via
 * `CLINE_MODEL`, so the composer must be able to select it.
 */
export function configuredClineModels(
  agentSettings: Record<string, boolean | string> | undefined,
): ClineModelOption[] {
  const model = agentSettings?.[CLINE_AGENT_SETTING_KEYS.model];
  if (typeof model !== "string" || model.trim().length === 0) return [];
  const id = model.trim();
  return [{ id, label: humanizeClineModelId(id) }];
}

/**
 * Put the panel-configured model at the front of the detected catalog, keeping
 * the probe's richer entry when both name the same id. Without this the user's
 * custom model is selectable in Settings but invisible in the composer, whose
 * list is built solely from detected `capabilities.models`.
 */
export function mergeClineModels(
  configured: ClineModelOption[],
  probed: ClineModelOption[] | undefined,
): ClineModelOption[] {
  const detected = probed ?? [];
  if (configured.length === 0) return detected;
  const detectedIds = new Set(detected.map((model) => model.id));
  return [...configured.filter((model) => !detectedIds.has(model.id)), ...detected];
}

/**
 * Whether the panel points Cline at a specific endpoint rather than its own
 * account. A key or a base URL means the user brought their own
 * OpenAI-compatible provider, so the models Cline advertises for its own
 * account are irrelevant — only the model id the user typed is valid there.
 */
export function hasCustomClineEndpoint(
  agentSettings: Record<string, boolean | string> | undefined,
): boolean {
  const key = agentSettings?.[CLINE_AGENT_SETTING_KEYS.apiKey];
  const baseUrl = agentSettings?.[CLINE_AGENT_SETTING_KEYS.baseUrl];
  return (
    (typeof key === "string" && key.trim().length > 0) ||
    (typeof baseUrl === "string" && baseUrl.trim().length > 0)
  );
}

/**
 * The composer's model list for Cline.
 *
 * When the panel is configured for a custom endpoint, expose ONLY the model
 * the user typed: the probed catalog belongs to Cline's own account (e.g.
 * `anthropic/gdsAgent-sonnet-4.5`) and none of it is reachable through the
 * user's gateway, so listing it would offer models the endpoint cannot serve.
 * With no custom endpoint, keep the merge so a configured model id — and the
 * probe's richer entry for it — still surface.
 */
export function clineComposerModels(
  agentSettings: Record<string, boolean | string> | undefined,
  probed: ClineModelOption[] | undefined,
): ClineModelOption[] {
  const configured = configuredClineModels(agentSettings);
  if (hasCustomClineEndpoint(agentSettings)) return configured;
  return mergeClineModels(configured, probed);
}

/**
 * Humanize Cline's model ids. Cline typically emits ids that already include
 * a vendor prefix (e.g. `anthropic/gdsAgent-sonnet-4.5`), so we drop the
 * `anthropic/` segment and title-case the rest — same approach Gemini uses.
 */
export function humanizeClineModelId(id: string): string {
  return humanizeModelId(id.replace(/^anthropic\//, "").replace(/^openai\//, "openai "));
}

export const clineDetectionSpec: DetectionSpec = {
  kind: "cline",
  label: "Cline",
  binary: "cline",
  loginCommand: "cline auth",
  capabilities: defaultClineCapabilities,
  update: {
    // Cline ships on npm as `cline`; it also exposes a `cline update`
    // self-updater, so we surface both for the registry card.
    npm: "cline",
    builtIn: { binary: "cline", args: ["update"] },
  },
  // No `statusProbe` — Cline's only auth signal we can read without a
  // protocol round-trip is the `~/.cline` config dir (handled by
  // `configDirAuthProbe` below). The detection engine overwrites the auth
  // state with the protocol-derived value when the capabilities probe
  // succeeds, which is the source of truth.
  authProbes: [clineSettingsAuthProbe, envVarAuthProbe(["CLINE_API_KEY"]), configDirAuthProbe],
  async capabilitiesProbe(ctx) {
    if (!ctx.executablePath) return undefined;
    // The endpoint, credential, and provider id reach the probe through
    // `ctx.probeEnv`, which `detectAgentInstall` merges from the adapter's
    // `baseSpawnEnv` (the `CLINE_*` trio plus `CLINE_PROVIDER_SETTINGS_PATH`).
    // Without them Cline's `newSession` returns `auth_required` and detection
    // would report "missing" with no models even though the user configured a
    // working provider.
    const probeArgs = ["--acp"];
    const probeEnv = ctx.probeEnv;
    const probeCmd =
      ctx.location.kind === "wsl"
        ? buildAgentCommand(ctx.location, "cline", probeArgs, ctx.executablePath, probeEnv)
        : buildAgentCommand(ctx.location, ctx.executablePath, probeArgs, undefined, probeEnv);
    const probeCwd = ctx.location.kind === "wsl" ? "/tmp" : getAgentProbeCwd(ctx.location);
    const probeResult = await probeAcpCapabilities(probeCmd.command, probeCmd.args, probeCwd, {
      timeoutMs: 15_000,
      modelLabel: humanizeClineModelId,
      // Surface Cline's real auto-approval switch as a full-bypass policy —
      // its `allow_always` permission option is a no-op (see ./autoApprove.ts).
      autoApproveConfigOptionId: CLINE_AUTO_APPROVE_CONFIG_OPTION_ID,
      ...(probeCmd.env ? { env: probeCmd.env } : {}),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
      label:
        ctx.location.kind === "wsl"
          ? `cline:wsl:${ctx.location.distro}`
          : `cline:${ctx.location.kind}`,
    });

    // Cline's interactive `cline auth` flow cannot run over ACP `authenticate`
    // without breaking the protocol stream, so synthesize one terminal auth
    // method that opens Cline's own login flow. Same pattern as Gemini.
    const terminalAuthMethod: AgentTerminalAuthMethod = {
      id: "cline-terminal-login",
      name: "Login",
      type: "terminal",
    };

    if (!probeResult) {
      const fallbackModels = configuredClineModels(ctx.agentSettings);
      return {
        authMethods: [terminalAuthMethod],
        preferTerminalLogin: true,
        ...(fallbackModels.length ? { models: fallbackModels } : {}),
      };
    }

    const models = clineComposerModels(ctx.agentSettings, probeResult.models);
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
      authMethods: [terminalAuthMethod],
      preferTerminalLogin: true,
      ...(probeResult.authLogoutSupported ? { authLogoutSupported: true } : {}),
      ...(probeResult.authState ? { authState: probeResult.authState } : {}),
    };
  },
};