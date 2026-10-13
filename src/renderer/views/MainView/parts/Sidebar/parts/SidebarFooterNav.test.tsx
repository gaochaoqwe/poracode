import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { SidebarFooterNav } from "./SidebarFooterNav";

describe("SidebarFooterNav", () => {
  beforeEach(() => {
    localStorage.clear();
    usePanelStore.setState({ settingsOpen: false, settingsSection: "general" });
    useSharedSettings.setState({
      sidebarHiddenShortcuts: ["githubActions"],
      sidebarShortcutOrder: ["pullRequests", "githubActions", "schedules"],
      workspaces: [],
    });
  });

  it("shows only the Settings/Remote Access rows, not the relocated shortcuts", () => {
    render(<SidebarFooterNav remoteAccessStatus="off" />);

    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remote Access" })).toBeInTheDocument();
    // The shortcuts and Skills · Plugins now live in the top action cluster.
    expect(screen.queryByText("Pull requests")).not.toBeInTheDocument();
    expect(screen.queryByText("Schedules")).not.toBeInTheDocument();
    expect(screen.queryByText("Skills · Plugins")).not.toBeInTheDocument();
  });

  it("no longer exposes Hide sidebar or the footer collapse controls", () => {
    render(<SidebarFooterNav remoteAccessStatus="off" />);

    expect(screen.queryByText("Hide sidebar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide sidebar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse footer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expand footer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More" })).not.toBeInTheDocument();
  });

  it("opens Settings from the footer", () => {
    render(<SidebarFooterNav remoteAccessStatus="off" />);

    fireEvent.click(screen.getByText("Settings"));
    expect(usePanelStore.getState().settingsOpen).toBe(true);
  });

  it("shows the workspace switcher only when there is more than one workspace", () => {
    useSharedSettings.setState({
      workspaces: [
        { id: "w1", name: "工作岗位1", createdAt: "2026-01-01T00:00:00.000Z", icon: "briefcase" },
        { id: "w2", name: "工作岗位2", createdAt: "2026-01-01T00:00:00.000Z", icon: "rocket" },
      ],
    });

    render(<SidebarFooterNav remoteAccessStatus="off" />);

    expect(screen.getByRole("button", { name: "Switch workspace" })).toBeInTheDocument();
  });
});
