import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { openKnowledgeBase } from "@/renderer/actions/knowledgeActions";
import { openCapabilities } from "@/renderer/actions/panelActions";
import { openNewThread } from "@/renderer/actions/threadActions";
import { SCENARIOS } from "@/renderer/scenarios/catalog";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { SidebarPrimaryActions } from "./SidebarPrimaryActions";

/** Scenario titles follow the Capabilities entry until the workspace narrows the list. */
const scenarioTitles = SCENARIOS.map((scenario) => scenario.title.message ?? "");

vi.mock("@/renderer/actions/threadActions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/renderer/actions/threadActions")>();
  return { ...actual, openNewThread: vi.fn<() => void>() };
});

vi.mock("@/renderer/actions/panelActions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/renderer/actions/panelActions")>();
  return { ...actual, openCapabilities: vi.fn<(tab?: string) => void>() };
});

vi.mock("@/renderer/actions/knowledgeActions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/renderer/actions/knowledgeActions")>();
  return { ...actual, openKnowledgeBase: vi.fn<() => void>() };
});

/**
 * Labels of the primary action rows, in order. The scenario list below them
 * renders its own filter trigger and collapsible category headers as buttons
 * (`aria-expanded`), which are not action rows — drop them so this stays a
 * check on the action cluster's contents and order.
 */
function rowLabels(): (string | null)[] {
  return screen
    .getAllByRole("button")
    .filter((el) => !el.hasAttribute("aria-expanded"))
    .map((el) => el.textContent);
}

describe("SidebarPrimaryActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAppStore.setState({ view: { kind: "home" } });
    usePanelStore.setState({
      settingsOpen: false,
      settingsSection: "general",
      capabilitiesOpen: false,
    });
    useSharedSettings.setState({
      sidebarHiddenShortcuts: ["pullRequests", "githubActions"],
      sidebarShortcutOrder: ["pullRequests", "githubActions", "tasks"],
    });
  });

  it("shows New thread, Workbench, the Capabilities entry, and scenarios by default", () => {
    render(<SidebarPrimaryActions />);

    expect(rowLabels()).toEqual([
      "New thread",
      "Workbench",
      "Scenarios · Skills · Connectors",
      "Knowledge Base",
      ...scenarioTitles,
    ]);
    expect(screen.queryByRole("button", { name: "Pull requests" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "GitHub Actions" })).not.toBeInTheDocument();
  });

  it("honors the hidden/order settings for the shortcuts", () => {
    useSharedSettings.setState({
      sidebarHiddenShortcuts: [],
      sidebarShortcutOrder: ["tasks", "pullRequests", "githubActions"],
    });

    render(<SidebarPrimaryActions />);

    expect(rowLabels()).toEqual([
      "New thread",
      "Workbench",
      "Pull requests",
      "GitHub Actions",
      "Scenarios · Skills · Connectors",
      "Knowledge Base",
      ...scenarioTitles,
    ]);
  });

  it("creates a thread from New thread", () => {
    render(<SidebarPrimaryActions />);

    fireEvent.click(screen.getByRole("button", { name: "New thread" }));

    expect(vi.mocked(openNewThread)).toHaveBeenCalledTimes(1);
  });

  it("opens the Capabilities page without forcing a view", () => {
    render(<SidebarPrimaryActions />);

    fireEvent.click(screen.getByRole("button", { name: "Scenarios · Skills · Connectors" }));

    expect(vi.mocked(openCapabilities)).toHaveBeenCalledWith();
  });

  it("opens the knowledge base from Knowledge Base", () => {
    render(<SidebarPrimaryActions />);

    fireEvent.click(screen.getByRole("button", { name: "Knowledge Base" }));

    expect(vi.mocked(openKnowledgeBase)).toHaveBeenCalledTimes(1);
  });

  it("renders labelled rows in the icon-only rail variant", () => {
    render(<SidebarPrimaryActions iconOnly />);

    expect(screen.getByRole("button", { name: "New thread" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workbench" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Scenarios · Skills · Connectors" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Knowledge Base" })).toBeInTheDocument();
  });

  it("omits the scenario list from the icon-only rail", () => {
    render(<SidebarPrimaryActions iconOnly />);

    expect(screen.queryByRole("button", { name: scenarioTitles[0]! })).not.toBeInTheDocument();
    expect(screen.queryByText("Scenarios")).not.toBeInTheDocument();
  });
});
