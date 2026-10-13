import { describe, expect, it } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import { HOME_PROJECT_ID } from "@/shared/homeScope";

// Extract the pure aggregation helpers for testability without pulling in the
// whole dock component (which needs a renderer environment + stores).
import { aggregateRole, resolveRoleNavigation, threadWorkspaceId } from "./EmployeeDockBar";

function homeThread(id: string, workspaceId: string | undefined, status: Thread["status"]): Thread {
  return { id, projectId: HOME_PROJECT_ID, workspaceId, status, createdAt: "2026-01-01T00:00:00.000Z" } as Thread;
}

function projectThread(id: string, projectId: string, status: Thread["status"]): Thread {
  return { id, projectId, status, createdAt: "2026-01-01T00:00:00.000Z" } as Thread;
}

function project(id: string, workspaceId: string): Project {
  return { id, workspaceId } as Project;
}

const PROJECTS = [project("p1", "w2")];

describe("threadWorkspaceId", () => {
  it("uses workspaceId for Home threads", () => {
    expect(threadWorkspaceId(homeThread("t", "w1", "idle"), new Map())).toBe("w1");
  });
  it("resolves real-project threads through the project", () => {
    expect(threadWorkspaceId(projectThread("t", "p1", "idle"), new Map(PROJECTS.map((p) => [p.id, p])))).toBe("w2");
  });
  it("returns undefined for a dangling tag", () => {
    expect(threadWorkspaceId(homeThread("t", undefined, "idle"), new Map())).toBeUndefined();
  });
});

describe("EmployeeDockBar aggregateRole", () => {
  it("picks the highest-priority live thread", () => {
    const threads = [
      homeThread("t1", "w1", "idle"),
      homeThread("t2", "w1", "working"),
      homeThread("t3", "w1", "needs_approval"),
    ];
    const agg = aggregateRole(threads, [], "w1", {});
    expect(agg.status).toBe("needs_approval");
    expect(agg.active?.id).toBe("t3");
  });

  it("prefers error over working", () => {
    const threads = [homeThread("t1", "w1", "working"), homeThread("t2", "w1", "error")];
    const agg = aggregateRole(threads, [], "w1", {});
    expect(agg.status).toBe("error");
  });

  it("ignores threads that belong to another workspace", () => {
    const threads = [homeThread("t1", "w2", "working")];
    const agg = aggregateRole(threads, [], "w1", {});
    expect(agg.status).toBe("inactive");
    expect(agg.active).toBeNull();
  });

  it("resolves project-scoped threads to their project's workspace", () => {
    const threads = [projectThread("t1", "p1", "working")];
    const agg = aggregateRole(threads, PROJECTS, "w2", {});
    expect(agg.status).toBe("working");
    const other = aggregateRole(threads, PROJECTS, "w1", {});
    expect(other.status).toBe("inactive");
  });

  it("carries context usage for the active thread", () => {
    const threads = [homeThread("t1", "w1", "working")];
    const context = { t1: { usedTokens: 500, maxTokens: 2000 } };
    const agg = aggregateRole(threads, [], "w1", context);
    expect(agg.context).toEqual({ usedTokens: 500, maxTokens: 2000 });
  });
});

describe("resolveRoleNavigation", () => {
  it("opens the live thread when one is active", () => {
    const agg = aggregateRole([homeThread("t1", "w1", "working")], [], "w1", {});
    expect(resolveRoleNavigation(agg)).toEqual({ type: "thread", threadId: "t1" });
  });
  it("starts a new draft when the role has no active thread", () => {
    const agg = aggregateRole([homeThread("t1", "w1", "idle")], [], "w1", {});
    expect(resolveRoleNavigation(agg)).toEqual({ type: "new-draft" });
  });
  it("starts a new draft when the role has no threads at all", () => {
    const agg = aggregateRole([], [], "w1", {});
    expect(resolveRoleNavigation(agg)).toEqual({ type: "new-draft" });
  });
});
