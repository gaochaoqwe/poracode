import { describe, expect, it, vi } from "vitest";
import type { Team, TeamRunChange, Workspace } from "@/shared/contracts";
import {
  MAX_TEAM_TASK_FORWARDS,
  TeamDispatcher,
  type TeamDispatcherDeps,
  type TeamDispatchBase,
  type TeamSpawnRequest,
} from "./teamDispatcher";
import type { QueuedTeamTask } from "./teamOrchestrator";

import { EmployeeTaskQueue } from "./employeeTaskQueue";

function workspace(
  id: string,
  name: string,
  agentKind?: string,
  agentInstanceId?: string,
): Workspace {
  return {
    id,
    name,
    createdAt: "2026-01-01T00:00:00.000Z",
    icon: "briefcase",
    ...(agentKind ? { agentKind } : {}),
    ...(agentInstanceId ? { agentInstanceId } : {}),
  };
}

function team(
  id: string,
  dispatchPolicy: Team["dispatchPolicy"],
  memberEmployeeIds: string[],
  managerEmployeeId?: string,
): Team {
  return {
    id,
    name: id,
    memberEmployeeIds,
    ...(managerEmployeeId ? { managerEmployeeId } : {}),
    dispatchPolicy,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const DOC = workspace("w-doc", "文档编写岗", "codex");
const CODE = workspace("w-code", "软件编码岗"); // no bound agentKind on purpose
const TEST = workspace("w-test", "软件测试岗", "gemini", "inst-gemini");
const WORKSPACES: Workspace[] = [DOC, CODE, TEST];

const BASE = {
  projectLocation: { kind: "windows" as const, path: "C:\\repo" },
  config: { model: "gpt-5" },
  initialSize: { cols: 120, rows: 30 },
};

interface Fixture {
  dispatcher: TeamDispatcher;
  spawns: TeamSpawnRequest[];
  runs: TeamRunChange[];
  statuses: Map<string, string>;
}

function makeFixture(teams: Team[]): Fixture {
  const spawns: TeamSpawnRequest[] = [];
  const runs: TeamRunChange[] = [];
  const statuses = new Map<string, string>();
  const deps: TeamDispatcherDeps = {
    readTeams: () => ({ teams, workspaces: WORKSPACES }),
    spawnMemberThread: async (request) => {
      spawns.push(request);
      // Mirror the supervisor host: an unbound member cannot spawn.
      if (!request.workspace.agentKind) {
        throw new Error(`Member workspace "${request.workspace.id}" has no bound agentKind`);
      }
      return `thread-${request.workspace.id}`;
    },
    recordTeamRun: async (change) => {
      runs.push(change);
    },
    readMemberThreadStatus: (threadId) => statuses.get(threadId),
  };
  return { dispatcher: new TeamDispatcher(deps), spawns, runs, statuses };
}

describe("TeamDispatcher.startTeam", () => {
  it("returns a snapshot for a known team", () => {
    const { dispatcher } = makeFixture([team("t", "round-robin", ["w-doc", "w-code", "w-test"])]);
    const snapshot = dispatcher.startTeam({ teamId: "t" });
    expect(snapshot.team.id).toBe("t");
    expect(snapshot.memberCount).toBe(3);
    expect(snapshot.pendingTaskCount).toBe(0);
  });

  it("throws for an unknown team", () => {
    const { dispatcher } = makeFixture([team("t", "round-robin", ["w-doc"])]);
    expect(() => dispatcher.startTeam({ teamId: "nope" })).toThrow(/Team not found/);
  });
});

describe("TeamDispatcher.dispatchTeamTask — policies", () => {
  it("round-robin rotates across dispatches and advances the cursor", async () => {
    const { dispatcher, spawns, statuses } = makeFixture([
      team("t", "round-robin", ["w-doc", "w-code", "w-test"]),
    ]);
    const first = await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "p1", ...BASE });
    expect(first.targets.map((t) => t.workspaceId)).toEqual(["w-doc"]);
    const second = await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "p2", ...BASE });
    expect(second.targets.map((t) => t.workspaceId)).toEqual(["w-code"]);
    const third = await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "p3", ...BASE });
    expect(third.targets.map((t) => t.workspaceId)).toEqual(["w-test"]);
    // w-doc's first thread has not settled yet → serial queue parks p4 instead of
    // starting a second concurrent thread for the same employee.
    const parked = await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "p4", ...BASE });
    expect(parked.targets.map((t) => t.workspaceId)).toEqual(["w-doc"]);
    expect(parked.targets[0]?.status).toBe("queued");
    expect(spawns).toHaveLength(3);
    // Once p1 settles, the parked p4 auto-dispatches to w-doc.
    statuses.set("thread-w-doc", "finished");
    dispatcher.observeThreadEvent("thread-w-doc");
    expect(spawns).toHaveLength(4);
    expect(spawns[3]?.task.prompt).toBe("p4");
    expect(spawns[0]?.task.prompt).toBe("p1");
    expect(spawns[0]?.base.prompt).toBe("p1");
  });

  it("free-for-all spawns every valid member in one dispatch", async () => {
    const { dispatcher } = makeFixture([team("t", "free-for-all", ["w-doc", "w-code", "w-test"])]);
    const result = await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "all", ...BASE });
    expect(result.policy).toBe("free-for-all");
    expect(result.targets.map((t) => t.workspaceId)).toEqual(["w-doc", "w-code", "w-test"]);
  });

  it("manager-assigns lands on the manager role", async () => {
    const { dispatcher } = makeFixture([
      team("t", "manager-assigns", ["w-doc", "w-code", "w-test"], "w-test"),
    ]);
    const result = await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "route", ...BASE });
    expect(result.policy).toBe("manager-assigns");
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]?.workspaceId).toBe("w-test");
  });

  it("manager-assigns degrades to round-robin when the manager is not a valid member", async () => {
    const { dispatcher } = makeFixture([
      team("t", "manager-assigns", ["w-doc", "w-code", "w-test"], "gone"),
    ]);
    const result = await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "route", ...BASE });
    expect(result.policy).toBe("manager-assigns");
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]?.workspaceId).toBe("w-doc");
  });
});

