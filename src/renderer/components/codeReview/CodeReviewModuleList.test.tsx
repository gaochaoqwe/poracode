import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useScenarioInputsStore } from "@/renderer/state/scenarioInputsStore";
import { useCodeReviewStore } from "@/renderer/state/codeReviewStore";
import type { ReviewIssueView, ReviewFeatureView } from "@/renderer/state/codeReviewReport";
import type { ReviewIssueStatus, ReviewTaskView } from "@/shared/ipc";
import { CodeReviewModuleList } from "./CodeReviewModuleList";

/** 四栏布局的左侧栏：链路审查「功能模块列表」、功能审查「功能列表」。 */

function issue(
  id: string,
  taskId: string,
  file: string,
  functionName: string | null,
  featureId: string | null = null,
): ReviewIssueView {
  return {
    id,
    key: `${taskId}::${id}`,
    taskId,
    mode: "chain",
    file,
    functionName,
    featureId,
    line: 1,
    type: "",
    severity: "一般问题",
    summary: id,
    descriptionIssue: "",
    suggestion: "",
    impact: "",
    sourceCode: "",
    descriptionLocation: "",
    codeStatement: "",
    problemReason: "",
    issueLocation: "",
    affectedFunctions: "",
  };
}

function task(
  taskId: string,
  name: string,
  status: string,
  kind: ReviewTaskView["kind"] = "chain",
): ReviewTaskView {
  return {
    taskId,
    kind,
    taskName: name,
    status,
    total: 10,
    done: 4,
    issueCount: 0,
    diffCount: 0,
    updatedAt: null,
    createdAt: null,
  };
}

function feature(over: Partial<ReviewFeatureView> & { id: string; name: string }): ReviewFeatureView {
  return {
    taskId: "t1",
    mode: "chain",
    section: "",
    description: "",
    entryFunction: "",
    status: "",
    files: [],
    functions: [],
    chainOrder: [],
    parentId: null,
    ...over,
  };
}

function seed(options: {
  mode?: string | undefined;
  tasks?: ReviewTaskView[];
  issues?: ReviewIssueView[];
  features?: ReviewFeatureView[];
  statuses?: Record<string, ReviewIssueStatus>;
  selectedReviewTaskId?: string | null;
  selectedReviewFeatureId?: string | null;
  selectedReviewFeatureIds?: readonly string[];
}): void {
  usePanelStore.setState({
    codeReviewPanelOpen: true,
    codeReviewPanelContext: { projectId: "p1", projectName: "demo" },
  });
  useAppStore.setState({ activeScenarioByProject: { p1: "code-review" } });
  useScenarioInputsStore.setState({
    outputModeByProject: options.mode ? { p1: options.mode } : {},
  });
  useCodeReviewStore.setState({
    byProjectId: {
      p1: {
        issues: options.issues ?? [],
        statuses: options.statuses ?? {},
        progress: null,
        diffReports: [],
        tasks: options.tasks ?? [],
        functionInfos: [],
        features: options.features ?? [],
        callgraphs: {},
        loading: false,
        polling: false,
      },
    },
    selectedReviewTaskId: options.selectedReviewTaskId ?? null,
    selectedReviewFeatureId: options.selectedReviewFeatureId ?? null,
    selectedReviewFeatureIds: options.selectedReviewFeatureIds ?? [],
    selectedReviewFile: null,
    selectedReviewFunction: null,
  });
}

