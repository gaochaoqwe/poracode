import type { ThreadConfig } from "@/shared/contracts";

/**
 * Build the argv for a Cline ACP launch or resume.
 *
 * Cline always speaks ACP over stdio, so the first flag is `--acp`. `--id <id>`
 * resumes a session by id (`--resume`/`--session-id` are not Cline flags — the
 * CLI rejects unknown options), and a fresh launch omits it: Cline allocates
 * its own session id over the protocol, which the shared runtime discovers
 * after `initialize` rather than pre-assigning.
 *
 * The provider, model, and endpoint do NOT ride the argv. Cline's ACP session
 * resolves them from its launch env (`CLINE_PROVIDER` / `CLINE_MODEL`) and its
 * `providers.json`, which the adapter supplies via `baseSpawnEnv` plus the
 * persisted config — see `env.ts` / `config.ts`. Per-thread model and mode
 * changes are negotiated over the ACP `configOptions` channel after
 * `initialize`, so `config.mode` / `config.approvalPolicy` / `config.model`
 * are deliberately not mapped to CLI flags.
 */
export function buildClineArgs(
  config: ThreadConfig,
  prompt: string,
  resumeSessionId?: string,
): string[] {
  void config;
  void prompt;

  const args: string[] = ["--acp"];
  if (resumeSessionId) {
    args.push("--id", resumeSessionId);
  }
  return args;
}
