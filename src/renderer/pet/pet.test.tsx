import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useTasksStore } from "@/renderer/state/tasksStore";
import type { Task, Thread } from "@/shared/contracts";

const { bridge } = vi.hoisted(() => ({
  bridge: {
    windowKind: "pet" as const,
    petNavigateMain: vi.fn<(payload: { target: "home" | "tasks" | "office" }) => Promise<void>>(),
    petSetCollapsed: vi
      .fn<(payload: { collapsed: boolean }) => Promise<void>>()
      .mockResolvedValue(undefined),
    petMoveBall: vi
      .fn<(payload: { dx: number; dy: number }) => Promise<void>>()
      .mockResolvedValue(undefined),
    petHideBall: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    petShowBallMenu: vi
      .fn<(payload: { expandLabel: string; hideLabel: string }) => Promise<void>>()
      .mockResolvedValue(undefined),
    onPetBallMenuAction: vi.fn<(listener: (event: { action: "expand" | "hide" }) => void) => void>(
      () => undefined,
    ),
    sendThreadInput: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    startThread: vi
      .fn<() => Promise<{ threadId: string }>>()
      .mockResolvedValue({ threadId: "new" }),
    getTasks: vi.fn<() => Promise<Task[]>>().mockResolvedValue([]),
    createTask: vi.fn<(input: unknown) => Promise<Task>>(),
    onSupervisorEvent: vi.fn<() => () => undefined>(),
    getThreadSnapshots: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
  },
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridge,
  // The shared Select renders a mobile drawer on remote sessions; the pet test
  // runs the desktop branch.
  isRemoteSession: () => false,
}));

vi.mock("@/renderer/hooks/useAppHydration", () => ({
  useAppHydration: () => ({
    initialLoading: false,
    runtimeSnapshotsReady: true,
    storeHydrated: true,
    loadT0: 0,
  }),
}));

import { PetApp } from "./PetApp";
import { PetAvatar } from "./PetAvatar";
import { readPetCollapsedPreference } from "./petCollapsed";
import { PET_STYLE_IDS, readPetStylePreference, writePetStylePreference } from "./petStyles";
import {
  buildPetTranscript,
  buildDeliveryPrompt,
  derivePetTaskTitle,
  findChiefStewardThread,
  newPetTaskForm,
  petTaskFormInput,
  petTaskFormIsValid,
} from "./petConversation";

function chiefThread(id: string, workspaceId: string, status: Thread["status"]): Thread {
  return {
    id,
    projectId: "__lightcode_home__",
    workspaceId,
    status,
    config: { model: "test-model" },
    createdAt: "2026-01-01T00:00:00.000Z",
  } as Thread;
}

describe("pet style preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to sphere", () => {
    expect(readPetStylePreference()).toBe("sphere");
  });

  it("persists the picked style", () => {
    writePetStylePreference("owl");
    expect(readPetStylePreference()).toBe("owl");
  });

  it("ignores corrupt stored values", () => {
    window.localStorage.setItem("agentemployee-pet-style", "bogus");
    expect(readPetStylePreference()).toBe("sphere");
  });
});

describe("chief steward thread selection", () => {
  it("finds the live non-archived thread in the workspace", () => {
    const threads = [chiefThread("a", "ws-chief", "idle"), chiefThread("b", "ws-other", "working")];
    expect(findChiefStewardThread(threads, "ws-chief")?.id).toBe("a");
  });

  it("returns nothing when no workspace is configured", () => {
    expect(
      findChiefStewardThread([chiefThread("a", "ws-chief", "idle")], undefined),
    ).toBeUndefined();
  });

  it("ignores archived threads", () => {
    const archived = { ...chiefThread("a", "ws-chief", "finished"), archived: true };
    expect(findChiefStewardThread([archived], "ws-chief")).toBeUndefined();
  });
});

describe("transcript extraction", () => {
  it("renders user + assistant text rows in order", () => {
    const items = {
      u1: {
        id: "u1",
        type: "user_message",
        state: "completed",
        streams: {},
        payload: { content: [{ kind: "text", text: "hello" }] },
      },
      a1: {
        id: "a1",
        type: "assistant_message",
        state: "completed",
        streams: { assistant_text: "hi there" },
        payload: undefined,
      },
    } as const;
    const entries = buildPetTranscript(["u1", "a1"], items);
    expect(entries).toEqual([
      { id: "u1", role: "user", text: "hello" },
      { id: "a1", role: "assistant", text: "hi there" },
    ]);
  });
});

