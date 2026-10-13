import { describe, expect, it } from "vitest";
import type { Task, TaskDraft } from "@/shared/contracts";
import {
  applyOptimisticDraftReorder,
  applyOptimisticReorder,
  filterByProject,
  filterDraftsByProject,
  groupLane,
  moveItem,
  orderDrafts,
  orderLane,
  resolveCardDrop,
  resolveDraftDrop,
} from "./boardOrdering";

function task(overrides: Partial<Task>): Task {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    title: "Task",
    prompt: "Do it",
    agentKind: "gdsAgent:home",
    config: { model: "gdsAgent-fable-5" },
    category: null,
    projectId: null,
    isolation: "worktree",
    recurrence: null,
    scheduleEnabled: false,
    status: "todo",
    worktreePath: null,
    worktreeBranch: null,
    sortOrder: 0,
    threadId: null,
    nextRunAt: null,
    lastRunAt: null,
    lastCompletedAt: null,
    lastStatus: "never",
    lastResult: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("boardOrdering", () => {
  it("filters to one project and keeps Home tasks under the unfiltered board", () => {
    const tasks = [
      task({ id: "a", projectId: "p1" }),
      task({ id: "b", projectId: "p2" }),
      task({ id: "home", projectId: null }),
    ];
    expect(filterByProject(tasks, null).map((t) => t.id)).toEqual(["a", "b", "home"]);
    expect(filterByProject(tasks, "p1").map((t) => t.id)).toEqual(["a"]);
  });

  it("orders the Todo lane by sortOrder only when a project is filtered", () => {
    const tasks = [
      task({ id: "a", projectId: "p1", sortOrder: 2, updatedAt: "2026-01-03T00:00:00.000Z" }),
      task({ id: "b", projectId: "p1", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z" }),
      task({ id: "c", projectId: "p1", sortOrder: 1, updatedAt: "2026-01-02T00:00:00.000Z" }),
    ];
    expect(orderLane(tasks, "todo", "p1").map((t) => t.id)).toEqual(["b", "c", "a"]);
    // Unfiltered: per-project ranks collide, so it falls back to freshest-first.
    expect(orderLane(tasks, "todo", null).map((t) => t.id)).toEqual(["a", "c", "b"]);
  });

  it("orders the running and done lanes freshest-first regardless of filter", () => {
    const tasks = [
      task({
        id: "old",
        projectId: "p1",
        status: "in_progress",
        sortOrder: 9,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
      task({
        id: "new",
        projectId: "p1",
        status: "in_progress",
        sortOrder: 0,
        updatedAt: "2026-01-05T00:00:00.000Z",
      }),
    ];
    expect(orderLane(tasks, "inProgress", "p1").map((t) => t.id)).toEqual(["new", "old"]);
  });

  it("resolves a drop on the in-progress column as a start", () => {
    expect(
      resolveCardDrop({
        source: {
          data: { type: "task-card", column: "todo", taskId: "t1", projectId: "p1" },
          initialIndex: 1,
          index: 1,
        },
        target: { data: { type: "task-column", column: "inProgress" } },
      }),
    ).toEqual({ kind: "start", taskId: "t1" });
  });

  it("resolves a drop on another todo card as a reorder, and anything else as none", () => {
    expect(
      resolveCardDrop({
        source: {
          data: { type: "task-card", column: "todo", taskId: "t1", projectId: "p1" },
          initialIndex: 0,
          index: 2,
        },
        target: { data: { type: "task-card", column: "todo", taskId: "t2", projectId: "p1" } },
      }),
    ).toEqual({ kind: "reorder", fromIndex: 0, toIndex: 2 });

    // Same index = no real move.
    expect(
      resolveCardDrop({
        source: {
          data: { type: "task-card", column: "todo", taskId: "t1", projectId: "p1" },
          initialIndex: 1,
          index: 1,
        },
        target: null,
      }),
    ).toEqual({ kind: "none" });

    // A non-todo source never acts.
    expect(
      resolveCardDrop({
        source: {
          data: { type: "task-card", column: "done", taskId: "t1", projectId: "p1" },
          initialIndex: 0,
          index: 1,
        },
        target: { data: { type: "task-column", column: "inProgress" } },
      }),
    ).toEqual({ kind: "none" });
  });

  it("applies an optimistic reorder and moves items by index", () => {
    const tasks = [task({ id: "a", sortOrder: 5 }), task({ id: "b", sortOrder: 6 })];
    expect(applyOptimisticReorder(tasks, ["b", "a"]).map((t) => t.sortOrder)).toEqual([1, 0]);
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("filters and orders the draft lane like the Todo lane", () => {
    const drafts: TaskDraft[] = [
      draft({ id: "a", projectId: "p1", sortOrder: 2, updatedAt: "2026-01-03T00:00:00.000Z" }),
      draft({ id: "b", projectId: "p1", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z" }),
      draft({ id: "c", projectId: "p2", sortOrder: 1, updatedAt: "2026-01-02T00:00:00.000Z" }),
    ];
    expect(filterDraftsByProject(drafts, "p1").map((d) => d.id)).toEqual(["a", "b"]);
    expect(orderDrafts(filterDraftsByProject(drafts, "p1"), "p1").map((d) => d.id)).toEqual([
      "b",
      "a",
    ]);
    // Unfiltered: per-project ranks collide, so freshest-first.
    expect(orderDrafts(drafts, null).map((d) => d.id)).toEqual(["a", "c", "b"]);
  });

  it("only reorders a dragged draft, never promotes it", () => {
    expect(
      resolveDraftDrop({
        source: {
          data: { type: "task-draft-item", draftId: "d1", projectId: "p1" },
          initialIndex: 1,
          index: 0,
        },
      }),
    ).toEqual({ kind: "reorder", fromIndex: 1, toIndex: 0 });

    // A task card is not a draft.
    expect(
      resolveDraftDrop({
        source: { data: { type: "task-card", column: "todo" }, initialIndex: 1, index: 0 },
      }),
    ).toEqual({ kind: "none" });
  });

  it("applies an optimistic draft reorder", () => {
    const drafts = [draft({ id: "a", sortOrder: 5 }), draft({ id: "b", sortOrder: 6 })];
    expect(applyOptimisticDraftReorder(drafts, ["b", "a"]).map((d) => d.sortOrder)).toEqual([1, 0]);
  });

  it("splits a lane into categories, each split by project, uncategorized and Home last", () => {
    const lane = [
      task({ id: "b1", category: "Billing", projectId: "p2", status: "in_progress" }),
      task({ id: "a1", category: "Auth", projectId: "p1", status: "in_progress" }),
      task({ id: "a2", category: "Auth", projectId: null, status: "in_progress" }),
      task({ id: "a3", category: "Auth", projectId: "p2", status: "in_progress" }),
      task({ id: "u1", category: null, projectId: "p1", status: "in_progress" }),
      task({ id: "u2", category: "  ", projectId: null, status: "in_progress" }),
    ];
    const groups = groupLane(
      lane,
      new Map([
        ["p1", "Alpha"],
        ["p2", "Beta"],
      ]),
    );
    expect(groups.map((group) => group.category)).toEqual(["Auth", "Billing", null]);
    expect(groups.map((group) => group.count)).toEqual([3, 1, 2]);
    // Auth: Alpha (p1) -> Beta (p2) -> Home (null).
    expect(groups[0]!.projects.map((project) => project.projectId)).toEqual(["p1", "p2", null]);
    expect(groups[0]!.projects.map((project) => project.tasks.map((t) => t.id))).toEqual([
      ["a1"],
      ["a3"],
      ["a2"],
    ]);
    // The uncategorized tray keeps its own project split, Home still last.
    expect(groups[2]!.projects.map((project) => project.projectId)).toEqual(["p1", null]);
    expect(groups[2]!.projects[1]!.tasks.map((t) => t.id)).toEqual(["u2"]);
  });

  it("sorts categories case-insensitively", () => {
    const lane = [task({ id: "b", category: "billing" }), task({ id: "a", category: "Auth" })];
    expect(groupLane(lane, new Map()).map((group) => group.category)).toEqual(["Auth", "billing"]);
  });

  it("orders projects by display name, with Home last", () => {
    const lane = [
      task({ id: "z", category: "Auth", projectId: "p1" }),
      task({ id: "a", category: "Auth", projectId: "p2" }),
      task({ id: "h", category: "Auth", projectId: null }),
    ];
    const [group] = groupLane(
      lane,
      new Map([
        ["p1", "Zulu"],
        ["p2", "Alpha"],
      ]),
    );
    expect(group!.projects.map((project) => project.projectId)).toEqual(["p2", "p1", null]);
  });

  it("groups every lane the same way, including Todo and Done", () => {
    const lane = [
      task({ id: "a", category: "Auth", status: "todo" }),
      task({ id: "b", category: "Billing", status: "todo" }),
    ];
    const groups = groupLane(lane, new Map());
    expect(groups.map((group) => group.category)).toEqual(["Auth", "Billing"]);
    expect(groups[0]!.projects).toHaveLength(1);
    expect(groups[0]!.projects[0]!.tasks.map((t) => t.id)).toEqual(["a"]);
  });

  it("returns no groups for an empty lane", () => {
    expect(groupLane([], new Map())).toEqual([]);
  });
});

function draft(overrides: Partial<TaskDraft>): TaskDraft {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title: "Idea",
    note: null,
    category: null,
    projectId: null,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