describe("TeamDispatcher.dispatchTeamTask — degradation", () => {
  it("empty members (all ids dangling) dispatches nothing and does not crash", async () => {
    const { dispatcher, spawns } = makeFixture([team("t", "free-for-all", ["gone"])]);
    const result = await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "lonely", ...BASE });
    expect(result.targets).toEqual([]);
    expect(spawns).toEqual([]);
  });

  it("an unbound member degrades to a recorded failure while other targets still spawn", async () => {
    const { dispatcher } = makeFixture([team("t", "free-for-all", ["w-doc", "w-code", "w-test"])]);
    const result = await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "mixed", ...BASE });
    const byId = Object.fromEntries(result.targets.map((t) => [t.workspaceId, t]));
    expect(byId["w-doc"]?.status).toBe("spawned");
    expect(byId["w-doc"]?.threadId).toBe("thread-w-doc");
    expect(byId["w-code"]?.status).toBe("failed");
    expect(byId["w-code"]?.reason).toMatch(/no bound agentKind/);
    expect(byId["w-test"]?.status).toBe("spawned");
  });

  it("a throwing spawn handler for a single target degrades to failed without crashing", async () => {
    const failingSpawn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("boom"));
    const dispatcher = new TeamDispatcher({
      readTeams: () => ({ teams: [team("t", "round-robin", ["w-doc"])], workspaces: WORKSPACES }),
      spawnMemberThread: failingSpawn,
    });
    const result = await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "x", ...BASE });
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]?.status).toBe("failed");
    expect(result.targets[0]?.reason).toBe("boom");
  });

  it("throws for an unknown team without touching the queue", async () => {
    const { dispatcher } = makeFixture([team("t", "round-robin", ["w-doc"])]);
    await expect(
      dispatcher.dispatchTeamTask({ teamId: "nope", prompt: "x", ...BASE }),
    ).rejects.toThrow(/Team not found/);
    expect(dispatcher.pendingFor("nope")).toEqual([]);
  });
});

