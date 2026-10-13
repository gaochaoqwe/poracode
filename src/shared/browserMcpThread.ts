/**
 * Per-thread identity carried on the browser/chrome MCP endpoint URL as a query
 * (`?thread=<id>&title=<task>`). The supervisor encodes it per launch (all
 * providers connect by URL, so this is provider-agnostic — no header forwarding
 * needed); the main-process ingress decodes it per request to give each thread
 * its own tab group named by its task.
 */

export interface McpThreadIdentity {
  threadId?: string;
  title?: string;
  disabledTools?: readonly string[];
  /** Knowledge base id this thread is bound to (knowledge MCP only). */
  kb?: string;
}

const MAX_TITLE = 80;

/** Append `?thread=&title=` to an MCP endpoint URL (no-op without a threadId or kb). */
export function encodeThreadQuery(
  baseUrl: string,
  identity: McpThreadIdentity | undefined,
): string {
  if (!identity?.threadId && !identity?.kb) return baseUrl;
  const sep = baseUrl.includes("?") ? "&" : "?";
  const parts: string[] = [];
  if (identity?.threadId) parts.push(`thread=${encodeURIComponent(identity.threadId)}`);
  const title = identity?.title?.trim();
  if (title) parts.push(`title=${encodeURIComponent(title.slice(0, MAX_TITLE))}`);
  for (const tool of identity?.disabledTools ?? []) {
    parts.push(`disable=${encodeURIComponent(tool)}`);
  }
  if (identity?.kb) parts.push(`kb=${encodeURIComponent(identity.kb)}`);
  return `${baseUrl}${sep}${parts.join("&")}`;
}

/** Read the thread identity back out of a request URL (path + query). */
export function decodeThreadIdentity(url: string | undefined): McpThreadIdentity {
  if (!url) return {};
  try {
    const params = new URL(url, "http://x").searchParams;
    const threadId = params.get("thread") ?? undefined;
    const title = params.get("title") ?? undefined;
    const disabledTools = params.getAll("disable").filter(Boolean);
    const kb = params.get("kb") ?? undefined;
    return {
      ...(threadId ? { threadId } : {}),
      ...(title ? { title } : {}),
      ...(disabledTools.length > 0 ? { disabledTools } : {}),
      ...(kb ? { kb } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * Tab-group colors valid in BOTH the internal browser's group palette and
 * Chrome's `tabGroups` API (Chrome also offers grey/pink; we stay on the shared
 * subset so a thread keeps the same color across internal + external tabs).
 */
export const THREAD_GROUP_COLORS = [
  "blue",
  "green",
  "orange",
  "cyan",
  "red",
  "yellow",
  "purple",
] as const;
export type ThreadGroupColor = (typeof THREAD_GROUP_COLORS)[number];

/** Stable color for a thread's tab group, hashed from its id. */
export function threadGroupColor(threadId: string): ThreadGroupColor {
  let hash = 0;
  for (let i = 0; i < threadId.length; i++) {
    hash = (hash * 31 + threadId.charCodeAt(i)) >>> 0;
  }
  return THREAD_GROUP_COLORS[hash % THREAD_GROUP_COLORS.length]!;
}
