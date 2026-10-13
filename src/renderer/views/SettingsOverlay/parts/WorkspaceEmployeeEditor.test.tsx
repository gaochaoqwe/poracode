import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { AgentStatus, Workspace } from "@/shared/contracts";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { WorkspaceEmployeeEditor } from "./WorkspaceEmployeeEditor";

vi.mock("@/renderer/bridge", () => ({
  isRemoteSession: () => false,
}));

const codexStatus = {
  kind: "codex",
  label: "Codex",
  installed: true,
  capabilities: {
    models: [
      { id: "gpt-5", label: "GPT-5" },
      { id: "gpt-4o", label: "GPT-4o" },
    ],
  },
} as unknown as AgentStatus;

/** A workspace saved before the digital-employee fields existed. */
const legacyWorkspace: Workspace = {
  id: "ws-legacy",
  name: "通用任务岗",
  createdAt: "2026-01-01T00:00:00.000Z",
  icon: "briefcase",
};

function seedSettings(workspace: Workspace) {
  useSharedSettings.setState({
    workspaces: [workspace],
    agentInstances: {
      "my-codex": { id: "my-codex", driver: "codex", displayName: "My Codex" },
    },
  });
}

function currentWorkspace(): Workspace {
  const found = useSharedSettings.getState().workspaces[0];
  if (!found) throw new Error("Expected a workspace in shared settings");
  return found;
}

beforeEach(() => {
  seedSettings(legacyWorkspace);
  useAgentStatusesStore.setState({ agentStatuses: [codexStatus] });
});

describe("WorkspaceEmployeeEditor", () => {
  it("renders a legacy workspace without digital-employee fields without crashing", () => {
    render(<WorkspaceEmployeeEditor isOpen workspace={legacyWorkspace} onClose={() => {}} />);

    expect(screen.getByText("Persona")).toBeInTheDocument();
    expect(screen.getByText("Responsibilities")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText("Capability tags")).toBeInTheDocument();
    expect(screen.getByText("Authorized workspace directories")).toBeInTheDocument();
  });

  it("saves edited persona, a responsibility, and a skill tag through updateWorkspaceProfile", () => {
    render(<WorkspaceEmployeeEditor isOpen workspace={legacyWorkspace} onClose={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/Describe the employee's role framing/u), {
      target: { value: "I am the acceptance report writer." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add duty" }));
    fireEvent.change(screen.getByLabelText("Responsibility 1"), {
      target: { value: "Draft acceptance reports" },
    });

    const skillInput = screen.getByLabelText("Skill");
    fireEvent.change(skillInput, { target: { value: "review" } });
    fireEvent.keyDown(skillInput, { key: "Enter" });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const saved = currentWorkspace();
    expect(saved.persona).toBe("I am the acceptance report writer.");
    expect(saved.responsibilities).toEqual(["Draft acceptance reports"]);
    expect(saved.skillIds).toEqual(["review"]);
  });

  it("writes provider, agent instance, and default model bindings on save", () => {
    render(<WorkspaceEmployeeEditor isOpen workspace={legacyWorkspace} onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Provider"));
    fireEvent.click(screen.getByRole("option", { name: /Codex/u }));

    fireEvent.click(screen.getByLabelText("Agent instance"));
    fireEvent.click(screen.getByRole("option", { name: /My Codex/u }));

    fireEvent.click(screen.getByLabelText("Default model"));
    fireEvent.click(screen.getByRole("option", { name: /GPT-5/u }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const saved = currentWorkspace();
    expect(saved.agentKind).toBe("codex");
    expect(saved.agentInstanceId).toBe("my-codex");
    expect(saved.defaultThreadConfig?.model).toBe("gpt-5");
  });

  it("persists the permission toggles", () => {
    render(<WorkspaceEmployeeEditor isOpen workspace={legacyWorkspace} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("switch", { name: "Allow computer use" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const saved = currentWorkspace();
    expect(saved.permissions?.allowComputerUse).toBe(true);
  });

  it("writes an authorized workspace directory chip on save", () => {
    render(<WorkspaceEmployeeEditor isOpen workspace={legacyWorkspace} onClose={() => {}} />);

    const directoryInput = screen.getByLabelText("Workspace directory");
    fireEvent.change(directoryInput, { target: { value: "E:\\projects\\app" } });
    fireEvent.keyDown(directoryInput, { key: "Enter" });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const saved = currentWorkspace();
    expect(saved.permissions?.workspacePaths).toEqual(["E:\\projects\\app"]);
  });

  it("renders pre-existing workspace paths and drops the field when every chip is removed", () => {
    const seeded: Workspace = {
      ...legacyWorkspace,
      permissions: { workspacePaths: ["E:\\docs"] },
    };
    seedSettings(seeded);
    render(<WorkspaceEmployeeEditor isOpen workspace={seeded} onClose={() => {}} />);

    expect(screen.getByText("E:\\docs")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove tag E:\\docs" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const saved = currentWorkspace();
    expect(saved.permissions?.workspacePaths).toBeUndefined();
  });

  it("renders the capability checklist with implemented and unimplemented registry rows", () => {
    render(<WorkspaceEmployeeEditor isOpen workspace={legacyWorkspace} onClose={() => {}} />);

    expect(screen.getByText("Capabilities")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Code review (C/C++)" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Cross-role handoff" })).toBeInTheDocument();
  });

  it("writes a checked registry capability and a custom id to capabilityIds on save", () => {
    render(<WorkspaceEmployeeEditor isOpen workspace={legacyWorkspace} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Code review (C/C++)" }));

    const customInput = screen.getByLabelText("Custom capability id");
    fireEvent.change(customInput, { target: { value: "my-custom-cap" } });
    fireEvent.keyDown(customInput, { key: "Enter" });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const saved = currentWorkspace();
    expect(saved.capabilityIds).toContain("code-review");
    expect(saved.capabilityIds).toContain("my-custom-cap");
  });

  it("omits capabilityIds when nothing is configured and keeps capabilityTags untouched", () => {
    const seeded: Workspace = {
      ...legacyWorkspace,
      capabilityTags: ["writing"],
    };
    seedSettings(seeded);
    render(<WorkspaceEmployeeEditor isOpen workspace={seeded} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Code review (C/C++)" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const saved = currentWorkspace();
    expect(saved.capabilityIds).toEqual(["code-review"]);
    expect(saved.capabilityTags).toEqual(["writing"]);
  });

  it("persists hiddenInNav when show-in-navigation is turned off", () => {
    render(<WorkspaceEmployeeEditor isOpen workspace={legacyWorkspace} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("switch", { name: "Show in navigation" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(currentWorkspace().hiddenInNav).toBe(true);
  });

  it("omits hiddenInNav when the employee stays visible", () => {
    render(<WorkspaceEmployeeEditor isOpen workspace={legacyWorkspace} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(currentWorkspace().hiddenInNav).toBeUndefined();
  });
});
