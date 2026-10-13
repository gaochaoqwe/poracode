import { describe, expect, it } from "vitest";
import type { Workspace } from "@/shared/contracts";
import { TeamTaskQueue, resolveMemberRoles, selectDispatchTargets } from "./teamOrchestrator";

function workspace(id: string, name: string, agentKind?: string): Workspace {
  return {
    id,
    name,
    createdAt: "2026-01-01T00:00:00.000Z",
    icon: "briefcase",
    ...(agentKind ? { agentKind } : {}),
  };
}

const WS = [
  workspace("w-doc", "文档编写岗", "codex"),
  workspace("w-code", "软件编码岗"),
  workspace("w-test", "软件测试岗"),
];

describe("resolveMemberRoles", () => {
  it("resolves valid member ids and drops unknown ones", () => {
    const members = resolveMemberRoles({ memberEmployeeIds: ["w-doc", "w-code", "gone"] }, WS);
    expect(members.map((m) => m.workspaceId)).toEqual(["w-doc", "w-code"]);
    expect(members[0]?.name).toBe("文档编写岗");
    expect(members[0]?.agentKind).toBe("codex");
  });

  it("returns empty for no valid members", () => {
    expect(resolveMemberRoles({ memberEmployeeIds: ["gone"] }, WS)).toEqual([]);
    expect(resolveMemberRoles({ memberEmployeeIds: [] }, WS)).toEqual([]);
  });
});

describe("selectDispatchTargets", () => {
  const members = resolveMemberRoles({ memberEmployeeIds: ["w-doc", "w-code", "w-test"] }, WS);

  it("round-robin rotates to members[0], [1], [2] as the cursor advances", () => {
    expect(
      selectDispatchTargets({ dispatchPolicy: "round-robin" }, members, 0).targets[0]?.workspaceId,
    ).toBe("w-doc");
    expect(
      selectDispatchTargets({ dispatchPolicy: "round-robin" }, members, 1).targets[0]?.workspaceId,
    ).toBe("w-code");
    expect(
      selectDispatchTargets({ dispatchPolicy: "round-robin" }, members, 3).targets[0]?.workspaceId,
    ).toBe("w-doc");
  });

  it("free-for-all returns every member", () => {
    const decision = selectDispatchTargets({ dispatchPolicy: "free-for-all" }, members, 0);
    expect(decision.targets.map((m) => m.workspaceId)).toEqual(["w-doc", "w-code", "w-test"]);
  });

  it("manager-assigns picks the manager role", () => {
    const decision = selectDispatchTargets(
      { dispatchPolicy: "manager-assigns", managerEmployeeId: "w-test" },
      members,
      0,
    );
    expect(decision.targets).toHaveLength(1);
    expect(decision.targets[0]?.workspaceId).toBe("w-test");
  });

  it("manager-assigns degrades to round-robin when the manager is not a member", () => {
    const decision = selectDispatchTargets(
      { dispatchPolicy: "manager-assigns", managerEmployeeId: "gone" },
      members,
      1,
    );
    expect(decision.targets).toHaveLength(1);
    expect(decision.targets[0]?.workspaceId).toBe("w-code");
  });

  it("returns no targets when the team has no valid members", () => {
    const decision = selectDispatchTargets({ dispatchPolicy: "free-for-all" }, [], 0);
    expect(decision.targets).toEqual([]);
  });
});

describe("TeamTaskQueue", () => {
  it("enqueues and dequeues in FIFO order", () => {
    const queue = new TeamTaskQueue();
    queue.enqueue({ id: "1", teamId: "t", prompt: "a", enqueuedAt: "1", forwardCount: 0 });
    queue.enqueue({ id: "2", teamId: "t", prompt: "b", enqueuedAt: "2", forwardCount: 0 });
    expect(queue.size).toBe(2);
    expect(queue.dequeue()?.id).toBe("1");
    expect(queue.dequeue()?.id).toBe("2");
    expect(queue.dequeue()).toBeUndefined();
  });

  it("filters pending tasks by team", () => {
    const queue = new TeamTaskQueue();
    queue.enqueue({ id: "1", teamId: "t1", prompt: "a", enqueuedAt: "1", forwardCount: 0 });
    queue.enqueue({ id: "2", teamId: "t2", prompt: "b", enqueuedAt: "2", forwardCount: 0 });
    expect(queue.pendingFor("t1")).toHaveLength(1);
    expect(queue.pendingFor("t2")).toHaveLength(1);
  });
});