describe("TeamDispatcher — run persistence", () => {
  it("records a running row with the decided targets, and keeps it running when threads spawned", async () => {
    const { dispatcher, runs } = makeFixture([team("t", "round-robin", ["w-doc", "w-test"])]);
    const result = await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "build", ...BASE });
    expect(result.targets.every((t) => t.status === "spawned")).toBe(true);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      teamId: "t",
      prompt: "build",
      status: "running",
      targetWorkspaceIds: ["w-doc"],
    });
    expect(runs[0]?.id).toBe(result.taskId);
    expect(runs[0]?.finishedAt).toBeUndefined();
  });

  it("updates the row to failed when every target fails to spawn", async () => {
    const { dispatcher, runs } = makeFixture([team("t", "round-robin", ["w-code"])]);
    const result = await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "boom", ...BASE });
    expect(result.targets[0]?.status).toBe("failed");
    expect(runs).toHaveLength(2);
    expect(runs[0]?.status).toBe("running");
    expect(runs[0]?.finishedAt).toBeUndefined();
    expect(runs[1]?.status).toBe("failed");
    expect(runs[1]?.finishedAt).toBeTruthy();
    expect(runs[1]?.id).toBe(runs[0]?.id);
  });

  it("does not record runs when no persistence callback is wired", async () => {
    const failingSpawn = vi.fn<() => Promise<string>>().mockResolvedValue("thread-x");
    const dispatcher = new TeamDispatcher({
      readTeams: () => ({ teams: [team("t", "round-robin", ["w-doc"])], workspaces: WORKSPACES }),
      spawnMemberThread: failingSpawn,
    });
    await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "x", ...BASE });
    expect(failingSpawn).toHaveBeenCalledTimes(1);
  });
});

describe("TeamDispatcher — forward guard", () => {
  it("refuses dispatch once the max-forward cap is exceeded for one task", async () => {
    const { dispatcher, runs } = makeFixture([team("t", "round-robin", ["w-doc"])]);
    const teamRecord = team("t", "round-robin", ["w-doc"]);
    const task: QueuedTeamTask = {
      id: "task-shared",
      teamId: "t",
      prompt: "p",
      enqueuedAt: "2026-01-01T00:00:00.000Z",
      forwardCount: MAX_TEAM_TASK_FORWARDS,
    };
    // White-box: the guard lives on the drain step; drive it directly with a
    // task that has already used up its forward budget. Bind `this` explicitly —
    // destructuring the cast method would unbind it.
    const drain = (
      dispatcher as unknown as {
        dispatchTask: (
          team: Team,
          workspaces: Workspace[],
          task: QueuedTeamTask,
          base: TeamDispatchBase,
        ) => Promise<unknown>;
      }
    ).dispatchTask.bind(dispatcher);
    await expect(drain(teamRecord, WORKSPACES, task, { ...BASE, prompt: "p" })).rejects.toThrow(
      /max forwards exceeded/,
    );
    const lastRun = runs[runs.length - 1];
    expect(lastRun?.status).toBe("failed");
    expect(lastRun?.finishedAt).toBeTruthy();
  });

  it("dispatches normally while the forward budget lasts", async () => {
    const { dispatcher, statuses } = makeFixture([team("t", "round-robin", ["w-doc"])]);
    for (let i = 0; i < MAX_TEAM_TASK_FORWARDS; i += 1) {
      const result = await dispatcher.dispatchTeamTask({ teamId: "t", prompt: `f${i}`, ...BASE });
      expect(result.targets[0]?.status).toBe("spawned");
      // The employee runs one thread at a time: settle before the next dispatch.
      statuses.set("thread-w-doc", "finished");
      dispatcher.observeThreadEvent("thread-w-doc");
    }
  });
});

