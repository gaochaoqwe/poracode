import type { ToolCallPayload } from "@/shared/contracts";

/** §8.8 carrying-artifact token shapes, mapped from real tool names. */
export type ToolToken = "paper" | "terminal" | "globe" | "magnifier" | "diamond" | "checklist";

export function toolTokenForToolName(name: string | undefined): ToolToken | undefined {
  if (!name) return undefined;
  if (name.startsWith("mcp__")) return "diamond";
  switch (name) {
    case "Read":
    case "Edit":
    case "Write":
      return "paper";
    case "Bash":
      return "terminal";
    case "WebFetch":
    case "WebSearch":
    case "WebSearchTool":
      return "globe";
    case "Grep":
    case "Glob":
      return "magnifier";
    case "TodoWrite":
      return "checklist";
    default:
      return undefined;
  }
}

export interface ThreadLikeItems {
  /** Ordered item ids, newest last. */
  itemIds: readonly string[];
  /** O(1) item lookup. */
  items: Record<string, { payload?: unknown } | undefined>;
}

/**
 * Latest in-flight tool call of a thread (for the station token + AgentCard
 * "current action" line). Falls back to the most recent completed tool.
 */
export function latestRunningToolName(thread: ThreadLikeItems): string | undefined {
  let latestDone: string | undefined;
  for (const itemId of thread.itemIds) {
    const item = thread.items[itemId];
    const payload = item?.payload as Partial<ToolCallPayload> | undefined;
    if (!payload || typeof payload.name !== "string") continue;
    if (payload.status === "running") {
      return payload.name;
    }
    latestDone = payload.name;
  }
  return latestDone;
}
