import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Workspace, WorkspaceIconId } from "@/shared/contracts";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useWorkspaceStore } from "@/renderer/state/workspaceStore";
import { SidebarWorkspaceSwitcher } from "./SidebarWorkspaceSwitcher";

function workspace(id: string, name: string, icon: WorkspaceIconId): Workspace {
  return {
    id,
    name,
    icon,
    createdAt: "2026-07-27T00:00:00.000Z",
  };
}

describe("SidebarWorkspaceSwitcher", () => {
  beforeEach(() => {
    localStorage.clear();
    useSharedSettings.setState({
      workspaces: [
        workspace("work", "Work", "briefcase"),
        workspace("side", "Side Hustle", "rocket"),
      ],
    });
    useWorkspaceStore.setState({ activeWorkspaceId: "work" });
  });

  it("stays hidden when there is only one workspace", () => {
    useSharedSettings.setState((state) => ({ workspaces: [state.workspaces[0]!] }));

    render(<SidebarWorkspaceSwitcher />);

    expect(screen.queryByRole("button", { name: "Switch workspace" })).not.toBeInTheDocument();
    expect(screen.queryByText("Work")).not.toBeInTheDocument();
  });

  it("switches directly to the other workspace when there are exactly two", () => {
    render(<SidebarWorkspaceSwitcher />);

    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("side");
    expect(screen.getByText("Side Hustle")).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("work");
    expect(screen.getByText("Work")).toBeInTheDocument();
  });

  it("opens a workspace-only picker when there are more than two", async () => {
    useSharedSettings.setState((state) => ({
      workspaces: [...state.workspaces, workspace("client", "Client", "palette")],
    }));

    render(<SidebarWorkspaceSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    const client = screen.getByRole("menuitemradio", { name: "Client" });
    expect(screen.queryByText("Add workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Manage workspaces")).not.toBeInTheDocument();

    fireEvent.click(client);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("client");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("SidebarWorkspaceSwitcher — two-tier hierarchy", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({ threads: [], projects: [], runtimeContextByThread: {} });
    useSharedSettings.setState({
      workspaces: [
        { id: "p-code", name: "软件编码岗", icon: "code", createdAt: "2026-10-11T00:00:00.000Z" },
        {
          id: "p-docs",
          name: "文档编写岗",
          icon: "palette",
          createdAt: "2026-10-11T00:00:00.000Z",
        },
        {
          id: "org-a",
          name: "编码 Lead",
          icon: "sprout",
          createdAt: "2026-10-11T00:00:00.000Z",
          parentWorkspaceId: "p-code",
          roleRank: 1,
          persona: "owns the code team",
        },
        {
          id: "org-b",
          name: "编码工程师",
          icon: "sprout",
          createdAt: "2026-10-11T00:00:00.000Z",
          parentWorkspaceId: "p-code",
          roleRank: 2,
        },
      ] as Workspace[],
    });
    useWorkspaceStore.setState({ activeWorkspaceId: "p-code" });
  });

  it("lists only primary containers; secondaries stay hidden until expanded", () => {
    render(<SidebarWorkspaceSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));

    // Primaries visible as rows.
    expect(screen.getByTestId("workspace-primary:p-code")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-primary:p-docs")).toBeInTheDocument();
    // Secondaries collapsed: not shown yet.
    expect(screen.queryByTestId("workspace-secondary:org-a")).not.toBeInTheDocument();
  });

  it("expanding a primary reveals employees in the Ungrouped bucket (no teams here)", () => {
    render(<SidebarWorkspaceSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));

    // 编码岗 is active, so opening the picker already disclosed it.
    // No teams under 编码岗 → employees land in the Ungrouped bucket, still collapsed.
    expect(screen.getByTestId("workspace-ungrouped:p-code")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-secondary:org-a")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("workspace-ungrouped:p-code"));
    expect(screen.getByTestId("workspace-secondary:org-a")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-secondary:org-b")).toBeInTheDocument();
    // Persona summary line surfaces.
    expect(screen.getByText("owns the code team")).toBeInTheDocument();

    // Selecting a secondary routes to it (new-draft path: no live threads).
    fireEvent.click(screen.getByTestId("workspace-secondary:org-a"));
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("org-a");
  });

  it("clicking a primary row switches the active workspace to that container", () => {
    render(<SidebarWorkspaceSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));

    fireEvent.click(screen.getByTestId("workspace-primary:p-docs"));

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("p-docs");
    // Switching expands the post so its employees are a click away...
    expect(screen.getByTestId("workspace-primary-toggle:p-docs")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // ...(文档编写岗 owns no employees, so that expansion shows its empty state)
    expect(screen.getByText("No teams or members")).toBeInTheDocument();
    // ...and the picker stays open instead of slamming shut on the user.
    expect(screen.getByTestId("workspace-primary:p-code")).toBeInTheDocument();
  });

  it("the chevron expands a post without switching to it", () => {
    render(<SidebarWorkspaceSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));

    fireEvent.click(screen.getByTestId("workspace-primary-toggle:p-docs"));

    // Disclosure only — the active workspace is untouched.
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("p-code");
  });

  it("marks the active post so the switch is visible", () => {
    render(<SidebarWorkspaceSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));

    fireEvent.click(screen.getByTestId("workspace-primary:p-docs"));

    expect(screen.getByTestId("workspace-primary:p-docs")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("workspace-primary:p-code")).not.toHaveAttribute("aria-current");
  });

  it("the trigger labels the owning primary container even when a secondary is active", () => {
    // Activate a secondary employee under 编码岗; the button must still read
    // as the category container, not the employee's name.
    useWorkspaceStore.setState({ activeWorkspaceId: "org-a" });
    render(<SidebarWorkspaceSwitcher />);

    const trigger = screen.getByRole("button", { name: "Switch workspace" });
    expect(trigger).toHaveTextContent("软件编码岗");
    expect(trigger).not.toHaveTextContent("编码 Lead");
  });

  it("opens with the branch holding the active employee already revealed", () => {
    useWorkspaceStore.setState({ activeWorkspaceId: "org-b" });
    render(<SidebarWorkspaceSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));

    // 编码岗 expanded and its Ungrouped bucket disclosed, so the current
    // position is on screen rather than hidden two levels down.
    expect(screen.getByTestId("workspace-primary-toggle:p-code")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const employee = screen.getByTestId("workspace-secondary:org-b");
    expect(employee).toHaveAttribute("aria-current", "true");
  });
});

describe("SidebarWorkspaceSwitcher — team layer + visibility", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({ threads: [], projects: [], runtimeContextByThread: {} });
    useSharedSettings.setState({
      workspaces: [
        { id: "p-test", name: "软件测试岗", icon: "code", createdAt: "2026-10-11T00:00:00.000Z" },
        { id: "p-code", name: "软件编码岗", icon: "code", createdAt: "2026-10-11T00:00:00.000Z" },
        {
          id: "lead-1",
          name: "测试主管",
          icon: "sprout",
          createdAt: "2026-10-11T00:00:00.000Z",
          parentWorkspaceId: "p-test",
          roleRank: 1,
          teamId: "mgmt-team",
        },
        {
          id: "tester-1",
          name: "执行员工",
          icon: "sprout",
          createdAt: "2026-10-11T00:00:00.000Z",
          parentWorkspaceId: "p-test",
          roleRank: 3,
          teamId: "test-team",
        },
        {
          id: "dev-lead",
          name: "开发主管",
          icon: "sprout",
          createdAt: "2026-10-11T00:00:00.000Z",
          parentWorkspaceId: "p-code",
          roleRank: 1,
        },
        {
          id: "ghost",
          name: "隐藏团队成员",
          icon: "sprout",
          createdAt: "2026-10-11T00:00:00.000Z",
          parentWorkspaceId: "p-test",
          roleRank: 2,
          teamId: "hidden-team",
        },
        {
          id: "hidden-self",
          name: "隐藏个人",
          icon: "sprout",
          createdAt: "2026-10-11T00:00:00.000Z",
          parentWorkspaceId: "p-test",
          roleRank: 2,
          teamId: "test-team",
          hiddenInNav: true,
        },
      ] as Workspace[],
      teams: [
        {
          id: "mgmt-team",
          name: "管理团队",
          memberEmployeeIds: [],
          dispatchPolicy: "round-robin",
          createdAt: "2026-10-11T00:00:00.000Z",
        },
        {
          id: "test-team",
          name: "测试执行团队",
          memberEmployeeIds: [],
          dispatchPolicy: "round-robin",
          createdAt: "2026-10-11T00:00:00.000Z",
        },
        {
          id: "hidden-team",
          name: "隐藏团队",
          memberEmployeeIds: [],
          dispatchPolicy: "round-robin",
          createdAt: "2026-10-11T00:00:00.000Z",
          hiddenInNav: true,
        },
      ],
    });
    useWorkspaceStore.setState({ activeWorkspaceId: "p-test" });
  });

  it("the active post opens expanded, showing the team layer first, then employees inside a team", () => {
    render(<SidebarWorkspaceSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));

    // 软件测试岗 is the active post, so it is already disclosed.
    expect(screen.getByTestId("workspace-primary-toggle:p-test")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // Team rows render; hidden team omitted.
    expect(screen.getByTestId("workspace-team:mgmt-team")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-team:test-team")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-team:hidden-team")).not.toBeInTheDocument();
    // Employees still collapsed inside their team.
    expect(screen.queryByTestId("workspace-secondary:lead-1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("workspace-team:mgmt-team"));
    expect(screen.getByTestId("workspace-secondary:lead-1")).toBeInTheDocument();
  });

  it("the chevron still collapses an expanded post", () => {
    render(<SidebarWorkspaceSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));

    fireEvent.click(screen.getByTestId("workspace-primary-toggle:p-test"));

    expect(screen.queryByTestId("workspace-team:mgmt-team")).not.toBeInTheDocument();
  });

  it("drops hidden teams and hidden individual employees", () => {
    render(<SidebarWorkspaceSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    fireEvent.click(screen.getByTestId("workspace-team:test-team"));

    // hidden-team's member and hidden-self never render.
    expect(screen.queryByTestId("workspace-secondary:ghost")).not.toBeInTheDocument();
    expect(screen.queryByTestId("workspace-secondary:hidden-self")).not.toBeInTheDocument();
    expect(screen.getByTestId("workspace-secondary:tester-1")).toBeInTheDocument();
  });

  it("a primary with no teams puts its employees in the Ungrouped bucket", () => {
    render(<SidebarWorkspaceSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));

    fireEvent.click(screen.getByTestId("workspace-primary-toggle:p-code"));
    expect(screen.getByTestId("workspace-ungrouped:p-code")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("workspace-ungrouped:p-code"));
    expect(screen.getByTestId("workspace-secondary:dev-lead")).toBeInTheDocument();
  });
});
