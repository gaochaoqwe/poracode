import { describe, expect, it, vi } from "vitest";
import type { Task, TaskInput } from "@/shared/contracts";
import { TasksService, type TaskStore } from "./TasksService";
import type { TaskRunOutcome } from "./TaskRunCoordinator";

export function memoryTaskStore(): TaskStore {
  const tasks = new Map<string, Task>();
  return {
    list: () => [...tasks.values()],
    get: (id) => tasks.get(id) ?? null,
    upsert: (task) => tasks.set(task.id, task),
    delete: (id) => {
      tasks.delete(id);
    },
    setSortOrders: (entries) => {
      for (const entry of entries) {
        const current = tasks.get(entry.id);
        if (current) tasks.set(entry.id, { ...current, sortOrder: entry.sortOrder });
      }
    },
  };
}

export const scheduledInput: TaskInput = {
  title: "Daily brief",
  prompt: "Summarize today's priorities.",
  agentKind: "gdsAgent:home",
  config: { model: "gdsAgent-fable-5", effort: "high" },
  isolation: "project",
  recurrence: { kind: "weekly", days: [1, 2, 3, 4, 5], time: "08:00" },
  scheduleEnabled: true,
};

export const manualInput: TaskInput = {
  title: "Refactor auth",
  prompt: "Split the auth module.",
  agentKind: "gdsAgent:home",
  config: { model: "gdsAgent-fable-5" },
  isolation: "worktree",
  recurrence: null,
  scheduleEnabled: false,
};

function service(
  store: TaskStore,
  runTask: (task: Task) => Promise<TaskRunOutcome>,
  extra: Partial<{
    now: () => number;
    cancelRun: (taskId: string) => Promise<void>;
    onStartupInterrupted: (taskId: string) => void;
  }> = {},
): TasksService {
  return new TasksService({
    store,
    runTask,
    cancelRun: extra.cancelRun ?? vi.fn<(id: string) => Promise<void>>(async () => undefined),
    ...(extra.onStartupInterrupted ? { onStartupInterrupted: extra.onStartupInterrupted } : {}),
    now: extra.now ?? (() => new Date(2026, 6, 6, 7, 0).getTime()),
  });
}

