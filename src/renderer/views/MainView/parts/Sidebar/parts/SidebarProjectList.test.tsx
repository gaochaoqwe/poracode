import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { Project } from "@/shared/contracts";
import { HOME_PROJECT_ID, HOME_PROJECT_NAME } from "@/shared/homeScope";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import { useWorkspaceStore } from "@/renderer/state/workspaceStore";
import { SidebarProjectList } from "./SidebarProjectList";

vi.mock("@/renderer/bridge", () => ({
  isRemoteSession: () => false,
  isWindows: () => false,
  readBridge: () => ({ platform: "win32" }),
}));

// The list's job is section selection/ordering; the children are stubbed so the
// assertions read the resolved props directly.
vi.mock("./SidebarProjectSection", () => ({
  SidebarProjectSection: (props: {
    projectId: string;
    projectIndex: number;
    reorderDisabled?: boolean;
  }) => (
    <div
      data-testid={`section-${props.projectId}`}
      data-index={String(props.projectIndex)}
      data-reorder-disabled={String(props.reorderDisabled === true)}
    />
  ),
}));

vi.mock("./SidebarHomeSection", () => ({
  SidebarHomeSection: () => <div data-testid="section-home" />,
}));

vi.mock("./SidebarProjectFilter", () => ({
  SidebarProjectFilter: (props: { value: ReadonlySet<string> | null }) => (
    <div
      data-testid="filter"
      data-value={props.value ? [...props.value].sort().join(",") : "all"}
    />
  ),
}));

function project(id: string, name: string, workspaceId?: string): Project {
  return {
    id,
    name,
    location: { kind: "windows", path: `C:\\${id}` },
    createdAt: "2026-07-01T00:00:00.000Z",
    ...(workspaceId ? { workspaceId } : {}),
  } as Project;
}

// The synthetic Home row is persisted with `disabled: true` and belongs to
// every workspace.
const homeProject = { ...project(HOME_PROJECT_ID, HOME_PROJECT_NAME), disabled: true } as Project;
const alpha = project("a", "Alpha", "w1");
const beta = project("b", "Beta", "w1");
const gamma = project("c", "Gamma", "w1");

function renderList(props: { projectIds: readonly string[]; homeScopeEnabled?: boolean }) {
  return render(
    <SidebarProjectList
      sortMode="updated"
      projectIds={props.projectIds}
      homeProject={homeProject}
      homeScopeEnabled={props.homeScopeEnabled ?? true}
    />,
  );
}

describe("SidebarProjectList", () => {
  beforeEach(() => {
    localStorage.clear();
    useSharedSettings.setState({
      homeScopeEnabled: true,
      workspaces: [
        { id: "w1", name: "Work", icon: "briefcase", createdAt: "2026-07-27T00:00:00.000Z" },
      ],
    });
    useWorkspaceStore.setState({ activeWorkspaceId: "w1" });
    useSidebarUiStore.setState({ flatListProjectFilter: null });
    useAppStore.setState({
      projects: [homeProject, alpha, beta, gamma],
      threads: [],
    } as never);
  });

  it("renders Home first, then each project section, with the filter head", () => {
    renderList({ projectIds: ["a", "b"] });

    expect(screen.getByTestId("section-home")).toBeInTheDocument();
    expect(screen.getByTestId("section-a")).toBeInTheDocument();
    expect(screen.getByTestId("section-b")).toBeInTheDocument();
    expect(screen.getByTestId("filter")).toHaveAttribute("data-value", "all");
  });

  it("hides the sections the filter deselects", () => {
    useSidebarUiStore.setState({ flatListProjectFilter: ["a"] });
    renderList({ projectIds: ["a", "b"] });

    expect(screen.getByTestId("filter")).toHaveAttribute("data-value", "a");
    expect(screen.getByTestId("section-a")).toBeInTheDocument();
    expect(screen.queryByTestId("section-b")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-home")).not.toBeInTheDocument();
  });

  it("reads a selection covering every section as all", () => {
    useSidebarUiStore.setState({ flatListProjectFilter: ["a", "b", HOME_PROJECT_ID] });
    renderList({ projectIds: ["a", "b"] });

    expect(screen.getByTestId("filter")).toHaveAttribute("data-value", "all");
    expect(screen.getByTestId("section-home")).toBeInTheDocument();
    expect(screen.getByTestId("section-b")).toBeInTheDocument();
  });

  it("ignores stale ids, leaving the filter as all", () => {
    useSidebarUiStore.setState({ flatListProjectFilter: ["gone"] });
    renderList({ projectIds: ["a", "b"] });

    expect(screen.getByTestId("filter")).toHaveAttribute("data-value", "all");
    expect(screen.getByTestId("section-a")).toBeInTheDocument();
  });

  it("drops Home when the home scope is off", () => {
    renderList({ projectIds: ["a", "b"], homeScopeEnabled: false });

    expect(screen.queryByTestId("section-home")).not.toBeInTheDocument();
    expect(screen.getByTestId("section-a")).toBeInTheDocument();
  });

  it("never empties the list: a persisted selection still renders a section", () => {
    useSidebarUiStore.setState({ flatListProjectFilter: ["b"] });
    renderList({ projectIds: ["a", "b"] });

    expect(screen.getByTestId("section-b")).toBeInTheDocument();
  });

  it("keeps unfiltered indices and disables reorder while filtered", () => {
    useSidebarUiStore.setState({ flatListProjectFilter: ["a", "c"] });
    renderList({ projectIds: ["a", "b", "c"] });

    // `b` is filtered out but the surviving sections keep their store indices,
    // so dnd's index→project resolution stays correct.
    expect(screen.getByTestId("section-a")).toHaveAttribute("data-index", "0");
    expect(screen.getByTestId("section-c")).toHaveAttribute("data-index", "2");
    expect(screen.queryByTestId("section-b")).not.toBeInTheDocument();
    expect(screen.getByTestId("section-a")).toHaveAttribute("data-reorder-disabled", "true");
  });

  it("hides the filter head when a single section is shown", () => {
    renderList({ projectIds: ["a"], homeScopeEnabled: false });

    expect(screen.queryByTestId("filter")).not.toBeInTheDocument();
    expect(screen.getByTestId("section-a")).toBeInTheDocument();
  });

  it("leaves reorder enabled when no filter hides sections", () => {
    renderList({ projectIds: ["a", "b"] });

    expect(screen.getByTestId("section-a")).toHaveAttribute("data-reorder-disabled", "false");
  });
});
