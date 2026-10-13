import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/shared/contracts";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import type { ScenarioView } from "@/renderer/scenarios/catalog";

const { startScenarioMock, commandsRef, pluginsRef } = vi.hoisted(() => ({
  startScenarioMock: vi.fn<(scenario: ScenarioView, projectId?: string) => void>(),
  commandsRef: { current: [] as unknown[] },
  pluginsRef: { current: [] as unknown[] },
}));

vi.mock("@/renderer/actions/scenarioActions", () => ({
  startScenario: startScenarioMock,
}));

vi.mock("@/renderer/components/skills/useSkills", () => ({
  useSkillSlashCommandState: () => ({ commands: commandsRef.current, resolved: true }),
  usePluginMentionItems: () => pluginsRef.current,
}));

import { DraftWelcomePanel } from "./DraftWelcomePanel";

const project: Project = {
  id: "project-1",
  name: "Repo",
  location: { kind: "windows", path: "C:\\repo" },
  createdAt: "2026-10-06T00:00:00.000Z",
};

function skill(id: string, description?: string) {
  return {
    id,
    label: description ? `${id} — ${description}` : id,
    ...(description ? { description } : {}),
    section: "skills",
    skillName: id,
  };
}

function plugin(id: string, name: string, mcpIds?: string[]) {
  return {
    id,
    name,
    command: { id: `${id}-core`, label: `${name} — core`, description: "core", section: "skills" },
    ...(mcpIds ? { enablesMcpServerIds: mcpIds } : {}),
  };
}

function renderPanel() {
  return render(<DraftWelcomePanel project={project} agentKind="cline" presentationMode="gui" />);
}

describe("DraftWelcomePanel", () => {
  beforeEach(() => {
    startScenarioMock.mockReset();
    commandsRef.current = [skill("docx-figures", "Word figures"), skill("knowledge-base")];
    pluginsRef.current = [plugin("computer-use", "Computer Use", ["computer-use"])];
    useAppStore.setState({ pendingComposerSeeds: {} });
  });

  it("greets the user and opens on the first category with scenarios", () => {
    renderPanel();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/do today/i);
    expect(screen.getByRole("tab", { name: /General tasks/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("button", { name: /Write a Word document/ })).toBeInTheDocument();
  });

  it("swaps the card grid when another category tab is chosen", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("tab", { name: /Software coding/ }));

    expect(screen.getByRole("button", { name: /Scaffold a project/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Write a Word document/ })).not.toBeInTheDocument();
  });

  it("starts the scenario for the project when a card is picked", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /Write a Word document/ }));

    expect(startScenarioMock).toHaveBeenCalledTimes(1);
    expect(startScenarioMock.mock.calls[0]?.[0]?.id).toBe("draft-word-document");
    expect(startScenarioMock.mock.calls[0]?.[1]).toBe("project-1");
  });

  it("seeds the composer with a bound skill when a skill chip is picked", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "knowledge-base" }));

    expect(useAppStore.getState().pendingComposerSeeds["project-1"]).toMatchObject({
      text: "/knowledge-base",
      bindLeadingSkill: true,
    });
  });

  it("seeds the plugin's leading skill and enables the MCP servers it wraps", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Computer Use" }));

    expect(useAppStore.getState().pendingComposerSeeds["project-1"]).toMatchObject({
      text: "/computer-use-core",
      bindLeadingSkill: true,
      leadingSkillPluginId: "computer-use",
      enableMcpServerIds: ["computer-use"],
    });
  });

  it("lists the category's own skills before the rest", () => {
    renderPanel();

    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent?.trim())
      .filter((text) => text === "docx-figures" || text === "knowledge-base");

    // General tasks declares docx-figures (via the Word scenario) but not
    // knowledge-base, so the declared one leads the rail.
    expect(labels).toEqual(["docx-figures", "knowledge-base"]);
  });
});
