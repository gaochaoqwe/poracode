/**
 * gdsAgent (gdsAgent) settings-panel → launch-environment mapping.
 *
 * Kept in its own module because both the launch lane (`index.ts`) and the
 * detection lane (`detection.ts`) must translate the same panel values into the
 * same env vars. If they diverge, a credential configured in Settings would
 * reach the launched agent but not the capability probe — the probe would then
 * report `auth_required` and advertise no models even though the user can
 * actually run the agent.
 *
 * WHAT CC-HAHA GDSAGENT CODE ACTUALLY READS (verified by driving the bundled
 * gdsAgent backend over stdio):
 *
 * - `ANTHROPIC_AUTH_TOKEN` — a bearer credential for the endpoint named by
 *   `ANTHROPIC_BASE_URL`. With neither set, the agent falls back to its own
 *   `gdsAgent` login (which a bring-your-own-key endpoint can never satisfy).
 * - `ANTHROPIC_BASE_URL` — the LLM endpoint; absent, the agent uses
 *   Anthropic's hosted API.
 * - `ANTHROPIC_MODEL` — the default model id. (cc-haha also accepts
 *   `ANTHROPIC_SMALL_FAST_MODEL` for the background/haiku lane.)
 * - `GDS_AGENT_USE_OPENAI_CHAT_COMPLETIONS` — when set, the bundled agent
 *   translates its Anthropic-shaped requests to OpenAI
 *   `POST /chat/completions` in-process instead of calling `/v1/messages`. It
 *   reuses the base URL and bearer token above, so selecting the protocol adds
 *   no second set of credentials. Only set this for an endpoint that does *not*
 *   implement the Anthropic Messages API — in particular it must not be used
 *   for a gateway that merely lacks a `/anthropic` route, because a native
 *   Anthropic endpoint has strictly better fidelity (prompt caching, streaming
 *   tool deltas, extended thinking).
 *
 * Unlike Cline, cc-haha reads these directly as process env — there is no
 * `providers.json` indirection, so no AgentEmployee-owned config file is needed.
 * The ACP-mode exe inherits the merged env into its spawned backend process.
 */

/**
 * Keys the gdsAgent settings panel writes into
 * `agentSettings.gds-agent.*`. Kept here so the supervisor and the renderer
 * agree on the exact spelling — a divergence would silently leave the endpoint
 * unconfigured.
 */
export const GDS_AGENT_AGENT_SETTING_KEYS = {
  model: "model",
  apiKey: "apiKey",
  baseUrl: "baseUrl",
  protocol: "protocol",
} as const;

/**
 * Which wire protocol the configured endpoint speaks.
 *
 * cc-haha's native protocol is the Anthropic Messages API. Endpoints that only
 * implement OpenAI's `POST /v1/chat/completions` need the in-process translation
 * layer the bundled agent ships (`GDS_AGENT_USE_OPENAI_CHAT_COMPLETIONS`), which
 * is why this is a user-visible switch rather than something we can sniff: the
 * two are indistinguishable from the base URL alone.
 */
export const GDS_AGENT_PROTOCOLS = {
  /** Anthropic Messages API — the default, and what a bare endpoint assumes. */
  anthropicMessages: "anthropic-messages",
  /** OpenAI Chat Completions, translated in-process by the bundled agent. */
  openaiChatCompletions: "openai-chat-completions",
} as const;

export type GdsAgentProtocol = (typeof GDS_AGENT_PROTOCOLS)[keyof typeof GDS_AGENT_PROTOCOLS];

/** The env vars cc-haha gdsAgent reads for a BYO endpoint. */
export const GDS_AGENT_ENV = {
  apiKey: "ANTHROPIC_AUTH_TOKEN",
  baseUrl: "ANTHROPIC_BASE_URL",
  model: "ANTHROPIC_MODEL",
  protocol: "GDS_AGENT_USE_OPENAI_CHAT_COMPLETIONS",
} as const;

function trimNonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Read the configured protocol, defaulting to Anthropic Messages.
 *
 * An unrecognised value falls back to the default rather than throwing: a
 * settings file written by a newer build must not break an older supervisor.
 */
export function resolveGdsAgentProtocol(
  agentSettings: Record<string, boolean | string> | undefined,
): GdsAgentProtocol {
  const raw = trimNonEmpty(agentSettings?.[GDS_AGENT_AGENT_SETTING_KEYS.protocol]);
  return raw === GDS_AGENT_PROTOCOLS.openaiChatCompletions
    ? GDS_AGENT_PROTOCOLS.openaiChatCompletions
    : GDS_AGENT_PROTOCOLS.anthropicMessages;
}

/**
 * Map the renderer's saved gdsAgent settings onto the env the agent reads.
 *
 * Every configured field is forwarded verbatim; empty strings are dropped, so
 * an "unset" write leaves the agent on whatever `gdsAgent` login it already holds
 * for that channel. Returns `{}` when nothing is configured so the adapter's
 * `baseSpawnEnv` is always present.
 *
 * The endpoint, credential, and model always travel as the `ANTHROPIC_*` trio —
 * the bundled transport reads those as its fallback, so switching protocol never
 * requires re-entering them. Selecting the OpenAI protocol adds exactly one
 * variable on top: the flag that turns the in-process translation on.
 */
export function resolveGdsAgentEnv(
  agentSettings: Record<string, boolean | string> | undefined,
): Record<string, string> {
  const env: Record<string, string> = {};
  const apiKey = trimNonEmpty(agentSettings?.[GDS_AGENT_AGENT_SETTING_KEYS.apiKey]);
  if (apiKey) env[GDS_AGENT_ENV.apiKey] = apiKey;
  const baseUrl = trimNonEmpty(agentSettings?.[GDS_AGENT_AGENT_SETTING_KEYS.baseUrl]);
  if (baseUrl) env[GDS_AGENT_ENV.baseUrl] = baseUrl;
  const model = trimNonEmpty(agentSettings?.[GDS_AGENT_AGENT_SETTING_KEYS.model]);
  if (model) env[GDS_AGENT_ENV.model] = model;
  if (resolveGdsAgentProtocol(agentSettings) === GDS_AGENT_PROTOCOLS.openaiChatCompletions) {
    env[GDS_AGENT_ENV.protocol] = "1";
  }
  return env;
}
