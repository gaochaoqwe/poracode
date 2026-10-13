import { beforeEach, describe, expect, it, vi } from "vitest";

const { bridge } = vi.hoisted(() => ({
  bridge: {
    knowledgeListBases: vi.fn<() => Promise<{ bases: { id: string; name: string }[] }>>(),
    knowledgeRootLocation:
      vi.fn<(p: { baseId: string }) => Promise<{ location: { kind: "windows"; path: string } }>>(),
    knowledgeListTree:
      vi.fn<
        (p: { baseId: string; directoryPath: string }) => Promise<{
          directoryPath: string;
          entries: unknown[];
        }>
      >(),
  },
}));

vi.mock("@/renderer/bridge", () => ({ readBridge: () => bridge }));

import { knowledgeSectionRoot, useKnowledgeBaseStore } from "./knowledgeBaseStore";

const context = { projectId: "proj-1", projectName: "Project" };

beforeEach(() => {
  vi.clearAllMocks();
  useKnowledgeBaseStore.getState().exit();
  bridge.knowledgeListBases.mockResolvedValue({ bases: [{ id: "kb1", name: "Radar" }] });
  bridge.knowledgeRootLocation.mockResolvedValue({
    location: { kind: "windows", path: "C:\\kb\\kb1" },
  });
  bridge.knowledgeListTree.mockImplementation(
    async ({ directoryPath }: { baseId: string; directoryPath: string }) => ({
      directoryPath,
      entries: [],
    }),
  );
});

describe("knowledgeSectionRoot", () => {
  it("maps sections to base-relative roots", () => {
    expect(knowledgeSectionRoot("sources")).toBe("raw/sources");
    expect(knowledgeSectionRoot("wiki")).toBe("wiki");
  });
});

describe("useKnowledgeBaseStore", () => {
  it("enters the mode, selects the first base, and loads both roots", async () => {
    await useKnowledgeBaseStore.getState().enter(context);

    const state = useKnowledgeBaseStore.getState();
    expect(state.open).toBe(true);
    expect(state.activeBaseId).toBe("kb1");
    expect(state.bases.map((base) => base.name)).toEqual(["Radar"]);
    expect(state.location).toEqual({ location: { kind: "windows", path: "C:\\kb\\kb1" } });
    expect(Object.keys(state.childrenByPath).sort()).toEqual(["raw/sources", "wiki"]);
    expect(bridge.knowledgeListTree).toHaveBeenCalledWith({
      baseId: "kb1",
      directoryPath: "raw/sources",
    });
  });

  it("exits and clears everything", async () => {
    await useKnowledgeBaseStore.getState().enter(context);
    useKnowledgeBaseStore.getState().exit();

    const state = useKnowledgeBaseStore.getState();
    expect(state.open).toBe(false);
    expect(state.bases).toEqual([]);
    expect(state.activeBaseId).toBeNull();
    expect(state.childrenByPath).toEqual({});
  });
});
