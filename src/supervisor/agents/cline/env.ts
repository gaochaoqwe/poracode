/**
 * Cline's settings-panel → launch-environment mapping.
 *
 * Kept in its own module because both the launch lane (`index.ts`) and the
 * detection lane (`detection.ts`) must translate the same panel values into the
 * same env vars. If they diverge, a credential configured in Settings would
 * reach the launched agent but not the capability probe — the probe would then
 * report `auth_required` and advertise no models even though the user can
 * actually run the agent.
 *
 * WHAT CLINE 3.x ACTUALLY READS (reverse-engineered from the 3.0.65 bun binary
 * and confirmed by driving `cline --acp` over stdio):
 *
 * - `CLINE_API_KEY` — a non-empty value is one of only two ways past Cline's
 *   ACP auth gate (`session/new` otherwise fails with
 *   `Authentication required: Call authenticate before starting a session`).
 *   The other way is a `cline`/`cline-pass`/`openai-codex` OAuth login, which a
 *   bring-your-own-key endpoint can never satisfy. `OPENAI_API_KEY` does NOT
 *   open the gate, despite being the key var the provider itself reads at
 *   inference time.
 * - `CLINE_PROVIDER` — `session/new` resolves the provider as
 *   `process.env.CLINE_PROVIDER ?? authResult?.providerId ?? "cline"`. With
 *   only the key set, `authResult` stays unset (the key short-circuits the
 *   gate), so the provider MUST be stated or the turn runs against Cline's own
 *   account and billing.
 * - `CLINE_MODEL` — the session's default model id.
 * - `CLINE_PROVIDER_SETTINGS_PATH` — where Cline reads `providers.json` (and
 *   its sibling `models.json`). The provider's base URL travels here, NOT in an
 *   env var: Cline has no env override for the LLM endpoint on this provider
 *   (`CLINE_BASE_URL` is unread; `CLINE_API_BASE_URL` is Cline's *account*
 *   service URL and must not be repurposed).
 */

/**
 * Keys the Cline settings panel writes into `agentSettings.cline.*`. Kept
 * here so the supervisor and the renderer agree on the exact spelling — a
 * divergence would silently leave the endpoint unconfigured.
 *
 * There is deliberately no `provider` key: the panel models a single
 * OpenAI-compatible endpoint, so the provider id is fixed to
 * {@link CLINE_OPENAI_COMPATIBLE_PROVIDER}. A leftover `provider` string from
 * an older panel build is ignored — it is neither read nor forwarded.
 */
export const CLINE_AGENT_SETTING_KEYS = {
  model: "model",
  apiKey: "apiKey",
  baseUrl: "baseUrl",
} as const;

/**
 * Cline's provider id for an arbitrary OpenAI-compatible endpoint — the
 * `CLINE_PROVIDER` value. This is the provider Cline labels **"OpenAI
 * Compatible"** (`id:"openai-compatible"`), NOT `openai-native` — that id is
 * labeled "OpenAI" and points at OpenAI's own API, so pinning it would send the
 * user's custom gateway key to OpenAI.
 */
export const CLINE_OPENAI_COMPATIBLE_PROVIDER = "openai-compatible";

/** The env vars Cline's CLI reads for a BYO OpenAI-compatible endpoint. */
export const CLINE_ENV = {
  apiKey: "CLINE_API_KEY",
  provider: "CLINE_PROVIDER",
  model: "CLINE_MODEL",
  settingsPath: "CLINE_PROVIDER_SETTINGS_PATH",
} as const;

function trimNonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Map the renderer's saved Cline settings onto the env Cline reads.
 *
 * Returns `undefined` when no API key is configured: without one Cline's ACP
 * auth gate cannot be opened by a BYO credential, so the launch must fall back
 * to whatever `cline auth` login Cline already holds rather than forcing a
 * half-filled endpoint onto it.
 *
 * `settingsPath` is the `CLINE_PROVIDER_SETTINGS_PATH` written by
 * {@link persistClineProviderConfig}; it carries the provider's base URL and
 * custom model, which have no env var of their own.
 */
export function resolveClineEnv(
  agentSettings: Record<string, boolean | string> | undefined,
  settingsPath?: string,
): Record<string, string> | undefined {
  const apiKey = trimNonEmpty(agentSettings?.[CLINE_AGENT_SETTING_KEYS.apiKey]);
  if (!apiKey) return undefined;

  const env: Record<string, string> = {
    [CLINE_ENV.apiKey]: apiKey,
    [CLINE_ENV.provider]: CLINE_OPENAI_COMPATIBLE_PROVIDER,
  };
  const model = trimNonEmpty(agentSettings?.[CLINE_AGENT_SETTING_KEYS.model]);
  if (model) env[CLINE_ENV.model] = model;
  if (settingsPath) env[CLINE_ENV.settingsPath] = settingsPath;
  return env;
}
