import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { buildApprovalRows, ApprovalsPanel } from "./ApprovalsPanel";

function thread(id: string, projectId: string, extra: Partial<Thread> = {}): Thread {
  return {
    id,
    projectId,
    title: `Thread ${id}`,
    status: "needs_approval",
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
    ...extra,
  } as Thread;
}

const projects: Project[] = [{ id: "proj-1", name: "Code", workspaceId: "ws-coder" } as Project];

describe("buildApprovalRows", () => {
  it("aggregates open requests per thread, owners resolved, sorted by need", () => {
    const threads = [
      thread("t1", "proj-1", { title: "Ship it" }),
      thread("t2", "proj-1", { title: "Docs" }),
    ];
    const workspaces = [
      { id: "ws-coder", name: "Coder" },
      { id: "ws-tester", name: "Tester" },
    ];
    const requests = {
      t1: [
        { requestId: "r1", threadId: "t1", requestType: "tool_permission" },
        { requestId: "r2", threadId: "t1", requestType: "tool_user_input" },
      ],
      t2: [{ requestId: "r3", threadId: "t2", requestType: "tool_permission" }],
    } as never;
    const rows = buildApprovalRows(threads, projects, workspaces, requests);
    expect(rows).toHaveLength(2);
    // t1 has 2 requests → sorts first.
    expect(rows[0]!.threadId).toBe("t1");
    expect(rows[0]!.employeeName).toBe("Coder");
    expect(rows[0]!.requestCount).toBe(2);
    expect(rows[1]!.threadId).toBe("t2");
  });

  it("skips threads with no open requests or missing threads", () => {
    const rows = buildApprovalRows(
      [thread("t1", "proj-1")],
      projects,
      [{ id: "ws-coder", name: "Coder" }],
      {
        t1: [],
        ghost: [{ requestId: "x", threadId: "ghost", requestType: "tool_permission" }],
      } as never,
    );
    expect(rows).toHaveLength(0);
  });
});

describe("ApprovalsPanel", () => {
  beforeEach(() => {
    useAppStore.setState({
      threads: [thread("t1", "proj-1", { title: "Ship it" })],
      projects,
      runtimeRequestsByThread: {
        t1: [{ requestId: "r1", threadId: "t1", requestType: "tool_permission" }],
      } as never,
      openThread: vi.fn<(threadId: string) => void>(),
    });
    useSharedSettings.setState({ workspaces: [{ id: "ws-coder", name: "Coder" }] as never });
  });

  it("renders a row per blocked thread and opens it on click", () => {
    render(<ApprovalsPanel />);
    expect(screen.getByText("Ship it")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Open thread"));
    expect(useAppStore.getState().openThread).toHaveBeenCalledWith("t1");
  });

  it("shows the empty state when nothing needs approval", () => {
    useAppStore.setState({ runtimeRequestsByThread: {} });
    render(<ApprovalsPanel />);
    expect(screen.getByText("No pending approvals")).toBeInTheDocument();
  });
});
