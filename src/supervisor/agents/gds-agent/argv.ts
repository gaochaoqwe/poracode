import type { ThreadConfig } from "@/shared/contracts";

/**
 * Build the argv for a gdsAgent (gdsAgent) ACP launch or resume.
 *
 * The gdsAgent exe's ACP entry ignores argv entirely (it serves the Agent
 * Client Protocol over stdio from the moment it starts), so `--acp` is passed
 * only for parity with the other ACP adapters and is harmless. Session resume
 * is negotiated over the ACP protocol (`sessionCapabilities.resume`), not a
 * `--id` flag, so no session id rides the argv.
 *
 * The provider, model, and endpoint do NOT ride the argv — cc-haha resolves
 * them from its launch env (`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` /
 * `ANTHROPIC_MODEL`), which the adapter supplies via `baseSpawnEnv`. Per-thread
 * model and mode changes are negotiated over the ACP `configOptions` channel
 * after `initialize`.
 */
export function buildGdsAgentArgs(
  config: ThreadConfig,
  prompt: string,
  resumeSessionId?: string,
): string[] {
  void config;
  void prompt;
  void resumeSessionId;

  return ["--acp"];
}
