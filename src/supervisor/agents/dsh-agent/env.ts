/**
 * dshAgent (DeepSeek Harness) settings-panel → launch-environment mapping.
 *
 * Kept in its own module because both the launch lane (`index.ts`) and the
 * detection lane (`detection.ts`) must translate the same panel values into the
 * same env vars. If they diverge, a credential configured in Settings would
 * reach the launched agent but not the capability probe — the probe would then
 * report `auth_required` and advertise no models even though the user can
 * actually run the agent.
 *
 * WHAT THE DSH (DeepSeek Harness) ACP PROFILE ACTUALLY READS (verified by
 * driving the bundled `dshAgent.exe` over stdio):
 *
 * - `DEEPSEEK_API_KEY` — a bearer credential for the endpoint named by
 *   `DEEPSEEK_BASE_URL`. With neither set, dsh falls back to the profile's own
 *   `deepseek-official` provider login, which a bring-your-own-key endpoint can
 *   never satisfy.
 * - `DEEPSEEK_BASE_URL` — the OpenAI-compatible LLM endpoint (DeepSeek's own
 *   `https://api.deepseek.com` or any OpenAI-compatible gateway).
 * - `DSH_MODEL` — the default model id (e.g. `deepseek-v4-pro`).
 *
 * Unlike Cline there is no `providers.json` indirection — dsh reads these
 * directly as process env, so no AgentEmployee-owned config file is needed.
 * `dshAgent.exe` (our Bun launcher) forwards the merged env verbatim into the
 * spawned dsh backend process.
 */

/**
 * Keys the dshAgent settings panel writes into `agentSettings.dsh-agent.*`.
 * Kept here so the supervisor and the renderer agree on the exact spelling — a
 * divergence would silently leave the endpoint unconfigured.
 */
export const DSH_AGENT_AGENT_SETTING_KEYS = {
  model: "model",
  apiKey: "apiKey",
  baseUrl: "baseUrl",
  /** Path to the portable `dshAgent.exe` launcher (the bundle carries its
   *  node-runtime + node_modules beside it). Mirrors how gdsAgent is installed
   *  offline, except the portable bundle can't be reduced to a single copied
   *  exe, so we point at the launcher in place instead. */
  binaryPath: "binaryPath",
} as const;

/** The env vars the dsh ACP profile reads for a BYO OpenAI-compatible endpoint. */
export const DSH_AGENT_ENV = {
  apiKey: "DEEPSEEK_API_KEY",
  baseUrl: "DEEPSEEK_BASE_URL",
  model: "DSH_MODEL",
} as const;

function trimNonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Map the renderer's saved dshAgent settings onto the env the agent reads.
 *
 * Every configured field is forwarded verbatim; empty strings are dropped, so
 * an "unset" write leaves the agent on whatever login it already holds for that
 * channel. Returns `{}` when nothing is configured so the adapter's
 * `baseSpawnEnv` is always present.
 */
export function resolveDshAgentEnv(
  agentSettings: Record<string, boolean | string> | undefined,
): Record<string, string> {
  const env: Record<string, string> = {};
  const apiKey = trimNonEmpty(agentSettings?.[DSH_AGENT_AGENT_SETTING_KEYS.apiKey]);
  if (apiKey) env[DSH_AGENT_ENV.apiKey] = apiKey;
  const baseUrl = trimNonEmpty(agentSettings?.[DSH_AGENT_AGENT_SETTING_KEYS.baseUrl]);
  if (baseUrl) env[DSH_AGENT_ENV.baseUrl] = baseUrl;
  const model = trimNonEmpty(agentSettings?.[DSH_AGENT_AGENT_SETTING_KEYS.model]);
  if (model) env[DSH_AGENT_ENV.model] = model;
  return env;
}

/** Read the user's configured portable launcher path, if any. */
export function configuredDshAgentBinaryPath(
  agentSettings: Record<string, boolean | string> | undefined,
): string | undefined {
  return trimNonEmpty(agentSettings?.[DSH_AGENT_AGENT_SETTING_KEYS.binaryPath]);
}
