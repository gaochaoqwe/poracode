import { describe, expect, it, vi } from "vitest";
import type {
  AgentStatusesResponse,
  GitAddWorktreeResult,
  Project,
  RemoteThreadCommand,
  Task,
  TaskRun,
  Thread,
  ThreadStatus,
} from "@/shared/contracts";
import { agentStatusesResponseSchema } from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import { defaultSharedSettings } from "@/shared/settings";
import { TaskRunCoordinator, type TaskRunCoordinatorDeps } from "./TaskRunCoordinator";

const HOME_PROJECT: Project = {
  id: "__lightcode_home__",
  name: "Home",
  location: { kind: "posix", path: "/home/user" },
  disabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const WORK_PROJECT: Project = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Work",
  location: { kind: "windows", path: "C:/repos/work" },
  createdAt: "2026-01-01T00:00:00.000Z",
};

const TASK_ID = "11111111-1111-4111-8111-111111111111";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    title: "Nightly brief",
    prompt: "Summarize the day.",
    agentKind: "gdsAgent:home",
    config: { model: "gdsAgent-fable-5", effort: "high" },
    category: null,
    projectId: null,
    isolation: "project",
    recurrence: null,
    scheduleEnabled: false,
    status: "in_progress",
    worktreePath: null,
    worktreeBranch: null,
    sortOrder: 0,
    threadId: null,
    nextRunAt: null,
    lastRunAt: null,
    lastCompletedAt: null,
    lastStatus: "running",
    lastResult: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

function agentStatuses(): AgentStatusesResponse {
  return agentStatusesResponseSchema.parse({
    fromCache: true,
    windows: [
      {
        kind: "gdsAgent:home",
        label: "GdsAgent",
        installed: true,
        authState: "authenticated",
        capabilities: {
          approvalPolicies: [
            { id: "on-request", label: "On Request" },
            { id: "never", label: "Full Access" },
          ],
          sandboxModes: [
            { id: "workspace-write", label: "Workspace Write" },
            { id: "danger-full-access", label: "Full Access" },
          ],
        },
      },
    ],
    wsl: [],
  });
}

interface Harness {
  coordinator: TaskRunCoordinator;
  threads: Map<string, Thread>;
  runs: Map<string, TaskRun>;
  tasks: Map<string, Task>;
  sent: RemoteThreadCommand[];
  startThread: ReturnType<typeof vi.fn>;
  addWorktree: ReturnType<typeof vi.fn>;
  interruptThread: ReturnType<typeof vi.fn>;
  setTaskAwaiting: ReturnType<typeof vi.fn>;
}

function makeHarness(overrides: Partial<TaskRunCoordinatorDeps> = {}): Harness {
  const threads = new Map<string, Thread>();
  const runs = new Map<string, TaskRun>();
  const tasks = new Map<string, Task>();
  const sent: RemoteThreadCommand[] = [];
  const ids = ["thread-1", "run-1"];
  let idx = 0;
  const startThread = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined);
  const addWorktree = vi
    .fn<() => Promise<GitAddWorktreeResult>>()
    .mockResolvedValue({ path: "/wt/task" });
  const interruptThread = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined);
  const setTaskAwaiting = vi.fn<(taskId: string, awaiting: boolean) => void>();

  const deps: TaskRunCoordinatorDeps = {
    startThread,
    interruptThread,
    addWorktree,
    getAgentStatuses: async () => agentStatuses(),
    sendThreadCommand: (command) => {
      sent.push(command);
      return true;
    },
    ensureHomeProject: () => HOME_PROJECT,
    getProject: (projectId) => (projectId === WORK_PROJECT.id ? WORK_PROJECT : null),
    upsertThread: (thread) => {
      threads.set(thread.id, thread);
    },
    deleteThread: (threadId) => {
      threads.delete(threadId);
    },
    threadExists: (threadId) => threads.has(threadId),
    upsertTask: (next) => {
      tasks.set(next.id, next);
    },
    setTaskAwaiting,
    insertRun: (run) => {
      runs.set(run.id, run);
    },
    updateRun: (id, patch) => {
      const current = runs.get(id);
      if (!current) return;
      runs.set(id, {
        ...current,
        ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
      });
    },
    newId: () => ids[idx++] ?? `id-${idx}`,
    getSharedSettings: () => defaultSharedSettings,
    // No employees in the default harness: tasks without an employeeId keep running
    // off their own agentKind/config, which is what the pre-employee tests assert.
    getEmployee: () => null,
    ...overrides,
  };

  return {
    coordinator: new TaskRunCoordinator(deps),
    threads,
    runs,
    tasks,
    sent,
    startThread,
    addWorktree,
    interruptThread,
    setTaskAwaiting,
  };
}

function threadState(
  threadId: string,
  status: ThreadStatus,
  errorMessage?: string,
): SupervisorEvent {
  return {
    type: "thread-state",
    threadId,
    status,
    attention: "none",
    canResumeWithConfig: false,
    ...(errorMessage ? { errorMessage } : {}),
  };
}

