import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Project, Thread, Workspace } from "@/shared/contracts";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useThreadFollowUpQueueStore } from "@/renderer/state/threadFollowUpQueueStore";
import {
  useEmployeeQueueSnapshotStore,
  type EmployeeQueueSnapshot,
} from "@/renderer/state/employeeQueueSnapshotStore";
import { buildScheduleRows, buildScheduleRowsFromSnapshot, SchedulePanel } from "./SchedulePanel";

function thread(id: string, projectId: string, status: Thread["status"]): Thread {
  return {
    id,
    projectId,
    title: `Thread ${id}`,
    status,
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
  } as Thread;
}

const projects: Project[] = [{ id: "proj-1", name: "Code", workspaceId: "ws-coder" } as Project];

describe("buildScheduleRows", () => {
  it("marks busy employees from live threads, reads the queue, sorts busy first", () => {
    const employees = [
      { id: "ws-coder", name: "Coder" },
      { id: "ws-tester", name: "Tester" },
    ];
    const threads = [thread("t1", "proj-1", "working")];
    const queueByThread = {
      t1: {
        queue: {
          items: [
            { id: "q1", prompt: "next", stagedAt: 1 },
            { id: "q2", prompt: "then", stagedAt: 2 },
          ],
          paused: false,
        },
      },
    };
    const rows = buildScheduleRows(employees, threads, projects, {}, queueByThread as never);
    expect(rows.map((r) => r.workspaceId)).toEqual(["ws-coder", "ws-tester"]);
    expect(rows[0]!.busy).toBe(true);
    expect(rows[0]!.queuedCount).toBe(2);
    expect(rows[1]!.busy).toBe(false);
    expect(rows[1]!.queuedCount).toBe(0);
  });

  it("degrades queuedCount to 0 when no supervisor snapshot exists", () => {
    const rows = buildScheduleRows(
      [{ id: "ws-coder", name: "Coder" }],
      [thread("t1", "proj-1", "working")],
      projects,
      {},
      {},
    );
    expect(rows[0]!.busy).toBe(true);
    expect(rows[0]!.queuedCount).toBe(0);
  });
});

describe("SchedulePanel", () => {
  beforeEach(() => {
    useThreadFollowUpQueueStore.setState({ byThread: {} });
    useAppStore.setState({
      threads: [thread("t1", "proj-1", "working")],
      projects,
      runtimeContextByThread: {},
    });
    useSharedSettings.setState({
      workspaces: [
        {
          id: "ws-coder",
          name: "Coder",
          icon: "code",
          createdAt: "2026-10-11T00:00:00.000Z",
          roleRank: 1,
        },
        {
          id: "ws-tester",
          name: "Tester",
          icon: "code",
          createdAt: "2026-10-11T00:00:00.000Z",
          roleRank: 2,
        },
      ] as Workspace[],
      teams: [],
    });
  });

  it("lists employees with busy first and an idle row", () => {
    render(<SchedulePanel />);
    expect(screen.getByText("Coder")).toBeInTheDocument();
    expect(screen.getByText("Tester")).toBeInTheDocument();
    // Busy coder carries the running thread title; tester shows idle.
    expect(screen.getByText("Thread t1")).toBeInTheDocument();
  });
});

describe("SchedulePanel — authoritative queue snapshot", () => {
  const snapshot: EmployeeQueueSnapshot = {
    updatedAt: "2026-10-11T00:00:01.000Z",
    employees: [
      {
        employeeId: "ws-tester",
        busy: false,
        queue: [],
      },
      {
        employeeId: "ws-coder",
        busy: true,
        currentTask: { prompt: "refactor auth", projectName: "Code" },
        queue: [
          { prompt: "write tests", projectName: "Code", deadline: "16:00" },
          { prompt: "fix bug", projectName: "Code" },
        ],
      },
    ],
  };

  beforeEach(() => {
    useEmployeeQueueSnapshotStore.setState({ snapshot: null });
    useThreadFollowUpQueueStore.setState({ byThread: {} });
    useAppStore.setState({ threads: [], projects: [], runtimeContextByThread: {} });
    useSharedSettings.setState({
      workspaces: [
        {
          id: "ws-coder",
          name: "Coder",
          icon: "code",
          createdAt: "2026-10-11T00:00:00.000Z",
          roleRank: 1,
        },
        {
          id: "ws-tester",
          name: "Tester",
          icon: "code",
          createdAt: "2026-10-11T00:00:00.000Z",
          roleRank: 2,
        },
      ] as Workspace[],
      teams: [],
    });
  });

  it("buildScheduleRowsFromSnapshot resolves names, busy, queue count and deadline", () => {
    const rows = buildScheduleRowsFromSnapshot(
      snapshot,
      new Map([
        ["ws-coder", { name: "Coder" }],
        ["ws-tester", { name: "Tester" }],
      ]),
    );
    expect(rows.map((r) => r.workspaceId)).toEqual(["ws-coder", "ws-tester"]);
    expect(rows[0]!.busy).toBe(true);
    expect(rows[0]!.activeThreadTitle).toBe("refactor auth");
    expect(rows[0]!.queuedCount).toBe(2);
    expect(rows[0]!.deadline).toBe("16:00");
  });

  it("renders authoritative rows when a snapshot has arrived", () => {
    useEmployeeQueueSnapshotStore.setState({ snapshot });
    render(<SchedulePanel />);
    // Coder busy with current task prompt + queue badge + deadline.
    expect(screen.getByText("refactor auth")).toBeInTheDocument();
    expect(screen.getByText("queue: 2")).toBeInTheDocument();
    expect(screen.getByText("16:00")).toBeInTheDocument();
    // Honest footer switches to authoritative.
    expect(screen.getByText("Authoritative supervisor queue snapshot")).toBeInTheDocument();
  });

  it("falls back to observed threads when no snapshot has arrived", () => {
    render(<SchedulePanel />);
    expect(
      screen.getByText("Authoritative supervisor queue pending channel; shows observed threads."),
    ).toBeInTheDocument();
  });
});