describe("TasksService", () => {
  it("creates a manual task in Todo with no schedule", () => {
    const store = memoryTaskStore();
    const created = service(store, vi.fn()).create(manualInput);
    expect(created.status).toBe("todo");
    expect(created.lastStatus).toBe("never");
    expect(created.scheduleEnabled).toBe(false);
    expect(created.nextRunAt).toBeNull();
    expect(created.isolation).toBe("worktree");
  });

  it("creates a scheduled task with a future next run", () => {
    const now = new Date(2026, 6, 6, 7, 0).getTime();
    const created = service(memoryTaskStore(), vi.fn(), { now: () => now }).create(scheduledInput);
    expect(created.nextRunAt).toBe(new Date(2026, 6, 6, 8, 0).toISOString());
    expect(created.scheduleEnabled).toBe(true);
  });

  it("fires a due recurring run, advances the schedule, and returns to Todo", async () => {
    const store = memoryTaskStore();
    let now = new Date(2026, 6, 6, 7, 0).getTime();
    let resolveRun!: (outcome: TaskRunOutcome) => void;
    const runTask = vi.fn<() => Promise<TaskRunOutcome>>(
      () => new Promise<TaskRunOutcome>((resolve) => (resolveRun = resolve)),
    );
    const svc = service(store, runTask, { now: () => now });
    const task = svc.create(scheduledInput);

    now = new Date(2026, 6, 6, 8, 0).getTime();
    svc.tick();
    svc.tick();
    expect(runTask).toHaveBeenCalledTimes(1);
    expect(store.get(task.id)?.status).toBe("in_progress");
    expect(store.get(task.id)?.nextRunAt).toBe(new Date(2026, 6, 7, 8, 0).toISOString());

    now += 1_000;
    resolveRun({ threadId: "t1", status: "succeeded", error: null });
    await vi.waitFor(() => expect(store.get(task.id)?.status).toBe("todo"));
    expect(store.get(task.id)?.lastStatus).toBe("succeeded");
  });

  it("settles a one-off manual run to Done on success and Failed on error", async () => {
    const store = memoryTaskStore();
    let settle!: (outcome: TaskRunOutcome) => void;
    const svc = service(store, () => new Promise<TaskRunOutcome>((resolve) => (settle = resolve)));

    const ok = svc.create(manualInput);
    svc.runNow(ok.id);
    settle({ threadId: "t1", status: "succeeded", error: null });
    await vi.waitFor(() => expect(store.get(ok.id)?.status).toBe("done"));

    const bad = svc.create({ ...manualInput, title: "Broken" });
    svc.runNow(bad.id);
    settle({ threadId: "t2", status: "failed", error: "boom" });
    await vi.waitFor(() => expect(store.get(bad.id)?.status).toBe("failed"));
    expect(store.get(bad.id)?.lastError).toBe("boom");
  });

  it("returns a recurring card to Todo after a failed run so it stays actionable", async () => {
    const store = memoryTaskStore();
    let now = new Date(2026, 6, 6, 7, 0).getTime();
    let settle!: (outcome: TaskRunOutcome) => void;
    const svc = service(store, () => new Promise<TaskRunOutcome>((resolve) => (settle = resolve)), {
      now: () => now,
    });
    const task = svc.create(scheduledInput);
    now = new Date(2026, 6, 6, 8, 0).getTime();
    svc.tick();
    settle({ threadId: "t1", status: "failed", error: "boom" });
    await vi.waitFor(() => expect(store.get(task.id)?.lastStatus).toBe("failed"));
    expect(store.get(task.id)?.status).toBe("todo");
  });

  it("stops a live run: cancels it and returns the card to Todo", async () => {
    const store = memoryTaskStore();
    const cancelRun = vi.fn<(id: string) => Promise<void>>(async () => undefined);
    const svc = service(store, () => new Promise<TaskRunOutcome>(() => undefined), { cancelRun });
    const task = svc.create(manualInput);
    svc.runNow(task.id);
    expect(store.get(task.id)?.status).toBe("in_progress");

    const stopped = await svc.stop(task.id);
    expect(cancelRun).toHaveBeenCalledWith(task.id);
    expect(stopped.status).toBe("cancelled");
    expect(stopped.lastStatus).toBe("cancelled");
  });

  it("marks dangling runs interrupted for tasks left running on startup", () => {
    const store = memoryTaskStore();
    const seed = service(store, vi.fn());
    const task = seed.create(manualInput);
    store.upsert({ ...store.get(task.id)!, status: "in_progress", lastStatus: "running" });

    const onStartupInterrupted = vi.fn<(taskId: string) => void>();
    const restarted = service(store, vi.fn(), { onStartupInterrupted });
    restarted.start();

    expect(onStartupInterrupted).toHaveBeenCalledWith(task.id);
    expect(store.get(task.id)?.lastStatus).toBe("interrupted");
    expect(store.get(task.id)?.status).toBe("todo");
    restarted.dispose();
  });

  it("recovers a run left parked on 'Needs you' by a previous process", () => {
    const store = memoryTaskStore();
    const seed = service(store, vi.fn());
    const task = seed.create(manualInput);
    // A crash while the agent was waiting on the user.
    store.upsert({ ...store.get(task.id)!, status: "awaiting_input", lastStatus: "running" });

    const onStartupInterrupted = vi.fn<(taskId: string) => void>();
    const restarted = service(store, vi.fn(), { onStartupInterrupted });
    restarted.start();

    expect(onStartupInterrupted).toHaveBeenCalledWith(task.id);
    expect(store.get(task.id)?.status).toBe("todo");
    restarted.dispose();
  });

  it("does not resurrect a task deleted while its run is in flight", async () => {
    const store = memoryTaskStore();
    let settle!: (outcome: TaskRunOutcome) => void;
    const svc = service(store, () => new Promise<TaskRunOutcome>((resolve) => (settle = resolve)));
    const task = svc.create(manualInput);
    svc.runNow(task.id);
    svc.delete(task.id);
    settle({ threadId: "t1", status: "succeeded", error: null });
    await Promise.resolve();
    expect(store.get(task.id)).toBeNull();
  });

  it("puts a new task at the top of its own project's Todo lane", () => {
    const store = memoryTaskStore();
    const svc = service(store, vi.fn());
    const first = svc.create({ ...manualInput, projectId: "p1" });
    const second = svc.create({ ...manualInput, projectId: "p1" });
    // A different project starts its own counter.
    const other = svc.create({ ...manualInput, projectId: "p2" });

    expect(first.sortOrder).toBe(0);
    expect(second.sortOrder).toBe(-1);
    expect(other.sortOrder).toBe(0);
  });

  it("persists a project's Todo order densely without touching updatedAt", () => {
    const store = memoryTaskStore();
    const svc = service(store, vi.fn());
    const a = svc.create({ ...manualInput, projectId: "p1" });
    const b = svc.create({ ...manualInput, projectId: "p1" });
    const c = svc.create({ ...manualInput, projectId: "p1" });
    const updatedAt = store.get(a.id)?.updatedAt;

    const result = svc.reorder("p1", [c.id, a.id, b.id]);

    expect(store.get(c.id)?.sortOrder).toBe(0);
    expect(store.get(a.id)?.sortOrder).toBe(1);
    expect(store.get(b.id)?.sortOrder).toBe(2);
    expect(store.get(a.id)?.updatedAt).toBe(updatedAt);
    expect(result.map((task) => task.id).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it("rejects a reorder that doesn't match the project's Todo set", () => {
    const store = memoryTaskStore();
    const svc = service(store, vi.fn());
    const a = svc.create({ ...manualInput, projectId: "p1" });
    const b = svc.create({ ...manualInput, projectId: "p1" });
    const otherProject = svc.create({ ...manualInput, projectId: "p2" });

    // Missing a task, an unknown/foreign id, a duplicate, and an extra id.
    expect(() => svc.reorder("p1", [a.id])).toThrow(/changed/i);
    expect(() => svc.reorder("p1", [a.id, otherProject.id])).toThrow(/changed/i);
    expect(() => svc.reorder("p1", [a.id, a.id])).toThrow(/changed/i);
    expect(() => svc.reorder("p1", [a.id, b.id, otherProject.id])).toThrow(/changed/i);
  });

  it("excludes non-Todo tasks from the reorderable set", () => {
    const store = memoryTaskStore();
    const svc = service(store, () => new Promise<TaskRunOutcome>(() => undefined));
    const running = svc.create({ ...manualInput, projectId: "p1" });
    const waiting = svc.create({ ...manualInput, projectId: "p1" });
    svc.runNow(running.id);

    expect(() => svc.reorder("p1", [running.id, waiting.id])).toThrow(/changed/i);
    expect(() => svc.reorder("p1", [waiting.id])).not.toThrow();
  });

  it("stores a trimmed category and normalizes blank to uncategorized", () => {
    const store = memoryTaskStore();
    const svc = service(store, vi.fn());
    const named = svc.create({ ...manualInput, category: "  Billing  " });
    const blank = svc.create({ ...manualInput, title: "No category", category: "   " });
    const omitted = svc.create({ ...manualInput, title: "Omitted" });

    expect(store.get(named.id)?.category).toBe("Billing");
    expect(store.get(blank.id)?.category).toBeNull();
    expect(store.get(omitted.id)?.category).toBeNull();
  });

  it("re-categorizes and clears a category on update", () => {
    const store = memoryTaskStore();
    const svc = service(store, vi.fn());
    const created = svc.create({ ...manualInput, category: "Billing" });

    expect(svc.update(created.id, { ...manualInput, category: "Docs" }).category).toBe("Docs");
    expect(svc.update(created.id, { ...manualInput, category: null }).category).toBeNull();
  });
});