/** Drain pending microtasks before `startThread` is called. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TaskRunCoordinator", () => {
  it("creates a real GUI thread, records a run, then resolves succeeded", async () => {
    const { coordinator, threads, runs, sent, startThread } = makeHarness();

    const settled = coordinator.runTaskAsThread(task());
    await flush();

    expect(threads.get("thread-1")).toMatchObject({
      projectId: HOME_PROJECT.id,
      title: "Nightly brief",
      presentationMode: "gui",
      status: "launching",
    });
    expect(sent[0]).toMatchObject({
      kind: "start",
      threadId: "thread-1",
      title: "Nightly brief",
      launchRuntime: false,
      focus: false,
    });
    expect(runs.get("run-1")).toMatchObject({ taskId: TASK_ID, status: "running" });
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        prompt: "Summarize the day.",
        projectLocation: HOME_PROJECT.location,
      }),
    );

    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "idle"));

    await expect(settled).resolves.toMatchObject({ status: "succeeded", error: null });
    expect(runs.get("run-1")?.status).toBe("succeeded");
  });

  it("parks the task on 'Needs you' while the agent waits, and clears it on resume", async () => {
    const { coordinator, setTaskAwaiting } = makeHarness();
    const settled = coordinator.runTaskAsThread(task());
    await flush();

    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    expect(setTaskAwaiting).toHaveBeenLastCalledWith(TASK_ID, false);

    coordinator.observeSupervisorEvent(threadState("thread-1", "needs_approval"));
    expect(setTaskAwaiting).toHaveBeenLastCalledWith(TASK_ID, true);

    coordinator.observeSupervisorEvent(threadState("thread-1", "needs_reply"));
    expect(setTaskAwaiting).toHaveBeenLastCalledWith(TASK_ID, true);

    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    expect(setTaskAwaiting).toHaveBeenLastCalledWith(TASK_ID, false);

    coordinator.observeSupervisorEvent(threadState("thread-1", "idle"));
    await expect(settled).resolves.toMatchObject({ status: "succeeded" });
  });

  it("resolves a failed outcome (never rejects) when the thread errors", async () => {
    const { coordinator, runs } = makeHarness();
    const settled = coordinator.runTaskAsThread(task());
    await flush();

    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "error", "model exploded"));

    await expect(settled).resolves.toMatchObject({ status: "failed", error: "model exploded" });
    expect(runs.get("run-1")).toMatchObject({ status: "failed", error: "model exploded" });
  });

  it("rolls back the fresh thread row and resolves failed when startThread throws", async () => {
    const { coordinator, threads, runs, sent } = makeHarness({
      startThread: vi.fn<() => Promise<unknown>>().mockRejectedValue(new Error("supervisor down")),
    });

    await expect(coordinator.runTaskAsThread(task())).resolves.toMatchObject({
      status: "failed",
      error: "supervisor down",
    });
    expect(threads.has("thread-1")).toBe(false);
    expect(sent.some((command) => command.kind === "delete")).toBe(true);
    expect(runs.get("run-1")).toMatchObject({ status: "failed", error: "supervisor down" });
  });

  it("runs a project-isolation task in the project directory (no worktree)", async () => {
    const { coordinator, addWorktree, startThread, tasks } = makeHarness();

    const settled = coordinator.runTaskAsThread(task({ projectId: WORK_PROJECT.id }));
    await flush();

    expect(addWorktree).not.toHaveBeenCalled();
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({ projectLocation: WORK_PROJECT.location }),
    );
    expect(tasks.get(TASK_ID)?.worktreePath).toBeNull();

    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "idle"));
    await expect(settled).resolves.toMatchObject({ status: "succeeded" });
  });

  it("provisions a worktree and launches inside it for worktree isolation", async () => {
    const { coordinator, addWorktree, startThread, tasks, threads } = makeHarness();

    const settled = coordinator.runTaskAsThread(
      task({ projectId: WORK_PROJECT.id, isolation: "worktree" }),
    );
    await flush();

    expect(addWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        projectLocation: WORK_PROJECT.location,
        branch: `agentemployee/task-${TASK_ID.slice(0, 8)}`,
        createBranch: true,
      }),
    );
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        projectLocation: { kind: "windows", path: "/wt/task" },
      }),
    );
    // Persisted so later runs reuse the same worktree.
    expect(tasks.get(TASK_ID)?.worktreePath).toBe("/wt/task");
    expect(threads.get("thread-1")?.worktreePath).toBe("/wt/task");

    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "idle"));
    await expect(settled).resolves.toMatchObject({ status: "succeeded" });
  });

  it("fails hard when worktree provisioning fails (no silent project fallback)", async () => {
    const { coordinator, threads, runs, startThread } = makeHarness({
      addWorktree: vi
        .fn<() => Promise<GitAddWorktreeResult>>()
        .mockRejectedValue(new Error("not a git repository")),
    });

    await expect(
      coordinator.runTaskAsThread(task({ projectId: WORK_PROJECT.id, isolation: "worktree" })),
    ).resolves.toMatchObject({ status: "failed", error: "not a git repository" });
    expect(threads.size).toBe(0);
    expect(runs.size).toBe(0);
    expect(startThread).not.toHaveBeenCalled();
  });

  it("cancels a live run: closes the run row and interrupts the thread", async () => {
    const { coordinator, runs, interruptThread } = makeHarness();
    const settled = coordinator.runTaskAsThread(task());
    await flush();

    await expect(coordinator.cancelRun(TASK_ID)).resolves.toBe(true);
    expect(interruptThread).toHaveBeenCalledWith("thread-1");
    expect(runs.get("run-1")).toMatchObject({ status: "cancelled" });
    await expect(settled).resolves.toMatchObject({ status: "cancelled" });

    // A later idle from the interrupted thread must not re-settle the run.
    coordinator.observeSupervisorEvent(threadState("thread-1", "idle"));
    expect(runs.get("run-1")?.status).toBe("cancelled");
  });

  it("resolves failed when the task's project no longer exists", async () => {
    const { coordinator, threads, runs } = makeHarness();

    await expect(
      coordinator.runTaskAsThread(task({ projectId: "deleted-project-id" })),
    ).resolves.toMatchObject({ status: "failed", error: "Project no longer exists." });
    expect(threads.size).toBe(0);
    expect(runs.size).toBe(0);
  });
});
