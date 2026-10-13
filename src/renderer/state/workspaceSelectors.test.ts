import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Thread, Workspace } from "@/shared/contracts";
import { HOME_PROJECT_ID } from "@/shared/homeScope";
import { DEFAULT_SCENARIO_IDS_BY_CATEGORY } from "@/renderer/scenarios/catalog";
import { useSharedSettings } from "./sharedSettingsStore";
import { useWorkspaceStore } from "./workspaceStore";
import {
  resolveWorkspaceCategory,
  resolveWorkspaceScenarioScope,
  useWorkspaceThreadFilter,
} from "./workspaceSelectors";

const workspaces: Workspace[] = [
  { id: "w1", name: "Work", createdAt: "2026-01-01T00:00:00.000Z", icon: "briefcase" },
  { id: "w2", name: "Side Hustle", createdAt: "2026-01-01T00:00:00.000Z", icon: "rocket" },
];

function makeThread(input: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Thread",
    agentKind: "gdsAgent",
    config: { model: "sonnet" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...input,
  };
}

function threadFilter(): (thread: Thread) => boolean {
  return renderHook(() => useWorkspaceThreadFilter()).result.current;
}

describe("useWorkspaceThreadFilter", () => {
  beforeEach(() => {
    localStorage.clear();
    useSharedSettings.setState({ workspaces });
    useWorkspaceStore.setState({ activeWorkspaceId: "w1" });
  });

  it("passes real-project threads regardless of their tag", () => {
    const isVisible = threadFilter();
    expect(isVisible(makeThread())).toBe(true);
    expect(isVisible(makeThread({ workspaceId: "w2" }))).toBe(true);
  });

  it("scopes Home threads to the active workspace, keeping untagged and dangling ones", () => {
    const isVisible = threadFilter();
    expect(isVisible(makeThread({ projectId: HOME_PROJECT_ID, workspaceId: "w1" }))).toBe(true);
    expect(isVisible(makeThread({ projectId: HOME_PROJECT_ID, workspaceId: "w2" }))).toBe(false);
    expect(isVisible(makeThread({ projectId: HOME_PROJECT_ID }))).toBe(true);
    expect(isVisible(makeThread({ projectId: HOME_PROJECT_ID, workspaceId: "w-gone" }))).toBe(true);
  });
});

/** A primary container (一级岗位) with a domain but no explicit scenario list. */
function container(id: string, name: string, category: "general" | "docs" | "code" | "test") {
  return {
    id,
    name,
    createdAt: "2026-01-01T00:00:00.000Z",
    icon: "briefcase" as const,
    category,
  };
}

/** A secondary employee (二级岗位) hanging under a container. */
function employee(id: string, name: string, parentWorkspaceId: string, rank: 1 | 2 | 3 = 3) {
  return {
    id,
    name,
    createdAt: "2026-01-01T00:00:00.000Z",
    icon: "briefcase" as const,
    roleRank: rank,
    parentWorkspaceId,
  };
}

describe("resolveWorkspaceScenarioScope", () => {
  it("returns undefined for an unknown workspace (shows every scenario)", () => {
    expect(resolveWorkspaceScenarioScope([], "w-gone")).toBeUndefined();
  });

  it("uses the workspace's explicit list even when a container would say otherwise", () => {
    const scopedWorkspaces = [container("c1", "软件测试岗", "test"), employee("e1", "测试员", "c1")];
    // Without an explicit list, e1 inherits its container's test scenarios.
    expect(resolveWorkspaceScenarioScope(scopedWorkspaces, "e1")).toEqual([
      ...DEFAULT_SCENARIO_IDS_BY_CATEGORY.test,
    ]);
    const explicit = scopedWorkspaces.map((w) =>
      w.id === "e1" ? { ...w, defaultScenarioIds: ["fix-bug"] } : w,
    );
    expect(resolveWorkspaceScenarioScope(explicit, "e1")).toEqual(["fix-bug"]);
    // An explicit empty list means "show none" — never inherited away.
    const none = scopedWorkspaces.map((w) =>
      w.id === "e1" ? { ...w, defaultScenarioIds: [] } : w,
    );
    expect(resolveWorkspaceScenarioScope(none, "e1")).toEqual([]);
  });

  it("uses the workspace's own domain defaults when it has no list", () => {
    const scopedWorkspaces = [container("c1", "软件测试岗", "test"), employee("e1", "测试员", "c1", 2)];
    const scoped = scopedWorkspaces.map((w) =>
      w.id === "e1" ? { ...w, category: "code" as const } : w,
    );
    expect(resolveWorkspaceScenarioScope(scoped, "e1")).toEqual([
      ...DEFAULT_SCENARIO_IDS_BY_CATEGORY.code,
    ]);
  });

  it("a secondary 岗位 inherits its primary container's scenario scope", () => {
    const scopedWorkspaces = [
      container("c1", "软件测试岗", "test"),
      employee("e1", "测试主管", "c1", 2),
      employee("e2", "设计师", "c1"),
    ];
    expect(resolveWorkspaceScenarioScope(scopedWorkspaces, "e1")).toEqual([
      ...DEFAULT_SCENARIO_IDS_BY_CATEGORY.test,
    ]);
    expect(resolveWorkspaceScenarioScope(scopedWorkspaces, "e2")).toEqual([
      ...DEFAULT_SCENARIO_IDS_BY_CATEGORY.test,
    ]);
    // The container itself resolves through its own domain.
    expect(resolveWorkspaceScenarioScope(scopedWorkspaces, "c1")).toEqual([
      ...DEFAULT_SCENARIO_IDS_BY_CATEGORY.test,
    ]);
  });

  it("an employee with an explicit container list inherits that list over the domain", () => {
    const scopedWorkspaces = [
      { ...container("c1", "软件测试岗", "test"), defaultScenarioIds: ["fix-bug"] },
      employee("e1", "测试员", "c1"),
    ];
    expect(resolveWorkspaceScenarioScope(scopedWorkspaces, "e1")).toEqual(["fix-bug"]);
  });

  it("a flat workspace with no domain/parent still shows every scenario", () => {
    expect(resolveWorkspaceScenarioScope([{ ...workspaces[0]! }], "w1")).toBeUndefined();
  });
});

describe("resolveWorkspaceCategory", () => {
  it("uses the workspace's own domain when set", () => {
    expect(resolveWorkspaceCategory([container("c1", "软件测试岗", "test")], "c1")).toBe("test");
  });

  it("a secondary 岗位 inherits its container's domain", () => {
    const scopedWorkspaces = [container("c1", "软件测试岗", "test"), employee("e1", "测试员", "c1")];
    expect(resolveWorkspaceCategory(scopedWorkspaces, "e1")).toBe("test");
  });

  it("returns undefined when nothing resolves", () => {
    expect(resolveWorkspaceCategory([], "w-gone")).toBeUndefined();
    expect(resolveWorkspaceCategory([workspaces[0]!], "w1")).toBeUndefined();
  });
});


