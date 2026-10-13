import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useWorkspaceStore } from "@/renderer/state/workspaceStore";
import {
  createWorkspace,
  deleteWorkspace,
  renameWorkspace,
  switchWorkspaceForProject,
  updateWorkspaceProfile,
} from "./workspaceActions";

vi.mock("@heroui/react", () => ({
  toast: {
    info: vi.fn<(message: string) => void>(),
    warning: vi.fn<(message: string) => void>(),
    danger: vi.fn<(message: string) => void>(),
  },
}));

function addProject(name: string, workspaceId?: string) {
  return useAppStore
    .getState()
    .addProject({ kind: "posix", path: `/repos/${name}` }, name, workspaceId);
}

describe("workspaceActions", () => {
  beforeEach(() => {
    localStorage.clear();
    useSharedSettings.setState({ workspaces: [] });
    useWorkspaceStore.setState({ activeWorkspaceId: null });
    useAppStore.setState((state) => ({ ...state, projects: [], threads: [] }));
  });

  it("creates a workspace and switches to it", () => {
    const first = createWorkspace("Work");
    const second = createWorkspace("Side Hustle");

    expect(useSharedSettings.getState().workspaces.map((w) => w.name)).toEqual([
      "Work",
      "Side Hustle",
    ]);
    expect(useSharedSettings.getState().workspaces.map((w) => w.icon)).toEqual([
      "briefcase",
      "rocket",
    ]);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(second!.id);
    expect(first!.id).not.toBe(second!.id);
  });

  it("refuses a blank name", () => {
    expect(createWorkspace("   ")).toBeNull();
    expect(useSharedSettings.getState().workspaces).toHaveLength(0);
  });

  it("trims names on create and rename", () => {
    const workspace = createWorkspace("  Work  ")!;
    expect(workspace.name).toBe("Work");

    renameWorkspace(workspace.id, "  Client  ");
    expect(useSharedSettings.getState().workspaces[0]!.name).toBe("Client");
  });

  it("follows a project filed in another workspace", () => {
    const work = createWorkspace("Work")!;
    const side = createWorkspace("Side Hustle")!;
    const project = addProject("beta", side.id);
    useWorkspaceStore.setState({ activeWorkspaceId: work.id });

    switchWorkspaceForProject(project.id);

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(side.id);
  });

  it("stays put for projects the active workspace already shows", () => {
    const work = createWorkspace("Work")!;
    const filed = addProject("alpha", work.id);
    const unfiled = addProject("gamma");
    useWorkspaceStore.setState({ activeWorkspaceId: work.id });

    switchWorkspaceForProject(filed.id);
    switchWorkspaceForProject(unfiled.id);
    switchWorkspaceForProject("missing-project");

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(work.id);
  });

  it("moves projects to another workspace when one is deleted", () => {
    const work = createWorkspace("Work")!;
    const side = createWorkspace("Side Hustle")!;
    const alpha = addProject("alpha", work.id);
    const beta = addProject("beta", side.id);

    deleteWorkspace(work.id);

    const projects = useAppStore.getState().projects;
    // Deleting a grouping must never delete the work inside it.
    expect(projects).toHaveLength(2);
    expect(projects.find((p) => p.id === alpha.id)?.workspaceId).toBe(side.id);
    expect(projects.find((p) => p.id === beta.id)?.workspaceId).toBe(side.id);
    expect(useSharedSettings.getState().workspaces.map((w) => w.id)).toEqual([side.id]);
  });

  it("moves the active workspace off a deleted one", () => {
    const work = createWorkspace("Work")!;
    const side = createWorkspace("Side Hustle")!;
    useWorkspaceStore.setState({ activeWorkspaceId: side.id });

    deleteWorkspace(side.id);

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(work.id);
  });

  it("refuses to delete the last workspace", () => {
    const only = createWorkspace("Work")!;
    const alpha = addProject("alpha", only.id);

    deleteWorkspace(only.id);

    expect(useSharedSettings.getState().workspaces).toHaveLength(1);
    expect(useAppStore.getState().projects.find((p) => p.id === alpha.id)?.workspaceId).toBe(
      only.id,
    );
  });

  it("patches a workspace's employee (岗位) profile in one write", () => {
    const workspace = createWorkspace("Doc Writer")!;

    updateWorkspaceProfile(workspace.id, {
      persona: "I am the document writer.",
      responsibilities: ["requirements docs", "design docs"],
      skillIds: ["requirements-quality-review"],
      capabilityTags: ["writing", "reviewing"],
      agentKind: "codex",
      defaultThreadConfig: { model: "gpt-5", mode: "agent" },
      permissions: { allowComputerUse: true, requireApproval: false },
    });

    const saved = useSharedSettings.getState().workspaces.find((w) => w.id === workspace.id)!;
    expect(saved.persona).toBe("I am the document writer.");
    expect(saved.responsibilities).toEqual(["requirements docs", "design docs"]);
    expect(saved.skillIds).toEqual(["requirements-quality-review"]);
    expect(saved.capabilityTags).toEqual(["writing", "reviewing"]);
    expect(saved.agentKind).toBe("codex");
    expect(saved.defaultThreadConfig?.model).toBe("gpt-5");
    expect(saved.permissions).toEqual({ allowComputerUse: true, requireApproval: false });
  });

  it("clears a profile field when the patch value is undefined", () => {
    const workspace = createWorkspace("Doc Writer")!;
    updateWorkspaceProfile(workspace.id, { persona: "I am the document writer." });

    updateWorkspaceProfile(workspace.id, { persona: undefined });

    const saved = useSharedSettings.getState().workspaces.find((w) => w.id === workspace.id)!;
    expect(saved.persona).toBeUndefined();
  });
});