describe("TeamDispatcher — member thread summary", () => {
  it("surfaces spawned member threads with live status from the injected source", async () => {
    const runs: TeamRunChange[] = [];
    const dispatcher = new TeamDispatcher({
      readTeams: () => ({
        teams: [team("t", "free-for-all", ["w-doc", "w-test"])],
        workspaces: WORKSPACES,
      }),
      spawnMemberThread: async (request) => `thread-${request.workspace.id}`,
      recordTeamRun: async (change) => {
        runs.push(change);
      },
      readMemberThreadStatus: (threadId) => (threadId === "thread-w-doc" ? "completed" : undefined),
    });
    await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "x", ...BASE });
    const snapshot = dispatcher.startTeam({ teamId: "t" });
    expect(snapshot.memberThreads).toEqual([
      { workspaceId: "w-doc", threadId: "thread-w-doc", status: "completed" },
      { workspaceId: "w-test", threadId: "thread-w-test" },
    ]);
  });

  it("degrades to empty memberThreads when no status source is wired", () => {
    const { dispatcher } = makeFixture([team("t", "round-robin", ["w-doc"])]);
    const snapshot = dispatcher.startTeam({ teamId: "t" });
    expect(snapshot.memberThreads).toEqual([]);
  });
});

describe("TeamDispatcher — terminal run watcher", () => {
  it("does not update the run while any member thread is still active", async () => {
    const runs: TeamRunChange[] = [];
    const statuses = new Map<string, string>([
      ["thread-w-doc", "finished"],
      ["thread-w-test", "working"],
    ]);
    const dispatcher = new TeamDispatcher({
      readTeams: () => ({
        teams: [team("t", "free-for-all", ["w-doc", "w-test"])],
        workspaces: WORKSPACES,
      }),
      spawnMemberThread: async (request) => `thread-${request.workspace.id}`,
      recordTeamRun: async (change) => {
        runs.push(change);
      },
      readMemberThreadStatus: (threadId) => statuses.get(threadId),
    });
    await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "x", ...BASE });
    dispatcher.observeThreadEvent("thread-w-doc");
    dispatcher.observeThreadEvent("thread-w-test");
    // One member still working → the run must not settle.
    expect(runs.filter((row) => row.status !== "running")).toHaveLength(0);
  });

  it("flips the run to completed with finishedAt once every member thread settles", async () => {
    const runs: TeamRunChange[] = [];
    const statuses = new Map<string, string>([
      ["thread-w-doc", "finished"],
      ["thread-w-test", "finished"],
    ]);
    const dispatcher = new TeamDispatcher({
      readTeams: () => ({
        teams: [team("t", "free-for-all", ["w-doc", "w-test"])],
        workspaces: WORKSPACES,
      }),
      spawnMemberThread: async (request) => `thread-${request.workspace.id}`,
      recordTeamRun: async (change) => {
        runs.push(change);
      },
      readMemberThreadStatus: (threadId) => statuses.get(threadId),
    });
    const result = await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "x", ...BASE });
    dispatcher.observeThreadEvent("thread-w-doc");
    const settled = runs.find((row) => row.status === "completed");
    expect(settled?.id).toBe(result.taskId);
    expect(settled?.finishedAt).toBeTruthy();
  });

  it("flips the run to failed when any member thread errors", async () => {
    const runs: TeamRunChange[] = [];
    const statuses = new Map<string, string>([
      ["thread-w-doc", "finished"],
      ["thread-w-test", "error"],
    ]);
    const dispatcher = new TeamDispatcher({
      readTeams: () => ({
        teams: [team("t", "free-for-all", ["w-doc", "w-test"])],
        workspaces: WORKSPACES,
      }),
      spawnMemberThread: async (request) => `thread-${request.workspace.id}`,
      recordTeamRun: async (change) => {
        runs.push(change);
      },
      readMemberThreadStatus: (threadId) => statuses.get(threadId),
    });
    const result = await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "x", ...BASE });
    dispatcher.observeThreadEvent("thread-w-test");
    const settled = runs.find((row) => row.status === "failed");
    expect(settled?.id).toBe(result.taskId);
    expect(settled?.finishedAt).toBeTruthy();
  });

  it("drops the run from tracking once settled (no duplicate updates)", async () => {
    const runs: TeamRunChange[] = [];
    const statuses = new Map<string, string>([["thread-w-doc", "finished"]]);
    const dispatcher = new TeamDispatcher({
      readTeams: () => ({
        teams: [team("t", "round-robin", ["w-doc"])],
        workspaces: WORKSPACES,
      }),
      spawnMemberThread: async (request) => `thread-${request.workspace.id}`,
      recordTeamRun: async (change) => {
        runs.push(change);
      },
      readMemberThreadStatus: (threadId) => statuses.get(threadId),
    });
    await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "x", ...BASE });
    dispatcher.observeThreadEvent("thread-w-doc");
    dispatcher.observeThreadEvent("thread-w-doc");
    expect(runs.filter((row) => row.status === "completed")).toHaveLength(1);
  });

  it("degrades without a status source: never settles, never crashes", async () => {
    const runs: TeamRunChange[] = [];
    const dispatcher = new TeamDispatcher({
      readTeams: () => ({
        teams: [team("t", "round-robin", ["w-doc"])],
        workspaces: WORKSPACES,
      }),
      spawnMemberThread: async (request) => `thread-${request.workspace.id}`,
      recordTeamRun: async (change) => {
        runs.push(change);
      },
    });
    await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "x", ...BASE });
    expect(() => dispatcher.observeThreadEvent("thread-w-doc")).not.toThrow();
    expect(runs.filter((row) => row.status !== "running")).toHaveLength(0);
  });
});

