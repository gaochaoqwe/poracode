/**
 * dshAgent (DeepSeek Harness) one-shot lane: argv shape and output parsing.
 *
 * `dshAgent.exe` is an ACP server by default, so a one-shot must switch it into
 * headless mode via the `DSH_AGENT_MODE=headless` env (our launcher then spawns
 * `dsh --profile headless <prompt>`). The prompt rides as a single positional
 * argument; the model rides the same `DSH_MODEL` env the ACP session uses.
 *
 * dsh's headless profile prints the final assistant message as plain text on
 * stdout, so {@link parseDshAgentOneShotOutput} strips ANSI escapes and returns
 * the trimmed text — the shared runtime's `spawnAgent` contract.
 */

/** Hard ceiling for a one-shot spawn; the caller's `AbortSignal` usually wins. */
export const DSH_AGENT_ONE_SHOT_TIMEOUT_MS = 120_000;

/** The env switch that routes `dshAgent.exe` to its headless CLI. */
export const DSH_BACKEND_ENV_KEY = "DSH_AGENT_MODE";
/** The value of `DSH_AGENT_MODE` that selects `dsh --profile headless`. */
export const DSH_HEADLESS_MODE_VALUE = "headless";

/**
 * Build the argv for a dshAgent one-shot.
 *
 * `dsh --profile headless` takes the task as a single positional prompt, so the
 * whole prompt rides as one argument. The model is forwarded through `DSH_MODEL`
 * env (set by the adapter in `runOneShot`), not an argv flag.
 */
export function buildDshAgentOneShotArgs(model: string | undefined, prompt: string): string[] {
  void model;
  return [prompt];
}

/** Outcome of parsing a dshAgent one-shot's output. */
export interface DshAgentOneShotResult {
  /** The assistant's answer, when the run produced one. */
  text?: string;
  /** The CLI's own error message, when the run reported one. */
  error?: string;
}

const ANSI_ESCAPE_RE =
  // eslint-disable-next-line no-control-regex
  /\u001b\[[0-9;]*[A-Za-z]|\u001b\][0-9;]*\u0007|\u001b\]8;;[^\u0007]*\u0007/gu;

/**
 * Extract the assistant's answer from a dshAgent one-shot's output.
 *
 * The headless path prints the assistant message (occasionally wrapped in ANSI
 * styling / OSC hyperlinks), so strip those and trim. A non-empty trimmed
 * result is the answer; otherwise surface the raw output as an error so the
 * caller knows the run produced nothing parseable.
 */
export function parseDshAgentOneShotOutput(raw: string): DshAgentOneShotResult {
  const stripped = raw.replace(ANSI_ESCAPE_RE, "").trim();
  if (stripped.length > 0) {
    return { text: stripped };
  }
  const trimmed = raw.trim();
  return trimmed.length > 0
    ? { error: trimmed.slice(0, 200) }
    : { error: "dshAgent one-shot produced no output" };
}
