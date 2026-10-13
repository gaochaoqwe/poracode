/**
 * The dsh (DeepSeek Harness) ACP profile returns resume errors as structured
 * JSON-RPC errors rather than plain stderr text. Keep a conservative regex here
 * so the shared runtime has *something* to call when scanning terminal
 * scrollback — terminal launches are not dsh's primary path, but a stray
 * "Session not found" line should still be classified as an invalid session ref
 * so the renderer can prompt the user to start a new conversation rather than
 * silently retrying.
 */
const INVALID_SESSION_RE = /Session\s+not\s+found|invalid\s+session\s+id/i;

export function detectDshAgentInvalidSessionRef(output: string): boolean {
  return INVALID_SESSION_RE.test(output);
}