describe("employee-level serial queue", () => {
  interface SerialFixture {
    dispatcher: TeamDispatcher;
    spawns: TeamSpawnRequest[];
    statuses: Map<string, string>;
  }

  function makeSerialFixture(members: string[]): SerialFixture {
    const spawns: TeamSpawnRequest[] = [];
    const statuses = new Map<string, string>();
    const deps: TeamDispatcherDeps = {
      readTeams: () => ({
        teams: [team("t", "free-for-all", members)],
        workspaces: WORKSPACES,
      }),
      spawnMemberThread: async (request) => {
        spawns.push(request);
        return `thread-${request.workspace.id}`;
      },
      readMemberThreadStatus: (threadId) => statuses.get(threadId),
    };
    return { dispatcher: new TeamDispatcher(deps), spawns, statuses };
  }

  it("designer-1 never takes a second concurrent task while busy", async () => {
    const { dispatcher, spawns, statuses } = makeSerialFixture(["w-doc"]);
    await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "项目甲", ...BASE });
    expect(spawns).toHaveLength(1);

    // A second project's task arrives while designer-1 is running → parked, not spawned.
    const second = await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "项目乙", ...BASE });
    expect(spawns).toHaveLength(1);
    expect(second.targets[0]?.status).toBe("queued");

    // The running thread settles → designer-1 frees and the parked task auto-dispatches.
    statuses.set("thread-w-doc", "finished");
    dispatcher.observeThreadEvent("thread-w-doc");
    expect(spawns).toHaveLength(2);
    expect(spawns[1]?.task.prompt).toBe("项目乙");
  });

  it("queued tasks release in arrival order", async () => {
    const { dispatcher, spawns, statuses } = makeSerialFixture(["w-doc"]);
    await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "甲", ...BASE });
    statuses.set("thread-w-doc", "working");

    await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "乙", ...BASE });
    await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "丙", ...BASE });
    statuses.set("thread-w-doc", "finished");
    dispatcher.observeThreadEvent("thread-w-doc");
    expect(spawns).toHaveLength(2);
    expect(spawns[1]?.task.prompt).toBe("乙");
  });

  it("different employees never block each other", async () => {
    const { dispatcher, spawns } = makeSerialFixture(["w-doc", "w-test"]);
    await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "甲", ...BASE });
    expect(spawns.map((entry) => entry.workspace.id).sort()).toEqual(["w-doc", "w-test"]);

    // Both employees busy; a second task parks on both lines but spawns nothing.
    const second = await dispatcher.dispatchTeamTask({ teamId: "t", prompt: "乙", ...BASE });
    expect(spawns).toHaveLength(2);
    expect(second.targets.every((entry) => entry.status === "queued")).toBe(true);
  });
});

