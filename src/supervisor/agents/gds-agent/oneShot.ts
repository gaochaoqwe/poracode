/**
 * gdsAgent (gdsAgent) one-shot lane: argv shape and output parsing.
 *
 * The gdsAgent exe is an ACP server by default, so a one-shot must switch it
 * into backend mode (`RJB_GDSAGENT_BACKEND=1`) to reach the bundled cc-haha
 * gdsAgent CLI's non-interactive `-p`/`--print` path. The prompt rides as a
 * positional after the flags (`gdsAgent.exe -p <prompt>`, with `-m <model>`
 * when a model is pinned), and the endpoint/credential ride the same
 * `ANTHROPIC_*` env the ACP session uses.
 *
 * cc-haha's print path emits the assistant's final message as plain text (no
 * OpenTUI stream), so {@link parseGdsAgentOneShotOutput} strips ANSI escapes
 * and returns the trimmed text — the shared runtime's `spawnAgent` contract.
 */

/** Hard ceiling for a one-shot spawn; the caller's `AbortSignal` usually wins. */
export const GDS_AGENT_ONE_SHOT_TIMEOUT_MS = 120_000;

/** The env switch that routes the exe to its bundled gdsAgent CLI. */
export const RJB_BACKEND_ENV_KEY = "RJB_GDSAGENT_BACKEND";

/**
 * Build the argv for a gdsAgent one-shot.
 *
 * `-p` is the print/prompt flag (bare positional prompts are rejected as
 * unknown commands). Flags precede the positional prompt and the prompt stays
 * LAST.
 */
export function buildGdsAgentOneShotArgs(model: string | undefined, prompt: string): string[] {
  const args = ["-p"];
  const trimmedModel = model?.trim();
  if (trimmedModel) args.push("-m", trimmedModel);
  args.push(prompt);
  return args;
}

/** Outcome of parsing a gdsAgent one-shot's output. */
export interface GdsAgentOneShotResult {
  /** The assistant's answer, when the run produced one. */
  text?: string;
  /** The CLI's own error message, when the run reported one. */
  error?: string;
}

const ANSI_ESCAPE_RE =
  // eslint-disable-next-line no-control-regex
  /\u001b\[[0-9;]*[A-Za-z]|\u001b\][0-9;]*\u0007|\u001b\]8;;[^\u0007]*\u0007/gu;

/**
 * Extract the assistant's answer from a gdsAgent one-shot's output.
 *
 * The print path returns the assistant message (occasionally wrapped in ANSI
 * styling / OSC hyperlinks), so strip those and trim. A non-empty trimmed
 * result is the answer; otherwise surface the raw output as an error so the
 * caller knows the run produced nothing parseable.
 */
export function parseGdsAgentOneShotOutput(raw: string): GdsAgentOneShotResult {
  const stripped = raw.replace(ANSI_ESCAPE_RE, "").trim();
  if (stripped.length > 0) {
    return { text: stripped };
  }
  const trimmed = raw.trim();
  return trimmed.length > 0
    ? { error: trimmed.slice(0, 200) }
    : { error: "gdsAgent one-shot produced no output" };
}
