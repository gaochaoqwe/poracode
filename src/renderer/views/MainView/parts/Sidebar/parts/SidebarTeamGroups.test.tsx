import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Team, Thread } from "@/shared/contracts";
import { HOME_PROJECT_ID } from "@/shared/homeScope";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import { SidebarTeamGroups } from "./SidebarTeamGroups";

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({}),
}));

vi.mock("./SidebarThreadRow", () => ({
  SidebarThreadRow: (props: {
    row: { key: string; thread: { id: string; title: string } };
    project: { name: string };
  }) => (
    <div data-testid="team-thread-row">
      {props.row.thread.title} in {props.project.name}
    </div>
  ),
}));

const NOW = "2026-10-10T00:00:00.000Z";

function makeThread(id: string, projectId: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    projectId,
    title: `Thread ${id}`,
    status: "working",
    done: false,
    archived: false,
    starred: false,
    createdAt: NOW,
    updatedAt: NOW,
    agentKind: "gdsAgent",
    ...overrides,
  } as unknown as Thread;
}

const codeProject: Project = {
  id: "proj-code",
  name: "Code Repo",
  location: { kind: "windows", path: "C:\\repo" },
  createdAt: NOW,
  workspaceId: "ws-code",
} as Project;

const docProject: Project = {
  id: "proj-doc",
  name: "Docs",
  location: { kind: "windows", path: "C:\\docs" },
  createdAt: NOW,
  workspaceId: "ws-doc",
} as Project;

const opsProject: Project = {
  id: "proj-ops",
  name: "Ops",
  location: { kind: "windows", path: "C:\\ops" },
  createdAt: NOW,
  workspaceId: "ws-ops",
} as Project;

const homeProject: Project = {
  id: HOME_PROJECT_ID,
  name: "Home",
  location: { kind: "windows", path: "C:\\home" },
  createdAt: NOW,
} as Project;

function makeTeam(id: string, name: string, memberEmployeeIds: string[]): Team {
  return {
    id,
    name,
    memberEmployeeIds,
    dispatchPolicy: "round-robin",
    createdAt: NOW,
  };
}

describe("SidebarTeamGroups", () => {
  beforeEach(() => {
    useSidebarUiStore.setState({ collapsedWorktrees: {} });
    useAppStore.setState({
      projects: [codeProject, docProject, opsProject, homeProject],
      threads: [],
    });
  });

  it("renders nothing when no teams are defined", () => {
    useSharedSettings.setState({ teams: [] });
    render(<SidebarTeamGroups />);
    expect(screen.queryByText("Teams")).not.toBeInTheDocument();
  });

  it("lists active threads whose workspace is a team member, across projects", () => {
    useSharedSettings.setState({
      teams: [makeTeam("team-1", "Platform", ["ws-code", "ws-doc"])],
    });
    useAppStore.setState({
      threads: [
        makeThread("code-live", "proj-code", { status: "working" }),
        makeThread("doc-live", "proj-doc", { status: "needs_approval" }),
        // Not a team member's workspace (project threads attribute through the
        // project's workspaceId; a thread-level tag here is inert).
        makeThread("other", "proj-ops", { status: "working" }),
        // Not live: idle / done / archived threads stay out of the rollup.
        makeThread("idle", "proj-code", { status: "idle" }),
        makeThread("done", "proj-doc", { status: "working", done: true }),
        makeThread("archived", "proj-doc", { status: "working", archived: true }),
      ],
    });

    render(<SidebarTeamGroups />);

    expect(screen.getByText("Teams")).toBeInTheDocument();
    expect(screen.getByText("Platform")).toBeInTheDocument();
    expect(screen.getByText(/Thread code-live in Code Repo/)).toBeInTheDocument();
    expect(screen.getByText(/Thread doc-live in Docs/)).toBeInTheDocument();
    expect(screen.queryByText(/Thread other/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Thread idle/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Thread done/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Thread archived/)).not.toBeInTheDocument();
  });

  it("attributes Home threads to their own workspaceId", () => {
    useSharedSettings.setState({
      teams: [makeTeam("team-1", "Platform", ["ws-code"])],
    });
    useAppStore.setState({
      threads: [
        makeThread("home-mine", HOME_PROJECT_ID, { status: "working", workspaceId: "ws-code" }),
        makeThread("home-other", HOME_PROJECT_ID, { status: "working", workspaceId: "ws-doc" }),
      ],
    });

    render(<SidebarTeamGroups />);

    expect(screen.getByText(/Thread home-mine/)).toBeInTheDocument();
    expect(screen.queryByText(/Thread home-other/)).not.toBeInTheDocument();
  });

  it("shows an empty state for a team with members but no active threads", () => {
    useSharedSettings.setState({
      teams: [makeTeam("team-1", "Platform", ["ws-code"])],
    });
    useAppStore.setState({
      threads: [makeThread("idle", "proj-code", { status: "idle" })],
    });

    render(<SidebarTeamGroups />);

    expect(screen.getByText("Platform")).toBeInTheDocument();
    expect(screen.getByText("No active threads")).toBeInTheDocument();
  });

  it("shows a memberless empty state", () => {
    useSharedSettings.setState({ teams: [makeTeam("team-1", "Solo", [])] });
    render(<SidebarTeamGroups />);
    expect(screen.getByText("Solo")).toBeInTheDocument();
    expect(screen.getByText("This team has no member roles")).toBeInTheDocument();
  });

  it("toggle collapse hides and restores the thread rows", () => {
    useSharedSettings.setState({
      teams: [makeTeam("team-1", "Platform", ["ws-code"])],
    });
    useAppStore.setState({
      threads: [makeThread("code-live", "proj-code", { status: "working" })],
    });

    render(<SidebarTeamGroups />);
    expect(screen.getByText(/Thread code-live/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Platform"));
    expect(useSidebarUiStore.getState().collapsedWorktrees["group:team-1"]).toBe(true);
    expect(screen.queryByText(/Thread code-live/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Platform"));
    expect(useSidebarUiStore.getState().collapsedWorktrees["group:team-1"]).toBe(false);
    expect(screen.getByText(/Thread code-live/)).toBeInTheDocument();
  });
});