describe("EmployeeTaskQueue deadline ordering", () => {
  const baseEntry = {
    employeeId: "w-doc",
    teamId: "t",
    prompt: "p",
    projectLocation: BASE.projectLocation,
    config: BASE.config,
    initialSize: BASE.initialSize,
  };

  it("earliest deadline pops first; no deadline goes last", () => {
    const queue = new EmployeeTaskQueue();
    queue.markBusy("w-doc", { ...baseEntry, enqueuedAt: "2026-01-01T00:00:00Z" });
    queue.enqueue("w-doc", {
      ...baseEntry,
      enqueuedAt: "2026-01-01T01:00:00Z",
      deadline: "2026-01-10",
    });
    queue.enqueue("w-doc", {
      ...baseEntry,
      enqueuedAt: "2026-01-01T02:00:00Z",
      deadline: "2026-01-05",
    });
    expect(queue.markIdle("w-doc")?.deadline).toBe("2026-01-05");
    expect(queue.markIdle("w-doc")?.deadline).toBe("2026-01-10");
    expect(queue.markIdle("w-doc")?.deadline).toBeUndefined();
  });

  it("snapshot exposes busy state, currentTask, queue with deadline", () => {
    const queue = new EmployeeTaskQueue();
    queue.markBusy("w-doc", { ...baseEntry, enqueuedAt: "2026-01-01T00:00:00Z", prompt: "甲" });
    queue.enqueue("w-doc", {
      ...baseEntry,
      enqueuedAt: "2026-01-01T01:00:00Z",
      prompt: "乙",
      deadline: "2026-02-01",
    });
    const snapshot = queue.snapshot();
    expect(snapshot.employees).toHaveLength(1);
    const entry = snapshot.employees[0]!;
    expect(entry.busy).toBe(true);
    expect(entry.currentTask).toEqual({ prompt: "甲" });
    expect(entry.queue).toEqual([
      { prompt: "乙", enqueuedAt: "2026-01-01T01:00:00Z", deadline: "2026-02-01" },
    ]);
    // No stale ids: an idle employee with an empty line disappears.
    queue.markIdle("w-doc");
    expect(queue.snapshot().employees).toHaveLength(0);
  });
});

describe("deadline passthrough end-to-end", () => {
  it("two same-employee dispatches with deadlines pop earlier-deadline first", async () => {
    const spawns: TeamSpawnRequest[] = [];
    const statuses = new Map<string, string>();
    const snapshots: unknown[] = [];
    const dispatcher = new TeamDispatcher({
      readTeams: () => ({
        teams: [team("t", "round-robin", ["w-doc"])],
        workspaces: WORKSPACES,
      }),
      spawnMemberThread: async (request) => {
        spawns.push(request);
        return `thread-${request.workspace.id}-${spawns.length}`;
      },
      readMemberThreadStatus: (threadId) => statuses.get(threadId),
      onQueueSnapshot: (snapshot) => snapshots.push(snapshot),
    });
    await dispatcher.dispatchTeamTask({
      teamId: "t",
      prompt: "急",
      ...BASE,
      deadline: "2026-01-05",
    });
    statuses.set("thread-w-doc-1", "working");
    await dispatcher.dispatchTeamTask({
      teamId: "t",
      prompt: "缓",
      ...BASE,
      deadline: "2026-01-20",
    });
    await dispatcher.dispatchTeamTask({
      teamId: "t",
      prompt: "中",
      ...BASE,
      deadline: "2026-01-10",
    });
    // Still only one live thread; the other two are parked.
    expect(spawns).toHaveLength(1);
    statuses.set("thread-w-doc-1", "finished");
    dispatcher.observeThreadEvent("thread-w-doc-1");
    expect(spawns).toHaveLength(2);
    expect(spawns[1]?.task.prompt).toBe("中");
    // Snapshot events were emitted at every state change.
    expect(snapshots.length).toBeGreaterThan(0);
  });
});
