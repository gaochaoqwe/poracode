/**
 * Cline does not expose resume errors as plain stderr text the way Gemini
 * does; the protocol returns a structured JSON-RPC error instead. Keep a
 * conservative regex here so the shared runtime has *something* to call
 * when scanning terminal scrollback — terminal launches are not Cline's
 * primary path, but a stray "Session not found" line should still be
 * classified as an invalid session ref so the renderer can prompt the
 * user to start a new conversation rather than silently retrying.
 */
const INVALID_SESSION_RE = /Session\s+not\s+found|invalid\s+session\s+id/i;

export function detectClineInvalidSessionRef(output: string): boolean {
  return INVALID_SESSION_RE.test(output);
}