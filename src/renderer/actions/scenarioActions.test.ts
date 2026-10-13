import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileText } from "lucide-react";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useWorkspaceStore } from "@/renderer/state/workspaceStore";
import { SCENARIOS, type ScenarioView } from "@/renderer/scenarios/catalog";
import { startScenario } from "./scenarioActions";

const openNewThread = vi.hoisted(() =>
  vi.fn<(projectId?: string, options?: { seeded?: boolean }) => void>(),
);
const resolveNewThreadProjectId = vi.hoisted(() => vi.fn<() => string | undefined>());
vi.mock("./threadActions", () => ({ openNewThread, resolveNewThreadProjectId }));

const resolveDocumentTemplate = vi.hoisted(() => vi.fn<(payload: unknown) => Promise<unknown>>());
vi.mock("@/renderer/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/renderer/bridge")>();
  return { ...actual, readBridge: () => ({ resolveDocumentTemplate }) };
});

// A scenario with no document template: `startScenario` seeds it synchronously.
const plainScenario = SCENARIOS.find((item) => item.id === "write-impact-analysis")!;
// The catalog no longer ships a templated scenario, but `startScenario` still
// supports the `documentTemplate` path; exercise it with a synthetic entry.
const templatedScenario: ScenarioView = {
  id: "test-templated",
  category: "docs",
  subgroup: "requirements",
  icon: FileText,
  title: { id: "test-templated.title", message: "Test templated scenario" },
  description: {
    id: "test-templated.description",
    message: "Synthetic scenario with a document template.",
  },
  prompt: { id: "test-templated.prompt", message: "Fill the document template." },
  steps: [{ id: "test-templated.step", message: "Fill it in." }],
  leadingSkillId: "requirement-quality-review",
  documentTemplate: {
    templateId: "requirements-review",
    defaultResultFile: "docs/requirement-quality-review.md",
  },
};

beforeEach(() => {
  openNewThread.mockReset();
  resolveNewThreadProjectId.mockReset();
  resolveDocumentTemplate.mockReset();
  useAppStore.setState({
    pendingComposerSeeds: {},
    activeScenarioByProject: {},
    projects: ["p3", "p4"].map((id) => ({
      id,
      name: "Repo",
      location: { kind: "posix" as const, path: "/repo" },
      createdAt: "2026-01-01T00:00:00.000Z",
    })),
  });
  usePanelStore.setState({ documentPreviewContext: null, documentPanelOpen: false });
});