describe("CodeReviewModuleList", () => {
  beforeEach(() => {
    useScenarioInputsStore.setState({ outputModeByProject: {}, byProject: {} });
  });

  it("falls back to one row per chain task when the report has no features", () => {
    seed({ mode: "chain", tasks: [task("t1", "登录链路", "done"), task("t2", "支付链路", "running")] });
    render(<CodeReviewModuleList />);
    expect(screen.getByText("功能模块列表")).toBeTruthy();
    expect(screen.getByText("登录链路")).toBeTruthy();
    expect(screen.getByText("支付链路")).toBeTruthy();
    expect(screen.getByText("全部链路审查")).toBeTruthy();
  });

  it("does not render in function mode (function review keeps the 3-column layout)", () => {
    seed({ mode: "function", tasks: [task("t1", "登录链路", "done")] });
    const { container } = render(<CodeReviewModuleList />);
    expect(container.textContent).toBe("");
  });

  it("renders the chain feature tree from report features, with section prefix and sub-features", () => {
    seed({
      mode: "chain",
      tasks: [task("t1", "登录链路", "done")],
      features: [
        feature({ id: "CH-1", name: "导航距离计算链路", section: "3.2" }),
        feature({ id: "CH-1.1", name: "输入归一化", parentId: "CH-1" }),
      ],
    });
    render(<CodeReviewModuleList />);
    expect(screen.getByText("3.2 导航距离计算链路")).toBeTruthy();
    // 默认展开：子功能直接可见。
    expect(screen.getByText("输入归一化")).toBeTruthy();
    // 有 features 时不再走「按任务列出」的兜底行。
    expect(screen.queryByText("登录链路")).toBeNull();
  });

  it("shows the 未过滤/已过滤/已标记 badges computed from the scoped issues", () => {
    seed({
      mode: "chain",
      tasks: [task("t1", "登录链路", "done")],
      features: [
        feature({ id: "CH-1", name: "导航距离计算链路" }),
        feature({ id: "CH-1.1", name: "输入归一化", parentId: "CH-1" }),
      ],
      issues: [
        issue("C-1", "t1", "nav.c", "route_ok", "CH-1"),
        issue("C-2", "t1", "nav.c", "normalize", "CH-1.1"),
        issue("C-3", "t1", "nav.c", "normalize", "CH-1.1"),
      ],
      statuses: { "t1::C-2": "filtered", "t1::C-3": "marked" },
    });
    render(<CodeReviewModuleList />);
    // 父模块统计含子树：3 条中 1 已过滤、1 已标记 → 未过滤 1。
    expect(screen.getAllByTitle("未过滤问题：1").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("已过滤问题：1").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("已标记问题：1").length).toBeGreaterThan(0);
  });

  it("selecting a parent feature stores its own id plus every descendant id", () => {
    seed({
      mode: "chain",
      tasks: [task("t1", "登录链路", "done")],
      features: [
        feature({ id: "CH-1", name: "导航距离计算链路" }),
        feature({ id: "CH-1.1", name: "输入归一化", parentId: "CH-1" }),
      ],
    });
    useCodeReviewStore.setState({ selectedReviewFile: "nav.c", selectedReviewFunction: "route_ok" });
    render(<CodeReviewModuleList />);

    fireEvent.click(screen.getByText("导航距离计算链路"));

    const state = useCodeReviewStore.getState();
    expect(state.selectedReviewTaskId).toBe("t1");
    expect(state.selectedReviewFeatureId).toBe("CH-1");
    expect(state.selectedReviewFeatureIds).toEqual(["CH-1", "CH-1.1"]);
    expect(state.selectedReviewFile).toBeNull();
    expect(state.selectedReviewFunction).toBeNull();
  });

  it("renders feature cards (name + status + description) in feature mode", () => {
    seed({
      mode: "feature",
      tasks: [task("t1", "导航距离", "done", "feature")],
      features: [
        feature({
          id: "F-1",
          name: "导航距离计算",
          mode: "feature",
          description: "按两点经纬度计算球面距离，供路径长度与导航判断使用。",
          entryFunction: "distance_km",
          status: "done",
          files: ["src/core/route/nav.c"],
          functions: ["distance_km", "route_ok"],
        }),
      ],
    });
    render(<CodeReviewModuleList />);
    expect(screen.getByText("功能列表")).toBeTruthy();
    expect(screen.getByText("导航距离计算")).toBeTruthy();
    expect(screen.getByText("已完成")).toBeTruthy();
    expect(screen.getByText(/按两点经纬度计算球面距离/)).toBeTruthy();
  });

  it("selecting a task scopes the review and clears file/function selection", () => {
    seed({
      mode: "feature",
      tasks: [task("t1", "登录功能", "done", "feature")],
      issues: [issue("C-1", "t1", "auth.c", "login")],
      selectedReviewTaskId: null,
    });
    useCodeReviewStore.setState({ selectedReviewFile: "auth.c", selectedReviewFunction: "login" });
    render(<CodeReviewModuleList />);
    expect(screen.getByText("功能列表")).toBeTruthy();

    fireEvent.click(screen.getByText("登录功能"));

    const state = useCodeReviewStore.getState();
    expect(state.selectedReviewTaskId).toBe("t1");
    expect(state.selectedReviewFile).toBeNull();
    expect(state.selectedReviewFunction).toBeNull();
  });

  it("「全部」clears the task scope and shows the task's issue count", () => {
    seed({
      mode: "chain",
      tasks: [task("t1", "登录链路", "done"), task("t2", "支付链路", "done")],
      issues: [issue("C-1", "t1", "auth.c", "login"), issue("C-2", "t1", "auth.c", null)],
      selectedReviewTaskId: "t1",
    });
    render(<CodeReviewModuleList />);
    expect(screen.getByTitle("2 个问题")).toBeTruthy();

    fireEvent.click(screen.getByText("全部链路审查"));
    expect(useCodeReviewStore.getState().selectedReviewTaskId).toBeNull();
  });

  it("falls back to the short taskId when the mirrored report has no task name", () => {
    seed({ mode: "chain", tasks: [task("abcdef1234567890", "", "pending")] });
    render(<CodeReviewModuleList />);
    expect(screen.getByText("审查任务 abcdef12")).toBeTruthy();
  });

  it("shows an empty state when there is no result of the current mode", () => {
    seed({ mode: "chain", tasks: [] });
    render(<CodeReviewModuleList />);
    expect(screen.getByText(/暂无链路审查结果/)).toBeTruthy();
  });
});
