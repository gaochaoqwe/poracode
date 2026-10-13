// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task, TaskDraft } from "@/shared/contracts";

const bridge = vi.hoisted(() => ({
  getTasks: vi.fn<() => Promise<Task[]>>(),
  createTask: vi.fn<(input: unknown) => Promise<Task>>(),
  updateTask: vi.fn<() => Promise<Task>>(),
  deleteTask: vi.fn<() => Promise<void>>(),
  startTask: vi.fn<(payload: { id: string }) => Promise<Task>>(),
  stopTask: vi.fn<(payload: { id: string }) => Promise<Task>>(),
  setTaskStatus: vi.fn<() => Promise<Task>>(),
  getTaskRuns: vi.fn<() => Promise<unknown[]>>(async () => []),
  getTaskDrafts: vi.fn<() => Promise<TaskDraft[]>>(async () => []),
  createTaskDraft: vi.fn<(input: unknown) => Promise<TaskDraft>>(),
  updateTaskDraft: vi.fn<() => Promise<TaskDraft>>(),
  deleteTaskDraft: vi.fn<() => Promise<void>>(async () => undefined),
  reorderTaskDrafts: vi.fn<() => Promise<TaskDraft[]>>(async () => []),
  getGitStatus: vi.fn<() => Promise<{ isRepo: boolean }>>(async () => ({ isRepo: true })),
  onSupervisorEvent: vi.fn<() => () => void>(() => () => undefined),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridge,
  isRemoteSession: () => false,
}));

vi.mock("@/renderer/actions/threadActions", () => ({
  openThread: vi.fn<() => void>(),
}));

vi.mock("@/renderer/actions/worktreeActions", () => ({
  performWorktreeRemoval: vi.fn<() => Promise<boolean>>(async () => true),
}));

import { TasksView } from "./TasksView";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useTaskDraftsStore } from "@/renderer/state/taskDraftsStore";
import { useTasksStore } from "@/renderer/state/tasksStore";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Refactor auth",
    prompt: "Split the auth module.",
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