describe("startScenario", () => {
  it("seeds the composer with the prompt and steps, records the scenario, and opens a thread", () => {
    startScenario(plainScenario, "p1");

    const seed = useAppStore.getState().pendingComposerSeeds["p1"]?.text ?? "";
    expect(seed).toContain(plainScenario.prompt!.message);
    for (const step of plainScenario.steps) {
      expect(seed).toContain(step.message);
    }
    expect(useAppStore.getState().activeScenarioByProject["p1"]).toBe(plainScenario.id);
    expect(openNewThread).toHaveBeenCalledWith("p1", { seeded: true });
    expect(resolveNewThreadProjectId).not.toHaveBeenCalled();
  });

  it("resolves a target project when none is given", () => {
    resolveNewThreadProjectId.mockReturnValue("p2");

    startScenario(plainScenario);

    expect(useAppStore.getState().pendingComposerSeeds["p2"]).toBeDefined();
    expect(openNewThread).toHaveBeenCalledWith("p2", { seeded: true });
  });

  it("opens an empty composer for a scenario authored without a prompt", () => {
    const manual = SCENARIOS.find((item) => item.id === "modify-project-code")!;
    startScenario(manual, "p1");

    expect(useAppStore.getState().pendingComposerSeeds["p1"]).toBeUndefined();
    expect(useAppStore.getState().activeScenarioByProject["p1"]).toBe("modify-project-code");
    expect(openNewThread).toHaveBeenCalledWith("p1", { seeded: true });
  });

  it("leaves the scaffold output location to its generation mode", () => {
    const scaffold = SCENARIOS.find((item) => item.id === "scaffold-project")!;
    startScenario(scaffold, "p3");

    const seed = useAppStore.getState().pendingComposerSeeds["p3"]!;
    // Output is mode-specific (reuse edits in place, scratch writes src-new/),
    // so the seeded prompt must not pin one absolute output path.
    expect(seed.text).not.toContain("/repo/src-new");
  });

  it("does nothing when no project can be resolved", () => {
    resolveNewThreadProjectId.mockReturnValue(undefined);

    startScenario(plainScenario);

    expect(useAppStore.getState().pendingComposerSeeds).toEqual({});
    expect(useAppStore.getState().activeScenarioByProject).toEqual({});
    expect(openNewThread).not.toHaveBeenCalled();
  });

  it("binds the leading skill and opens the document preview for a templated scenario", async () => {
    resolveDocumentTemplate.mockResolvedValue({
      templateId: "requirements-review",
      level: "builtin",
      path: "/x/requirements-review.md",
      content: "# Review skeleton",
      title: "需求质量检查报告",
      resultFile: "docs/requirement-quality-review.md",
      todoMarker: "待补充",
    });

    startScenario(templatedScenario, "p3");

    await vi.waitFor(() => {
      expect(useAppStore.getState().pendingComposerSeeds["p3"]).toBeDefined();
    });
    const seed = useAppStore.getState().pendingComposerSeeds["p3"]!;
    expect(seed.text.startsWith("/requirement-quality-review\n\n")).toBe(true);
    expect(seed.bindLeadingSkill).toBe(true);
    expect(seed.text).toContain("TEMPLATE");
    expect(seed.text).toContain("docs/requirement-quality-review.md");
    expect(seed.text).toContain("待补充");
    expect(openNewThread).toHaveBeenCalledWith("p3", { seeded: true });
    expect(usePanelStore.getState().documentPreviewContext).toEqual({
      projectId: "p3",
      path: "docs/requirement-quality-review.md",
      title: "需求质量检查报告",
    });
  });

  it("falls back to the default result file when the template cannot be resolved", async () => {
    resolveDocumentTemplate.mockResolvedValue(null);

    startScenario(templatedScenario, "p4");

    await vi.waitFor(() => {
      expect(usePanelStore.getState().documentPreviewContext).not.toBeNull();
    });
    const seed = useAppStore.getState().pendingComposerSeeds["p4"]!;
    expect(seed.text).not.toContain("TEMPLATE");
    expect(usePanelStore.getState().documentPreviewContext).toEqual({
      projectId: "p4",
      path: "docs/requirement-quality-review.md",
      title: templatedScenario.title.message,
    });
  });

  it("binds the GJB 438C SRS skill for write-requirements without opening a preview", () => {
    const requirements = SCENARIOS.find((item) => item.id === "write-requirements")!;
    startScenario(requirements, "p1");

    const seed = useAppStore.getState().pendingComposerSeeds["p1"]!;
    expect(seed.text.startsWith("/gjb438c-srs\n\n")).toBe(true);
    expect(seed.bindLeadingSkill).toBe(true);
    expect(seed.text).toContain("GJB 438C");
    expect(resolveDocumentTemplate).not.toHaveBeenCalled();
    expect(usePanelStore.getState().documentPreviewContext).toBeNull();
    expect(openNewThread).toHaveBeenCalledWith("p1", { seeded: true });
  });

  it("binds the GJB 438C SDD skill for write-design without opening a preview", () => {
    const design = SCENARIOS.find((item) => item.id === "write-design")!;
    startScenario(design, "p5");

    const seed = useAppStore.getState().pendingComposerSeeds["p5"]!;
    expect(seed.text.startsWith("/gjb438c-sdd\n\n")).toBe(true);
    expect(seed.bindLeadingSkill).toBe(true);
    expect(seed.text).toContain("GJB 438C");
    expect(resolveDocumentTemplate).not.toHaveBeenCalled();
    expect(usePanelStore.getState().documentPreviewContext).toBeNull();
    expect(openNewThread).toHaveBeenCalledWith("p5", { seeded: true });
  });

  it("pins the conversation's absolute working directory into a file-output scenario", () => {
    const requirements = SCENARIOS.find((item) => item.id === "write-requirements")!;
    startScenario(requirements, "p3");

    const seed = useAppStore.getState().pendingComposerSeeds["p3"]!;
    expect(seed.text).toContain("/repo");
    expect(seed.text).toContain("/repo/docs");
    expect(seed.text.startsWith("/gjb438c-srs\n\n")).toBe(true);
  });

  it("joins the working-directory paths with the project's own separator", () => {
    useAppStore.setState({
      projects: [
        {
          id: "pwin",
          name: "Repo",
          location: { kind: "windows" as const, path: "E:\\code\\testnew" },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const requirements = SCENARIOS.find((item) => item.id === "write-requirements")!;
    startScenario(requirements, "pwin");

    const seed = useAppStore.getState().pendingComposerSeeds["pwin"]!;
    expect(seed.text).toContain("E:\\code\\testnew\\docs\\");
    expect(seed.text).toContain("E:\\code\\testnew\\.agentemployee\\");
    expect(seed.text).not.toContain("E:\\code\\testnew/docs");
  });
});

describe("startScenario 岗位默认绑定 (P0-06)", () => {
  it("carries the active workspace's defaultThreadConfig into the composer seed", () => {
    useSharedSettings.setState({
      workspaces: [
        {
          id: "docs-ws",
          name: "文档编写",
          category: "docs",
          createdAt: "2026-01-01T00:00:00.000Z",
          icon: "sprout",
          defaultThreadConfig: { model: "gpt-5", mode: "agent" },
        },
      ],
      defaultWorkspaceId: "docs-ws",
    });
    useWorkspaceStore.setState({ activeWorkspaceId: "docs-ws" });

    startScenario(plainScenario, "p3");

    const seed = useAppStore.getState().pendingComposerSeeds["p3"]!;
    expect(seed.defaultConfig).toEqual({ model: "gpt-5", mode: "agent" });
  });

  it("omits defaultConfig when no workspace (岗位) default is declared", () => {
    useSharedSettings.setState({ workspaces: [], defaultWorkspaceId: null });
    useWorkspaceStore.setState({ activeWorkspaceId: null });

    startScenario(plainScenario, "p3");

    const seed = useAppStore.getState().pendingComposerSeeds["p3"]!;
    expect(seed.defaultConfig).toBeUndefined();
  });
});
