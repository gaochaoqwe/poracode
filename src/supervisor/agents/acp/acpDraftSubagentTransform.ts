/**
 * Generic ACP draft (#1992) subagent + async-task normalization.
 *
 * Some ACP agents — notably ACP-registry harnesses like `gdsAgent` (a bridge
 * over the cc-haha gdsAgent agent) — surface their subagents in two ways at
 * once:
 *
 *  1. As ordinary `tool_call`/`tool_call_update` notifications whose tool name
 *     is the provider's native spawn tool (`Agent` / `Task` for gdsAgent),
 *     with `rawInput` carrying the raw launch parameters (`description`,
 *     `prompt`, …) and no `_toolName`/`subagent_type` marker.
 *  2. As ACP-draft session extensions — `subagent_spawned`,
 *     `subagent_state_update` and the `async_task_*` family — which the shared
 *     canonical mapper does not understand (it only knows tool calls, goals and
 *     standard updates).
 *
 * The shared mapper recognises a subagent only when a tool call's canonical
 * `rawInput` carries `_toolName: "task"` plus `subagent_type` (see
 * `canonicalMapping/subagents.isAcpSubAgentToolCall`), and background work only
 * when that subagent tool call is `background: true`. This transform closes the
 * gap by rewriting the provider-native wire shapes into the canonical form the
 * mapper already consumes, without leaking any provider-specific checks into
 * the shared mapper.
 *
 * Strategy (mirrors `agents/grok/acpTransform.ts`, but for the ACP-draft shape):
 *  - The `Agent`/`Task` tool call is the source of truth. On first sight it is
 *    normalised in place (it streams before `subagent_spawned`, and a
 *    notification cannot be recalled once rendered) — so it is detected by tool
 *    name, which is reliable for the draft agents, and marked background +
 *    detached because ACP runs each subagent as a separate session.
 *  - `subagent_spawned` only correlates the subagent session id back to that
 *    tool call and registers the background launch; it does not emit a second
 *    tool call (avoiding a duplicate subagent item).
 *  - `subagent_state_update` drives the tool call's terminal state.
 *  - Unknown draft extension updates are folded into a harmless
 *    `session_info_update` so the mapper never sees an update type it cannot
 *    dispatch.
 */

import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { AcpSessionUpdateTransform } from "../base";
import {
  buildCanonicalAcpSubagentInput,
  createAcpSubagentCoordinator,
  normalizeAcpSubagentToolCall,
  withAcpSubagentParent,
  withAcpTopLevelToolCall,
} from "./subagentCoordinator";

/** The draft agents' native subagent spawn tools (gdsAgent's `Agent`/`Task`). */
const DRAFT_SPAWN_TOOL_NAMES = new Set(["Agent", "Task"]);

export function createAcpDraftSubagentSessionUpdateTransform(): AcpSessionUpdateTransform {
  const subagents = createAcpSubagentCoordinator();
  const pendingToolCallIds: string[] = [];
  const toolCallIdBySubagentSession = new Map<string, string>();
  const subagentSessionByToolCallId = new Map<string, string>();
  let parentSessionId: string | undefined;

  return (notification) => {
    const update = plainRecord(notification.update);
    const sessionUpdate = readString(update, "sessionUpdate");
    const toolCallId = readString(update, "toolCallId");

    // 1) Native spawn tool call → canonical subagent tool call.
    if (
      toolCallId &&
      (sessionUpdate === "tool_call" || sessionUpdate === "tool_call_update")
    ) {
      const title = readString(update, "title");
      const isSpawn =
        (title !== undefined && DRAFT_SPAWN_TOOL_NAMES.has(title)) ||
        subagents.getCall(toolCallId) !== undefined;
      if (isSpawn) {
        parentSessionId ??= notification.sessionId;
        const rawInput = plainRecord(update.rawInput);
        // ACP runs each subagent as a separate session, so treat the spawn as
        // detached background work. Honour an explicit background flag from the
        // provider when present.
        const descriptor = subagents.updateCall(toolCallId, {
          rawInput,
          background:
            rawInput.background === true ||
            rawInput.run_in_background === true ||
            true,
        });
        if (!pendingToolCallIds.includes(toolCallId)) pendingToolCallIds.push(toolCallId);
        const normalized = normalizeAcpSubagentToolCall(notification, {
          rawInput: buildCanonicalAcpSubagentInput(descriptor),
          detached: descriptor.background,
          keepOpen: descriptor.background,
        });
        if (sessionUpdate !== "tool_call") return normalized;
        return withAcpTopLevelToolCall(normalized);
      }
    }

    // 2) subagent_spawned → correlate the subagent session back to the launch
    //    tool call and register the background launch.
    if (sessionUpdate === "subagent_spawned") {
      parentSessionId ??= notification.sessionId;
      const subagentSessionId = readString(update, "subagentSessionId");
      if (subagentSessionId) {
        const matched = findPendingToolCallId(
          pendingToolCallIds,
          subagents,
          readString(update, "task") ?? readString(update, "name"),
        );
        if (matched) {
          toolCallIdBySubagentSession.set(subagentSessionId, matched);
          subagentSessionByToolCallId.set(matched, subagentSessionId);
          subagents.registerBackgroundLaunch({
            sessionId: parentSessionId,
            toolCallId: matched,
            taskId: subagentSessionId,
          });
        }
      }
      return asNoop(notification);
    }

    // 3) subagent_state_update → drive the tool call's terminal state.
    if (sessionUpdate === "subagent_state_update") {
      const subagentSessionId = readString(update, "subagentSessionId");
      const mappedToolCallId = subagentSessionId
        ? toolCallIdBySubagentSession.get(subagentSessionId)
        : undefined;
      if (mappedToolCallId) {
        const state = readString(update, "state");
        const status =
          state === "failed" || state === "cancelled" ? state : "completed";
        const completed = subagents.complete({
          sessionId: parentSessionId ?? notification.sessionId,
          toolCallId: mappedToolCallId,
          status,
        });
        if (completed.length > 0) return completed[completed.length - 1]!;
      }
      return asNoop(notification);
    }

    // 4) Re-parent notifications that arrive under a subagent session id back
    //    to their launch tool call.
    const parentToolCallId = subagentSessionByToolCallId.get(notification.sessionId);
    if (parentToolCallId) return withAcpSubagentParent(notification, parentToolCallId);

    return notification;
  };
}

function findPendingToolCallId(
  pendingToolCallIds: string[],
  subagents: ReturnType<typeof createAcpSubagentCoordinator>,
  subject: string | undefined,
): string | undefined {
  const subjectText = subject?.trim();
  const matchingIndex = pendingToolCallIds.findIndex((toolCallId) => {
    const descriptor = subagents.getCall(toolCallId);
    if (!descriptor) return false;
    if (!subjectText) return true;
    const haystack = [descriptor.description, descriptor.prompt, descriptor.subagentType]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLowerCase();
    return haystack.includes(subjectText.toLowerCase());
  });
  const index = matchingIndex >= 0 ? matchingIndex : 0;
  if (pendingToolCallIds.length === 0) return undefined;
  return pendingToolCallIds.splice(index, 1)[0];
}

function asNoop(notification: SessionNotification): SessionNotification {
  return withUpdate(notification, { sessionUpdate: "session_info_update" });
}

function withUpdate(
  notification: SessionNotification,
  update: Record<string, unknown>,
): SessionNotification {
  return { ...notification, update: update as SessionNotification["update"] };
}

function plainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}
