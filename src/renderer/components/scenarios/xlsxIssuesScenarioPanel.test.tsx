import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppProvider } from "@/renderer/components/ui/provider";
import type { XlsxIssuesSummary } from "@/renderer/state/xlsxIssuesSummary";
import { useXlsxIssuesSummaryStore } from "@/renderer/state/xlsxIssuesSummaryStore";
import { XlsxIssuesScenarioPanel } from "./xlsxIssuesScenarioPanel";

const summary: XlsxIssuesSummary = {
  schemaVersion: 1,
  sheet: "issues",
  total: 5,
  done: 2,
  byStatus: { done: 2, pending: 2, "needs-review": 1 },
  byRule: [
    { rule: "eqeqeq", total: 3, done: 2, pending: 1 },
    { rule: "no-unused-vars", total: 2, done: 0, pending: 2 },
  ],
  attention: [
    { row: 9, rule: "no-unused-vars", file: "src/a.ts", status: "needs-review", note: "no file" },
  ],
  attentionTotal: 1,
};

function renderPanel(projectId: string) {
  return render(
    <AppProvider>
      <XlsxIssuesScenarioPanel projectId={projectId} />
    </AppProvider>,
  );
}

describe("XlsxIssuesScenarioPanel", () => {
  beforeEach(() => {
    useXlsxIssuesSummaryStore.setState({ byProjectId: {} });
  });

  it("renders nothing without a summary", () => {
    const { container } = renderPanel("p1");
    expect(container).toBeEmptyDOMElement();
  });

  it("renders per-rule progress and the needs-review list", () => {
    useXlsxIssuesSummaryStore.setState({
      byProjectId: { p1: { summary, loading: false } },
    });
    renderPanel("p1");

    expect(screen.getByText("eqeqeq")).toBeInTheDocument();
    expect(screen.getByText("Progress")).toBeInTheDocument();
    // The section title and the needs-review badge share the label.
    expect(screen.getAllByText("Needs review").length).toBeGreaterThan(0);
    // The rule also appears in the progress list, so match any occurrence.
    expect(screen.getAllByText(/no-unused-vars/).length).toBeGreaterThan(0);
  });
});
