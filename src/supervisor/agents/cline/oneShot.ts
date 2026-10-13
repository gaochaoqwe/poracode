/**
 * Cline's `--json` one-shot lane: argv shape and NDJSON result parsing.
 *
 * Cline's CLI has two one-shot output modes:
 *
 * - default (styled): an OpenTUI-rendered stream. Even piped, its first line is
 *   the model's reasoning preamble wrapped in ANSI escapes
 *   (`\x1b[2m[thinking] …`), which is why parsing it as the answer produced
 *   garbled thread titles.
 * - `--json`: one JSON object per line (NDJSON). Progress events stream as
 *   `agent_event`s and the finished turn ends with a `run_result` whose `text`
 *   is the complete assistant message.
 *
 * This module owns Cline's slice of that format so no shared runtime file grows
 * a Cline branch. The adapter pairs {@link buildClineOneShotArgs} with
 * {@link parseClineOneShotOutput} behind `runOneShot`.
 */

/** Hard ceiling for a one-shot spawn; the caller's `AbortSignal` usually wins. */
export const CLINE_ONE_SHOT_TIMEOUT_MS = 120_000;

/**
 * Build the argv for a Cline one-shot.
 *
 * Usage is `cline [options] [command] [prompt]`, so the flags precede the
 * positional prompt and the prompt stays LAST (a bare single-token positional
 * is rejected as "Unknown command or unquoted prompt"). The provider, key, and
 * endpoint ride `baseSpawnEnv` (`CLINE_*`), so only `--json` and the optional
 * model are stated here.
 */
export function buildClineOneShotArgs(model: string | undefined, prompt: string): string[] {
  const args = ["--json"];
  const trimmedModel = model?.trim();
  if (trimmedModel) args.push("-m", trimmedModel);
  args.push(prompt);
  return args;
}

/** Outcome of parsing a Cline one-shot's NDJSON stream. */
export interface ClineOneShotResult {
  /** The assistant's answer, when the run produced one. */
  text?: string;
  /** The CLI's own error message, when the run reported one. */
  error?: string;
}

interface ClineNdjsonEvent {
  type?: unknown;
  message?: unknown;
  text?: unknown;
  event?: {
    type?: unknown;
    contentType?: unknown;
    text?: unknown;
  };
}

/**
 * Extract the assistant's answer from a Cline `--json` stream.
 *
 * Prefers the terminal `run_result.text`; falls back to the `done` event's
 * accumulated `text` and then the last text `content_end`. Non-JSON lines
 * (shell banners, partial writes) are skipped, so this is safe on output that
 * still carries login-shell noise. A CLI-reported `error` event is surfaced
 * when no answer was produced.
 */
export function parseClineOneShotOutput(raw: string): ClineOneShotResult {
  let runResultText: string | undefined;
  let doneText: string | undefined;
  let contentEndText: string | undefined;
  let error: string | undefined;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: ClineNdjsonEvent;
    try {
      parsed = JSON.parse(trimmed) as ClineNdjsonEvent;
    } catch {
      continue;
    }

    if (parsed.type === "error" && typeof parsed.message === "string") {
      error = parsed.message;
      continue;
    }
    if (parsed.type === "run_result" && typeof parsed.text === "string") {
      runResultText = parsed.text;
      continue;
    }

    const event = parsed.event;
    if (!event) continue;
    if (event.type === "done" && typeof event.text === "string") {
      doneText = event.text;
    } else if (
      event.type === "content_end" &&
      event.contentType === "text" &&
      typeof event.text === "string"
    ) {
      contentEndText = event.text;
    }
  }

  // Match the CLI-path contract (`spawnAgent` returns trimmed output): an
  // all-whitespace answer is no answer.
  const text = (runResultText ?? doneText ?? contentEndText)?.trim();
  return {
    ...(text ? { text } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}
