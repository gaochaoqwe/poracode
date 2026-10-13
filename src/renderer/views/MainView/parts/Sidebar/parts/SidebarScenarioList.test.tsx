import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { startScenario } from "@/renderer/actions/scenarioActions";
import {
  DEFAULT_SCENARIO_IDS_BY_CATEGORY,
  SCENARIOS,
  SCENARIO_SUBGROUP_LABELS,
} from "@/renderer/scenarios/catalog";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import { useWorkspaceStore } from "@/renderer/state/workspaceStore";
import { SidebarScenarioList } from "./SidebarScenarioList";

vi.mock("@/renderer/actions/scenarioActions", () => ({ startScenario: vi.fn<() => void>() }));

const scenarioTitles = SCENARIOS.map((scenario) => scenario.title.message ?? "");
const docsScenarioIds = [...DEFAULT_SCENARIO_IDS_BY_CATEGORY.docs];
const designScenario = SCENARIOS.find((scenario) => scenario.subgroup === "design")!;
const requirementsScenario = SCENARIOS.find((scenario) => scenario.subgroup === "requirements")!;

function makeWorkspace(defaultScenarioIds?: string[]) {
  return {
    id: "w1",
    name: "Work",
    createdAt: "2026-01-01T00:00:00.000Z",
    icon: "briefcase" as const,
    ...(defaultScenarioIds ? { defaultScenarioIds } : {}),
  };
}

describe("SidebarScenarioList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAppStore.setState({ view: { kind: "home" }, activeScenarioByProject: {} });
    useSidebarUiStore.setState({ scenarioCategoryFilter: null, collapsedScenarioCategories: {} });
  });

  it("shows every scenario when the workspace has no explicit list", () => {
    useSharedSettings.setState({ workspaces: [makeWorkspace()] } as never);
    useWorkspaceStore.setState({ activeWorkspaceId: "w1" });

    render(<SidebarScenarioList />);

    for (const title of scenarioTitles) {
      expect(screen.getByRole("button", { name: title })).toBeInTheDocument();
    }
  });

  it("renders nothing when the workspace explicitly lists no scenarios", () => {
    useSharedSettings.setState({ workspaces: [makeWorkspace([])] } as never);
    useWorkspaceStore.setState({ activeWorkspaceId: "w1" });

    render(<SidebarScenarioList />);

    expect(screen.queryByText("Scenarios")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: scenarioTitles[0]! })).not.toBeInTheDocument();
  });

  it("shows only the scenarios the workspace lists", () => {
    const only = SCENARIOS[1]!;
    useSharedSettings.setState({ workspaces: [makeWorkspace([only.id])] } as never);
    useWorkspaceStore.setState({ activeWorkspaceId: "w1" });

    render(<SidebarScenarioList />);

    expect(screen.getByRole("button", { name: only.title.message ?? "" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: scenarioTitles[0]! })).not.toBeInTheDocument();
  });

  it("starts the scenario for the current project when a row is clicked", () => {
    useSharedSettings.setState({ workspaces: [makeWorkspace()] } as never);
    useWorkspaceStore.setState({ activeWorkspaceId: "w1" });
    useAppStore.setState({
      view: { kind: "draft", projectId: "p1" },
    } as never);

    render(<SidebarScenarioList />);
    fireEvent.click(screen.getByRole("button", { name: scenarioTitles[0]! }));

    expect(vi.mocked(startScenario)).toHaveBeenCalledWith(SCENARIOS[0], "p1");
  });

  it("hides a category the scenario filter excludes", () => {
    useSharedSettings.setState({ workspaces: [makeWorkspace(docsScenarioIds)] } as never);
    useWorkspaceStore.setState({ activeWorkspaceId: "w1" });
    useSidebarUiStore.setState({
      scenarioCategoryFilter: ["requirements", "change"],
    });

    render(<SidebarScenarioList />);

    expect(
      screen.queryByRole("button", { name: designScenario.title.message ?? "" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: requirementsScenario.title.message ?? "" }),
    ).toBeInTheDocument();
  });

  it("collapses a category group when its header is clicked", () => {
    useSharedSettings.setState({ workspaces: [makeWorkspace(docsScenarioIds)] } as never);
    useWorkspaceStore.setState({ activeWorkspaceId: "w1" });

    render(<SidebarScenarioList />);

    const designTitle = designScenario.title.message ?? "";
    const headerName = SCENARIO_SUBGROUP_LABELS.design.message ?? "";
    expect(screen.getByRole("button", { name: designTitle })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: headerName }));
    expect(screen.queryByRole("button", { name: designTitle })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: headerName }));
    expect(screen.getByRole("button", { name: designTitle })).toBeInTheDocument();
  });
});