describe("TasksView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.getTaskDrafts.mockResolvedValue([]);
    useTasksStore.setState({ tasks: [], loading: true });
    useTaskDraftsStore.setState({ drafts: [], loading: true });
    useSharedSettings.setState({ showTaskDraftColumn: true });
  });

  it("renders the empty state when there are no tasks", async () => {
    bridge.getTasks.mockResolvedValue([]);
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText("No tasks yet")).toBeTruthy());
  });

  it("files a waiting run and a failure under 'Needs you'", async () => {
    bridge.getTasks.mockResolvedValue([
      task({
        id: "11111111-1111-4111-8111-111111111111",
        title: "Waiting on you",
        status: "awaiting_input",
      }),
      task({
        id: "22222222-2222-4222-8222-222222222222",
        title: "Broke",
        status: "failed",
        lastError: "boom",
      }),
    ]);
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText("Waiting on you")).toBeTruthy());
    expect(screen.getByText("Broke")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Needs you" })).toBeTruthy();
  });

  it("groups tasks into their lanes", async () => {
    bridge.getTasks.mockResolvedValue([
      task({ id: "11111111-1111-4111-8111-111111111111", title: "Waiting", status: "todo" }),
      task({
        id: "22222222-2222-4222-8222-222222222222",
        title: "Running",
        status: "in_progress",
      }),
      task({
        id: "33333333-3333-4333-8333-333333333333",
        title: "Finished",
        status: "done",
      }),
    ]);
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText("Waiting")).toBeTruthy());
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Finished")).toBeTruthy();
  });

  it("starts a task and refreshes the board", async () => {
    const todo = task();
    bridge.getTasks.mockResolvedValue([todo]);
    bridge.startTask.mockResolvedValue({ ...todo, status: "in_progress" });
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText("Refactor auth")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(bridge.startTask).toHaveBeenCalledWith({ id: "11111111-1111-4111-8111-111111111111" }),
    );
  });

  it("filters the board to one project", async () => {
    useAppStore.setState({
      projects: [
        {
          id: "p1",
          name: "Alpha",
          location: { kind: "posix", path: "/alpha" },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "p2",
          name: "Beta",
          location: { kind: "posix", path: "/beta" },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } as never);
    bridge.getTasks.mockResolvedValue([
      task({ id: "11111111-1111-4111-8111-111111111111", title: "In Alpha", projectId: "p1" }),
      task({ id: "22222222-2222-4222-8222-222222222222", title: "In Beta", projectId: "p2" }),
    ]);
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText("In Beta")).toBeTruthy());
    expect(screen.getByText("In Alpha")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Filter by project"));
    fireEvent.click(await screen.findByRole("option", { name: "Alpha" }));

    await waitFor(() => expect(screen.queryByText("In Beta")).toBeNull());
    expect(screen.getByText("In Alpha")).toBeTruthy();
  });

  it("pre-fills a new task from the filtered project", async () => {
    useAppStore.setState({
      projects: [
        {
          id: "p1",
          name: "Alpha",
          location: { kind: "posix", path: "/alpha" },
          taskSettings: { isolation: "project" },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } as never);
    bridge.getTasks.mockResolvedValue([
      task({ id: "11111111-1111-4111-8111-111111111111", title: "In Alpha", projectId: "p1" }),
    ]);
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText("In Alpha")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Filter by project"));
    fireEvent.click(await screen.findByRole("option", { name: "Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "New task" }));

    const projectSelect = await screen.findByLabelText("Project");
    expect(projectSelect).toHaveTextContent("Alpha");
  });

  it("shows the draft lane by default and hides it on toggle", async () => {
    bridge.getTasks.mockResolvedValue([task({ title: "A task" })]);
    bridge.getTaskDrafts.mockResolvedValue([draft({ title: "Parked idea" })]);
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText("Parked idea")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Show drafts" }));
    await waitFor(() => expect(screen.queryByText("Parked idea")).toBeNull());
  });

  it("promotes a draft into a task editor pre-filled with its idea", async () => {
    useSharedSettings.setState({ showTaskDraftColumn: true });
    bridge.getTasks.mockResolvedValue([task({ title: "A task" })]);
    bridge.getTaskDrafts.mockResolvedValue([draft({ title: "Parked idea", note: "Some detail" })]);
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText("Parked idea")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Turn into task" }));

    // The task editor opens with the draft's title and note carried over.
    expect(await screen.findByDisplayValue("Parked idea")).toBeTruthy();
    expect(screen.getByDisplayValue("Some detail")).toBeTruthy();
  });

  it("groups a running lane into category sections", async () => {
    bridge.getTasks.mockResolvedValue([
      task({
        id: "11111111-1111-4111-8111-111111111111",
        title: "Bill the account",
        status: "in_progress",
        category: "Billing",
      }),
      task({
        id: "22222222-2222-4222-8222-222222222222",
        title: "Fix the login",
        status: "in_progress",
        category: "Auth",
      }),
      task({
        id: "33333333-3333-4333-8333-333333333333",
        title: "Unfiled work",
        status: "in_progress",
        category: null,
      }),
    ]);
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText("Bill the account")).toBeTruthy());

    // Categories render as section headings, uncategorized tray last.
    expect(screen.getAllByText("Billing").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Auth").length).toBeGreaterThan(0);
    expect(screen.getByText("Uncategorized")).toBeTruthy();
    // Each category nests its projects; none of these tasks has one, so Home.
    expect(screen.getAllByText("Home")).toHaveLength(3);
  });

  it("groups the Todo lane by category too", async () => {
    bridge.getTasks.mockResolvedValue([
      task({
        id: "11111111-1111-4111-8111-111111111111",
        title: "Bill the account",
        status: "todo",
        category: "Billing",
      }),
      task({
        id: "22222222-2222-4222-8222-222222222222",
        title: "Fix the login",
        status: "todo",
        category: "Auth",
      }),
    ]);
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText("Bill the account")).toBeTruthy());

    // Both categories head the Todo lane, not just the running lanes.
    expect(screen.getAllByText("Billing").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Auth").length).toBeGreaterThan(0);
  });

  it("collapses a category group to hide its cards", async () => {
    bridge.getTasks.mockResolvedValue([
      task({
        id: "11111111-1111-4111-8111-111111111111",
        title: "Bill the account",
        status: "todo",
        category: "Billing",
      }),
    ]);
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText("Bill the account")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Billing/ }));

    await waitFor(() => expect(screen.queryByText("Bill the account")).toBeNull());
  });

  it("shows a task's category on its card", async () => {
    bridge.getTasks.mockResolvedValue([
      task({ title: "Refactor auth", status: "todo", category: "Auth" }),
    ]);
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText("Refactor auth")).toBeTruthy());
    expect(screen.getAllByText("Auth").length).toBeGreaterThan(0);
  });

  it("lets the lanes shrink instead of overflowing a narrow window", async () => {
    bridge.getTasks.mockResolvedValue([task({ title: "Narrow window task" })]);
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText("Narrow window task")).toBeTruthy());

    // Regression: lanes must not pin a fixed min-width. Grid tracks default to
    // a min-content floor, so `min-w-[18rem]` held every lane at 288px and the
    // board overflowed once the window was narrower than columns x 288px. The
    // tracks need an explicit 0 floor for the lanes to collapse instead.
    const board = document.querySelector(".grid");
    expect(board?.className).toContain("minmax(0,1fr)");
    expect(document.querySelector("[class*='min-w-[18rem]']")).toBeNull();
  });
});

function draft(overrides: Partial<TaskDraft> = {}): TaskDraft {
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