describe("pet avatar sprites", () => {
  it("draws a pixel sprite on a square grid for every style", () => {
    for (const styleId of PET_STYLE_IDS) {
      const { container, unmount } = render(<PetAvatar styleId={styleId} size={48} />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      const [width, height] = (svg?.getAttribute("viewBox") ?? "").split(" ").slice(2);
      // One SVG unit == one pixel-art cell, so the grid stays square and the
      // sprite never stretches.
      expect(width).toBe(height);
      // Pixel art must not be smoothed by the renderer.
      expect(svg?.getAttribute("shape-rendering")).toBe("crispEdges");
      expect(container.querySelectorAll("rect").length).toBeGreaterThan(40);
      unmount();
    }
  });

  it("gives each style its own sprite rather than a shared placeholder", () => {
    const shapeFor = (styleId: (typeof PET_STYLE_IDS)[number]) => {
      const { container, unmount } = render(<PetAvatar styleId={styleId} size={48} />);
      const className = container.querySelector("svg")?.getAttribute("class");
      unmount();
      return className;
    };
    const classes = PET_STYLE_IDS.map(shapeFor);
    expect(new Set(classes).size).toBe(PET_STYLE_IDS.length);
  });
});

describe("delivery prompt envelope", () => {
  it("prefixes the source token onto pasted content", () => {
    expect(buildDeliveryPrompt("oa", "  fix the login bug  ")).toBe(
      "[task-delivery source=oa]\nfix the login bug",
    );
  });
});

describe("pet quick-create task", () => {
  const employees = new Map([
    ["ws-worker", { agentKind: "codex", model: "gpt-5.6", effort: "high", fast: false }],
  ]);

  it("derives a title from the first non-empty line of the paste", () => {
    expect(derivePetTaskTitle("\n\n  prepare Q3 numbers \nmore detail")).toBe("prepare Q3 numbers");
    expect(derivePetTaskTitle("   \n  ")).toBe("");
  });

  it("caps the derived title at the contract limit", () => {
    expect(derivePetTaskTitle("x".repeat(200))).toHaveLength(120);
  });

  it("builds a one-off task bound to the chosen employee", () => {
    const input = petTaskFormInput(
      {
        title: "  Ship it  ",
        category: "  Billing ",
        prompt: "  Do the thing  ",
        employeeId: "ws-worker",
      },
      employees,
    );

    expect(input).toEqual({
      title: "Ship it",
      prompt: "Do the thing",
      employeeId: "ws-worker",
      agentKind: "codex",
      config: { model: "gpt-5.6", effort: "high" },
      category: "Billing",
      projectId: null,
      isolation: "project",
      recurrence: null,
      scheduleEnabled: false,
    });
  });

  it("refuses a form without a title, work, or resolvable employee", () => {
    const base = newPetTaskForm("ws-worker");
    expect(petTaskFormIsValid({ ...base, title: "x", prompt: "y" }, employees)).toBe(true);
    expect(petTaskFormIsValid({ ...base, title: "  ", prompt: "y" }, employees)).toBe(false);
    expect(petTaskFormIsValid({ ...base, title: "x", prompt: " " }, employees)).toBe(false);
    expect(petTaskFormIsValid({ ...base, title: "x", prompt: "y" }, new Map())).toBe(false);
    expect(petTaskFormInput({ ...base, title: "x", prompt: "y" }, new Map())).toBeNull();
  });
});

describe("PetApp", () => {
  beforeEach(() => {
    window.localStorage.clear();
    bridge.petNavigateMain.mockClear();
    bridge.petSetCollapsed.mockClear();
    bridge.petMoveBall.mockClear();
    bridge.petHideBall.mockClear();
    bridge.petShowBallMenu.mockClear();
    bridge.onPetBallMenuAction.mockClear();
    bridge.sendThreadInput.mockClear();
    bridge.startThread.mockClear();
    bridge.getTasks.mockClear();
    bridge.createTask.mockReset();
    bridge.createTask.mockResolvedValue({ id: "task-1", title: "created" } as Task);
    useAppStore.setState({ threads: [], projects: [] });
    useSharedSettings.setState({
      // The chief steward chats; a second, runnable employee is who tasks are
      // actually handed to (the panel defaults to the first runnable one).
      workspaces: [
        { id: "ws-chief", name: "Chief" },
        {
          id: "ws-worker",
          name: "Worker",
          agentKind: "codex",
          defaultThreadConfig: { model: "gpt-5.6" },
        },
      ],
      chiefStewardWorkspaceId: "ws-chief",
    } as Partial<ReturnType<typeof useSharedSettings.getState>>);
    useTasksStore.setState({ tasks: [], loading: false });
  });

  it("navigates main when a nav button is pressed", async () => {
    render(<PetApp />);
    fireEvent.click(await screen.findByRole("button", { name: /Tasks/i }));
    await waitFor(() => expect(bridge.petNavigateMain).toHaveBeenCalledWith({ target: "tasks" }));
  });

  it("does not render the task board list inside the pet window", () => {
    useTasksStore.setState({
      tasks: [
        { id: "t1", title: "Write release notes", status: "in_progress" },
        { id: "t2", title: "Background cleanup", status: "todo" },
      ] as Task[],
      loading: false,
    });
    render(<PetApp />);
    expect(screen.queryByText("Write release notes")).not.toBeInTheDocument();
    expect(screen.queryByText("Background cleanup")).not.toBeInTheDocument();
  });

  it("switches and persists the pet style", () => {
    render(<PetApp />);
    const options = document.querySelectorAll(".pet-style-option");
    expect(options.length).toBe(PET_STYLE_IDS.length);
    fireEvent.click(options[2]!);
    expect(readPetStylePreference()).toBe("owl");
  });

  it("sends a follow-up to the live chief thread", async () => {
    useAppStore.setState({
      threads: [chiefThread("chief-1", "ws-chief", "idle")],
      projects: [],
    });
    render(<PetApp />);
    const input = screen.getByLabelText(/Message the chief steward/i);
    fireEvent.change(input, { target: { value: "status check" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));
    await waitFor(() =>
      expect(bridge.sendThreadInput).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: "chief-1", prompt: "status check" }),
      ),
    );
  });

  it("collapses into the floating ball and persists the mode", async () => {
    render(<PetApp />);
    fireEvent.click(screen.getByRole("button", { name: /Collapse into floating ball/i }));
    await waitFor(() => expect(bridge.petSetCollapsed).toHaveBeenCalledWith({ collapsed: true }));
    expect(screen.getByRole("button", { name: /Expand panel/i })).toBeInTheDocument();
    expect(readPetCollapsedPreference()).toBe(true);
  });

  it("expands back to the panel when the ball is clicked", async () => {
    window.localStorage.setItem("agentemployee-pet-collapsed", "true");
    render(<PetApp />);
    fireEvent.click(screen.getByRole("button", { name: /Expand panel/i }));
    await waitFor(() => expect(bridge.petSetCollapsed).toHaveBeenCalledWith({ collapsed: false }));
    expect(
      screen.getByRole("button", { name: /Collapse into floating ball/i }),
    ).toBeInTheDocument();
    expect(readPetCollapsedPreference()).toBe(false);
  });

  it("drags the ball with the pointer instead of restoring the panel", async () => {
    window.localStorage.setItem("agentemployee-pet-collapsed", "true");
    render(<PetApp />);
    const ball = screen.getByRole("button", { name: /Expand panel/i });

    fireEvent.mouseDown(ball, { button: 0, screenX: 100, screenY: 100 });
    fireEvent.mouseMove(document, { screenX: 130, screenY: 108 });
    fireEvent.mouseUp(document, { screenX: 130, screenY: 108 });

    await waitFor(() => expect(bridge.petMoveBall).toHaveBeenCalledWith({ dx: 30, dy: 8 }));
    expect(bridge.petSetCollapsed).not.toHaveBeenCalledWith({ collapsed: false });
    expect(screen.getByRole("button", { name: /Expand panel/i })).toBeInTheDocument();
  });

  it("restores the panel when a press stays inside the drag slop", async () => {
    window.localStorage.setItem("agentemployee-pet-collapsed", "true");
    render(<PetApp />);
    const ball = screen.getByRole("button", { name: /Expand panel/i });

    fireEvent.mouseDown(ball, { button: 0, screenX: 100, screenY: 100 });
    fireEvent.mouseMove(document, { screenX: 102, screenY: 101 });
    fireEvent.mouseUp(document, { screenX: 102, screenY: 101 });

    await waitFor(() => expect(bridge.petSetCollapsed).toHaveBeenCalledWith({ collapsed: false }));
    expect(bridge.petMoveBall).not.toHaveBeenCalled();
  });

  it("drops the click a double click replays on the restored panel", async () => {
    window.localStorage.setItem("agentemployee-pet-collapsed", "true");
    render(<PetApp />);
    const ball = screen.getByRole("button", { name: /Expand panel/i });

    fireEvent.mouseDown(ball, { button: 0, screenX: 100, screenY: 100 });
    fireEvent.mouseUp(document, { screenX: 100, screenY: 100 });
    await waitFor(() => expect(bridge.petSetCollapsed).toHaveBeenCalledWith({ collapsed: false }));

    // The ball's spot is now the panel's bottom-right corner, where its submit
    // button sits: a second click there must not land on it.
    const ghostClick = vi.fn<() => void>();
    document.body.addEventListener("click", ghostClick);
    fireEvent.click(document.body, { screenX: 100, screenY: 100 });
    document.body.removeEventListener("click", ghostClick);
    expect(ghostClick).not.toHaveBeenCalled();

    // …while a deliberate click elsewhere on the panel still works.
    const realClick = vi.fn<() => void>();
    document.body.addEventListener("click", realClick);
    fireEvent.click(document.body, { screenX: 320, screenY: 420 });
    document.body.removeEventListener("click", realClick);
    expect(realClick).toHaveBeenCalled();
  });

  it("drops the opaque document shell only while collapsed", async () => {
    window.localStorage.setItem("agentemployee-pet-collapsed", "true");
    render(<PetApp />);
    // Without this the shared index.html background paints a square around the disc.
    expect(document.documentElement.dataset.petBall).toBe("on");

    fireEvent.click(screen.getByRole("button", { name: /Expand panel/i }));
    await waitFor(() => expect(document.documentElement.dataset.petBall).toBeUndefined());
  });

  it("re-syncs main bounds when it mounts already collapsed", () => {
    window.localStorage.setItem("agentemployee-pet-collapsed", "true");
    render(<PetApp />);
    expect(bridge.petSetCollapsed).toHaveBeenCalledWith({ collapsed: true });
  });

  it("opens the native ball menu with localized labels on right-click", async () => {
    window.localStorage.setItem("agentemployee-pet-collapsed", "true");
    render(<PetApp />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Expand panel/i }));
    await waitFor(() =>
      expect(bridge.petShowBallMenu).toHaveBeenCalledWith(
        expect.objectContaining({
          expandLabel: expect.any(String),
          hideLabel: expect.any(String),
        }),
      ),
    );
  });

  it("expands when the native menu action comes back", () => {
    window.localStorage.setItem("agentemployee-pet-collapsed", "true");
    let listener: ((event: { action: "expand" | "hide" }) => void) | undefined;
    bridge.onPetBallMenuAction.mockImplementation((next) => {
      listener = next;
      return () => undefined;
    });
    render(<PetApp />);
    expect(listener).toBeDefined();
    act(() => listener!({ action: "expand" }));
    expect(
      screen.getByRole("button", { name: /Collapse into floating ball/i }),
    ).toBeInTheDocument();
    expect(readPetCollapsedPreference()).toBe(false);
  });

  it("creates a board task and notifies the chief thread with a source prefix", async () => {
    useAppStore.setState({
      threads: [chiefThread("chief-1", "ws-chief", "idle")],
      projects: [],
    });
    render(<PetApp />);
    fireEvent.click(screen.getByRole("tab", { name: /Deliver task/i }));
    fireEvent.click(screen.getByRole("button", { name: "OA" }));
    const area = screen.getByLabelText(/Task content/i);
    fireEvent.change(area, { target: { value: "prepare Q3 numbers" } });
    fireEvent.click(screen.getByRole("button", { name: /Create task/i }));

    // The card is the primary outcome, and it carries the employee's binding.
    await waitFor(() =>
      expect(bridge.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "prepare Q3 numbers",
          prompt: "prepare Q3 numbers",
          employeeId: "ws-worker",
          agentKind: "codex",
          config: expect.objectContaining({ model: "gpt-5.6" }),
          recurrence: null,
          scheduleEnabled: false,
        }),
      ),
    );
    // …and the paste still reaches the steward, tagged with its source.
    await waitFor(() =>
      expect(bridge.sendThreadInput).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "chief-1",
          prompt: "[task-delivery source=oa]\nprepare Q3 numbers",
        }),
      ),
    );
    expect(await screen.findByText("Created on the task board")).toBeInTheDocument();
  });

  it("keeps the chip that was pasted when the board create fails", async () => {
    useAppStore.setState({ threads: [chiefThread("chief-1", "ws-chief", "idle")], projects: [] });
    bridge.createTask.mockRejectedValueOnce(new Error("boom"));
    render(<PetApp />);
    fireEvent.click(screen.getByRole("tab", { name: /Deliver task/i }));
    const area = screen.getByLabelText(/Task content/i);
    fireEvent.change(area, { target: { value: "keep me" } });
    fireEvent.click(screen.getByRole("button", { name: /Create task/i }));

    // A failed create must not reach the steward and must not clear the paste.
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(bridge.sendThreadInput).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Task content/i)).toHaveValue("keep me");
  });

  it("blocks creation when no employee can run the task", async () => {
    useSharedSettings.setState({
      workspaces: [{ id: "ws-noagent", name: "Unconfigured" }],
      chiefStewardWorkspaceId: "ws-chief",
    } as Partial<ReturnType<typeof useSharedSettings.getState>>);
    render(<PetApp />);
    fireEvent.click(screen.getByRole("tab", { name: /Deliver task/i }));
    fireEvent.change(screen.getByLabelText(/Task content/i), { target: { value: "do something" } });

    expect(screen.getByRole("button", { name: /Create task/i })).toBeDisabled();
  });
});
