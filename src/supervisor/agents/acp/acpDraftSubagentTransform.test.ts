import type { SessionNotification } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { createAcpMapperState, mapAcpSessionUpdate } from "../acp/canonicalMapping";
import { createAcpDraftSubagentSessionUpdateTransform } from "./acpDraftSubagentTransform";

function makeNotification(sessionId: string, update: Record<string, unknown>): SessionNotification {
  return { sessionId, update } as unknown as SessionNotification;
}

function updateOf(notification: SessionNotification): Record<string, unknown> {
  return notification.update as unknown as Record<string, unknown>;
}

describe("createAcpDraftSubagentSessionUpdateTransform", () => {
  it("normalises a native Agent tool call into a canonical subagent tool call", () => {
    const transform = createAcpDraftSubagentSessionUpdateTransform();
    const state = createAcpMapperState("thread-1");

    const result = transform(
      makeNotification("parent", {
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        title: "Agent",
        rawInput: { description: "Build A", prompt: "Build A now" },
      }),
    );

    const update = updateOf(result);
    expect(update.sessionUpdate).toBe("tool_call");
    expect(update.rawInput).toMatchObject({
      _toolName: "task",
      subagent_type: "agent",
      description: "Build A",
      prompt: "Build A now",
      background: true,
    });
    // The mapped subagent item must surface as a running subagent.
    const events = mapAcpSessionUpdate(result, state);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item.started",
          payload: expect.objectContaining({ isSubAgent: true }),
        }),
      ]),
    );
  });

  it("normalises a native Task tool call and keeps it open as detached background work", () => {
    const transform = createAcpDraftSubagentSessionUpdateTransform();

    const result = transform(
      makeNotification("parent", {
        sessionUpdate: "tool_call",
        toolCallId: "call-2",
        title: "Task",
        rawInput: { description: "Review X", prompt: "Review X" },
      }),
    );

    const update = updateOf(result);
    expect(update.rawInput).toMatchObject({
      _toolName: "task",
      background: true,
    });
  });

  it("correlates subagent_spawned to the pending launch and completes on subagent_state_update", () => {
    const transform = createAcpDraftSubagentSessionUpdateTransform();
    const state = createAcpMapperState("thread-1");

    // 1) Native Agent launch tool call.
    const launched = transform(
      makeNotification("parent", {
        sessionUpdate: "tool_call",
        toolCallId: "call-3",
        title: "Agent",
        rawInput: { description: "Build B", prompt: "Build B now" },
      }),
    );
    mapAcpSessionUpdate(launched, state);

    // 2) subagent_spawned correlates the subagent session back to the launch
    //    without emitting a duplicate tool call.
    const spawned = transform(
      makeNotification("parent", {
        sessionUpdate: "subagent_spawned",
        subagentSessionId: "sub-b",
        name: "Build B",
        task: "Build B now",
        capabilities: {},
      }),
    );
    expect(updateOf(spawned).sessionUpdate).toBe("session_info_update");

    // 3) subagent_state_update drives the terminal state of the launch tool call.
    const finished = transform(
      makeNotification("parent", {
        sessionUpdate: "subagent_state_update",
        subagentSessionId: "sub-b",
        state: "completed",
      }),
    );
    const finishUpdate = updateOf(finished);
    expect(finishUpdate.sessionUpdate).toBe("tool_call_update");
    expect(finishUpdate.toolCallId).toBe("call-3");
    expect(finishUpdate.status).toBe("completed");
  });

  it("marks a failed subagent_state_update as failed", () => {
    const transform = createAcpDraftSubagentSessionUpdateTransform();
    transform(
      makeNotification("parent", {
        sessionUpdate: "tool_call",
        toolCallId: "call-4",
        title: "Agent",
        rawInput: { description: "Build C", prompt: "Build C now" },
      }),
    );
    transform(
      makeNotification("parent", {
        sessionUpdate: "subagent_spawned",
        subagentSessionId: "sub-c",
        name: "Build C",
        task: "Build C now",
        capabilities: {},
      }),
    );
    const finished = transform(
      makeNotification("parent", {
        sessionUpdate: "subagent_state_update",
        subagentSessionId: "sub-c",
        state: "failed",
      }),
    );
    const finishUpdate = updateOf(finished);
    expect(finishUpdate.status).toBe("failed");
  });

  it("passes through unrelated notifications untouched", () => {
    const transform = createAcpDraftSubagentSessionUpdateTransform();

    const result = transform(
      makeNotification("parent", {
        sessionUpdate: "tool_call",
        toolCallId: "call-5",
        title: "Edit",
        rawInput: { file_path: "/a/b.ts" },
      }),
    );

    const update = updateOf(result);
    expect(update.sessionUpdate).toBe("tool_call");
    expect(update.rawInput).toMatchObject({ file_path: "/a/b.ts" });
    // Not treated as a subagent.
    const rawInput = update.rawInput as Record<string, unknown> | undefined;
    expect(rawInput?._toolName).toBeUndefined();
  });
});
