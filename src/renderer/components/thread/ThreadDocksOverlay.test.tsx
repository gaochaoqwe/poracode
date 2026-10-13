import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AppProvider } from "@/renderer/components/ui/provider";
import { useAppStore } from "@/renderer/state/appStore";
import { useThreadDocksOverlayStore } from "@/renderer/state/threadDocksOverlayStore";
import { useThreadSubAgentDockStore } from "@/renderer/state/threadSubAgentDockStore";
import { useThreadTodoDockStore } from "@/renderer/state/threadTodoDockStore";
import { ThreadDocksOverlayPanel } from "./ThreadDocksOverlay";

const THREAD_ID = "thread-1";

function seedPlanThread() {
  useAppStore.setState({
    runtimeItemIdsByThread: { [THREAD_ID]: ["plan-1"] },
    runtimeItemsByIdByThread: {
      [THREAD_ID]: {
        "plan-1": {
          id: "plan-1",
          type: "plan",
          state: "updated",
          payload: {
            steps: [
              { step: "Lock the layout", status: "completed" },
              { step: "Wire the panel", status: "in_progress" },
            ],
          },
          streams: {},
        },
      },
    },
    runtimeBackgroundTasksByThread: {},
  });
}

beforeEach(() => {
  seedPlanThread();
  useThreadDocksOverlayStore.setState({ openThreadId: THREAD_ID });
  useThreadTodoDockStore.setState({ byThreadId: {}, defaultCollapsed: false });
  useThreadSubAgentDockStore.setState({ dismissedByThread: {} });
});

function renderPanel() {
  return render(
    <AppProvider>
      <ThreadDocksOverlayPanel threadId={THREAD_ID} />
    </AppProvider>,
  );
}

describe("ThreadDocksOverlayPanel", () => {
  it("shows one Plan section title (no duplicate dock header) with progress", () => {
    renderPanel();

    expect(screen.getByTestId("thread-docks-overlay")).toBeInTheDocument();
    expect(screen.getAllByText("Plan")).toHaveLength(1);
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  it("strikes through completed plan steps", () => {
    renderPanel();

    expect(screen.getByText("Lock the layout")).toHaveClass("line-through");
    expect(screen.getByText("Wire the panel")).not.toHaveClass("line-through");
  });

  it("keeps the plan collapse and close controls working", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Collapse todo dock" }));
    expect(useThreadTodoDockStore.getState().byThreadId[THREAD_ID]?.collapsed).toBe(true);
    // Collapsed shows in-progress rows only.
    expect(screen.getByText("Wire the panel")).toBeInTheDocument();
    expect(screen.queryByText("Lock the layout")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand todo dock" }));
    expect(screen.getByText("Lock the layout")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close plan" }));
    expect(useThreadTodoDockStore.getState().byThreadId[THREAD_ID]?.retiredSourceItemId).toBe(
      "plan-1",
    );
    expect(screen.queryByText("Plan")).not.toBeInTheDocument();
  });
});
