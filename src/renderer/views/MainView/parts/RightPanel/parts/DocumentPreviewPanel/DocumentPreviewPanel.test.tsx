import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { DocumentPreviewPanel } from "./DocumentPreviewPanel";

type SupervisorEvent = { type: string; projectId?: string };

const bridge = vi.hoisted(() => ({
  readProjectFile: vi.fn<(payload: unknown) => Promise<unknown>>(),
  onSupervisorEvent: vi.fn<(handler: (event: SupervisorEvent) => void) => () => void>(),
}));
vi.mock("@/renderer/bridge", () => ({ readBridge: () => bridge }));

beforeEach(() => {
  bridge.readProjectFile.mockReset();
  bridge.onSupervisorEvent.mockReset().mockReturnValue(() => {});
  useAppStore.setState({
    projects: [
      {
        id: "p1",
        name: "Repo",
        location: { kind: "posix", path: "/repo" },
        createdAt: "2026-03-22T00:00:00.000Z",
      },
    ],
  });
});

describe("DocumentPreviewPanel", () => {
  it("reads the tracked file and renders it as markdown", async () => {
    bridge.readProjectFile.mockResolvedValue({
      status: "ready",
      modifiedAtMs: 1,
      content: "# Design\n\nBody text",
    });

    render(<DocumentPreviewPanel projectId="p1" path="docs/design.md" />);

    expect(await screen.findByText("Design")).toBeDefined();
    expect(bridge.readProjectFile).toHaveBeenCalledWith({
      projectLocation: { kind: "posix", path: "/repo" },
      path: "docs/design.md",
    });
  });

  it("shows the waiting state until the agent writes the file", async () => {
    bridge.readProjectFile.mockRejectedValue(
      Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }),
    );

    render(<DocumentPreviewPanel projectId="p1" path="docs/design.md" />);

    expect(await screen.findByText(/Waiting for the agent to write/i)).toBeDefined();
  });

  it("re-reads on a matching project-tree-changed and ignores other projects", async () => {
    bridge.readProjectFile.mockResolvedValue({ status: "ready", modifiedAtMs: 1, content: "# T" });
    const handlers: Array<(event: SupervisorEvent) => void> = [];
    bridge.onSupervisorEvent.mockImplementation((handler) => {
      handlers.push(handler);
      return () => {};
    });

    render(<DocumentPreviewPanel projectId="p1" path="docs/design.md" />);
    await waitFor(() => expect(bridge.readProjectFile).toHaveBeenCalledTimes(1));

    act(() => handlers[0]?.({ type: "project-tree-changed", projectId: "other" }));
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(bridge.readProjectFile).toHaveBeenCalledTimes(1);

    act(() => handlers[0]?.({ type: "project-tree-changed", projectId: "p1" }));
    await waitFor(() => expect(bridge.readProjectFile).toHaveBeenCalledTimes(2));
  });
});
