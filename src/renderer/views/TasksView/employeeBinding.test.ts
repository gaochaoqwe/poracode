import { describe, expect, it } from "vitest";
import type { Task, Workspace } from "@/shared/contracts";
import { employeeBinding, partitionEmployees } from "./employeeBinding";
import { newTaskDraft, taskDraftFromTask, taskDraftInput, taskDraftIsValid } from "./taskDraft";
import type { TaskDraftForm } from "./taskDraft";

function workspace(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    name: overrides.id,
    persona: "",
    responsibilities: "",
    skillIds: [],
    capabilityTags: [],
    capabilityIds: [],
    hiddenInNav: false,
    ...overrides,
  } as Workspace;
}

/** An employee that can actually run work: a provider plus a resolved model. */
function runnable(id: string, model = "gpt-5.6"): Workspace {
  return workspace({
    id,
    agentKind: "codex",
    defaultThreadConfig: { model } as Workspace["defaultThreadConfig"],
  });
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    title: "Task",
    prompt: "Do it",
    agentKind: "codex",
    config: { model: "gpt-5.6" },
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
  } as Task;
}

describe("employeeBinding", () => {
  it("resolves the provider and model an employee runs with", () => {
    expect(employeeBinding(runnable("e1", "gpt-5.6"))).toEqual({
      agentKind: "codex",
      model: "gpt-5.6",
      effort: "",
      fast: false,
    });
  });

  it("carries the employee's default effort and fast flag", () => {
    const employee = workspace({
      id: "e1",
      agentKind: "codex",
      defaultThreadConfig: {
        model: "gpt-5.6",
        effort: "high",
        fast: true,
      } as Workspace["defaultThreadConfig"],
    });
    expect(employeeBinding(employee)).toEqual({
      agentKind: "codex",
      model: "gpt-5.6",
      effort: "high",
      fast: true,
    });
  });

  it("returns null when the employee has no provider or no model", () => {
    expect(employeeBinding(undefined)).toBeNull();
    expect(employeeBinding(workspace({ id: "e1" }))).toBeNull();
    expect(employeeBinding(workspace({ id: "e1", agentKind: "codex" }))).toBeNull();
    expect(
      employeeBinding(
        workspace({
          id: "e1",
          agentKind: "codex",
          defaultThreadConfig: {} as Workspace["defaultThreadConfig"],
        }),
      ),
    ).toBeNull();
  });
});

describe("partitionEmployees", () => {
  it("separates employees that can run tasks from those that cannot", () => {
    const ready = runnable("ready");
    const noAgent = workspace({ id: "noAgent" });
    const noModel = workspace({ id: "noModel", agentKind: "codex" });

    const { runnable: can, blocked } = partitionEmployees([ready, noAgent, noModel]);

    expect(can.map((employee) => employee.id)).toEqual(["ready"]);
    // Blocked employees stay visible so the picker can disable them with a reason
    // rather than making them silently disappear.
    expect(blocked.map((employee) => employee.id)).toEqual(["noAgent", "noModel"]);
  });
});

describe("task draft employee assignment", () => {
  it("seeds the employee the caller preselected", () => {
    expect(newTaskDraft({ employeeId: "e1" }).employeeId).toBe("e1");
    expect(newTaskDraft().employeeId).toBe("");
  });

  it("round-trips the assigned employee off an existing task", () => {
    expect(taskDraftFromTask(task({ employeeId: "e7" })).employeeId).toBe("e7");
    expect(taskDraftFromTask(task({ employeeId: null })).employeeId).toBe("");
  });

  it("derives agentKind and model from the assigned employee", () => {
    const employees = new Map([["e1", employeeBinding(runnable("e1", "gpt-5.6"))!]]);
    const draft: TaskDraftForm = {
      ...newTaskDraft(),
      title: "Ship it",
      prompt: "Do the thing",
      employeeId: "e1",
    };

    const input = taskDraftInput(draft, employees);

    expect(input.employeeId).toBe("e1");
    expect(input.agentKind).toBe("codex");
    expect(input.config.model).toBe("gpt-5.6");
  });

  it("requires an employee that resolves to a provider and model", () => {
    const employees = new Map([["e1", employeeBinding(runnable("e1"))!]]);
    const base = {
      ...newTaskDraft(),
      title: "Ship it",
      prompt: "Do the thing",
      category: "Billing",
    };

    // No employee picked.
    expect(taskDraftIsValid({ ...base, employeeId: "" }, employees)).toBe(false);
    // Picked, but the selection is stale/unknown.
    expect(taskDraftIsValid({ ...base, employeeId: "gone" }, employees)).toBe(false);
    // Picked and runnable.
    expect(taskDraftIsValid({ ...base, employeeId: "e1" }, employees)).toBe(true);
  });

  it("blocks saving when the title or prompt is missing", () => {
    const employees = new Map([["e1", employeeBinding(runnable("e1"))!]]);
    expect(
      taskDraftIsValid(
        { ...newTaskDraft(), title: "  ", prompt: "x", category: "Billing", employeeId: "e1" },
        employees,
      ),
    ).toBe(false);
    expect(
      taskDraftIsValid(
        { ...newTaskDraft(), title: "x", prompt: "  ", category: "Billing", employeeId: "e1" },
        employees,
      ),
    ).toBe(false);
  });

  it("keeps an existing task's stored provider when its employee no longer resolves", () => {
    // Editing an old task whose employee has since been deleted must not silently
    // rewrite the provider it runs with.
    const draft: TaskDraftForm = {
      ...newTaskDraft(),
      title: "Ship it",
      prompt: "Do the thing",
      employeeId: "gone",
    };

    const input = taskDraftInput(draft, new Map(), {
      agentKind: "gdsAgent:home",
      model: "gdsAgent-fable-5",
      effort: "medium",
    });

    expect(input.agentKind).toBe("gdsAgent:home");
    expect(input.config).toEqual({ model: "gdsAgent-fable-5", effort: "medium" });
  });

  it("clears the assignment when the draft has no employee", () => {
    expect(taskDraftInput(newTaskDraft(), new Map()).employeeId).toBeNull();
  });
});
