import type { ThreadConfig } from "@/shared/contracts";

/**
 * Build the argv for a dshAgent (DeepSeek Harness) ACP launch or resume.
 *
 * Our `dshAgent.exe` launcher decides its role from its own argv: with no args
 * it spawns `dsh --profile acp` (an ACP stdio server). So the argv here is
 * empty — the launcher serves the Agent Client Protocol over stdio from the
 * moment it starts. Session resume is negotiated over the ACP protocol
 * (`sessionCapabilities.resume`), not a `--id` flag, so no session id rides the
 * argv.
 *
 * The provider, model, and endpoint do NOT ride the argv — dsh resolves them
 * from its launch env (`DEEPSEEK_BASE_URL` / `DEEPSEEK_API_KEY` / `DSH_MODEL`),
 * which the adapter supplies via `baseSpawnEnv`. Per-thread model and mode
 * changes are negotiated over the ACP `configOptions` channel after
 * `initialize`.
 */
export function buildDshAgentArgs(
  config: ThreadConfig,
  prompt: string,
  resumeSessionId?: string,
): string[] {
  void config;
  void prompt;
  void resumeSessionId;

  return [];
}
