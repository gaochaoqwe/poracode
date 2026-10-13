import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useCodeReviewStore } from "@/renderer/state/codeReviewStore";
import { useAppStore } from "@/renderer/state/appStore";
import { useScenarioInputsStore } from "@/renderer/state/scenarioInputsStore";
import type {
  ReviewFeatureView,
  ReviewFunctionInfo,
  ReviewIssueView,
} from "@/renderer/state/codeReviewReport";
import { CodeReviewDock } from "./CodeReviewDock";

/**
 * 问题单的**显示范围**：左侧目录树点文件 → 只看该文件；再点函数 → 只看该函数。
 * 这里直接写 store（不经过 IPC / 轮询），只验证面板按范围过滤与「显示全部函数」出口。
 */
function issue(
  id: string,
  file: string,
  functionName: string | null,
  summary: string,
): ReviewIssueView {
  return {
    id,
    key: `t::${id}`,
    taskId: "t",
    mode: "function",
    file,
    functionName,
    line: 1,
    type: "",
    severity: "一般问题",
    summary,
    descriptionIssue: "",
    suggestion: "",
    impact: "",
    sourceCode: "",
    descriptionLocation: "",
    codeStatement: "",
    problemReason: "",
    issueLocation: "",
    featureId: null,
    affectedFunctions: "",
  };
}

function info(functionName: string, fileName: string, functionDescription: string): ReviewFunctionInfo {
  return { taskId: "t", mode: "function", functionName, fileName, functionDescription };
}

function seed(
  issues: readonly ReviewIssueView[],
  options: {
    functionInfos?: readonly ReviewFunctionInfo[];
    features?: readonly ReviewFeatureView[];
    selectedReviewFile?: string | null;
    selectedReviewFunction?: string | null;
    selectedReviewTaskId?: string | null;
    selectedReviewFeatureIds?: readonly string[];
    selectedReviewFeatureId?: string | null;
    /** 场景里选定的审查模式（不传 = 场景未激活，模式解析为 null）。 */
    outputMode?: string;
  } = {},
): void {
  useAppStore.setState({
    activeScenarioByProject: options.outputMode ? { p1: "code-review" } : {},
  });
  useScenarioInputsStore.setState({
    outputModeByProject: options.outputMode ? { p1: options.outputMode } : {},
  });
  useCodeReviewStore.setState({
    byProjectId: {
      p1: {
        issues,
        statuses: {},
        progress: null,
        diffReports: [],
        tasks: [],
        functionInfos: options.functionInfos ?? [],
        features: options.features ?? [],
        callgraphs: {},
        loading: false,
        polling: false,
      },
    },
    selectedReviewFile: options.selectedReviewFile ?? null,
    selectedReviewFunction: options.selectedReviewFunction ?? null,
    selectedReviewTaskId: options.selectedReviewTaskId ?? null,
    selectedReviewFeatureIds: options.selectedReviewFeatureIds ?? [],
    selectedReviewFeatureId: options.selectedReviewFeatureId ?? null,
    codeViewOpen: true,
    boardTakeover: false,
    focusIssueKey: null,
    focusNonce: 0,
  });
}

const ISSUES: readonly ReviewIssueView[] = [
  issue("F-1", "math_utils.c", "unsafe_copy", "越界拷贝"),
  issue("F-2", "math_utils.c", "unsafe_copy", "缺少长度校验"),
  issue("F-3", "math_utils.c", "auth_check", "口令比较非恒定时间"),
  issue("F-4", "src/nav.c", "distance_km", "浮点精度不足"),
];

function renderDock() {
  render(<CodeReviewDock projectId="p1" projectName="demo" onClose={() => undefined} />);
}

/** 卡片标题形如「问题 1」；用标题数量代表列表长度。 */
function cardCount(): number {
  return screen.queryAllByText(/^问题 \d+$/).length;
}

describe("CodeReviewDock issue scoping", () => {
  beforeEach(() => {
    useCodeReviewStore.setState({
      filters: { query: "", andMode: false, mode: null, severity: null, markedOnly: false },
    });
  });

  it("shows every issue when nothing is selected", () => {
    seed(ISSUES);
    renderDock();
    expect(cardCount()).toBe(4);
    expect(screen.queryByText("只看函数")).toBeNull();
  });

  it("limits the list to the selected file when a file node is clicked", () => {
    seed(ISSUES, { selectedReviewFile: "math_utils.c" });
    renderDock();
    expect(cardCount()).toBe(3);
    expect(screen.queryByText("浮点精度不足")).toBeNull();
  });

  it("shows only the selected function's issues (other functions are dropped)", () => {
    seed(ISSUES, { selectedReviewFile: "math_utils.c", selectedReviewFunction: "unsafe_copy" });
    renderDock();
    expect(cardCount()).toBe(2);
    expect(screen.getByText("越界拷贝")).toBeTruthy();
    expect(screen.getByText("缺少长度校验")).toBeTruthy();
    expect(screen.queryByText("口令比较非恒定时间")).toBeNull();
    expect(screen.getByText("只看函数")).toBeTruthy();
  });

  it("goes back to the whole file via 显示全部函数", () => {
    seed(ISSUES, { selectedReviewFile: "math_utils.c", selectedReviewFunction: "unsafe_copy" });
    renderDock();
    expect(cardCount()).toBe(2);

    fireEvent.click(screen.getByText("显示全部函数"));

    expect(useCodeReviewStore.getState().selectedReviewFunction).toBeNull();
    expect(cardCount()).toBe(3);
  });

  it("renders a function-scoped empty state when the function has no issue", () => {
    seed(ISSUES, { selectedReviewFile: "math_utils.c", selectedReviewFunction: "build_sql" });
    renderDock();
    expect(cardCount()).toBe(0);
    expect(screen.getByText("函数「build_sql」暂无审查问题。")).toBeTruthy();
  });

  it("scopes the 函数功能概述 block to the selected function", () => {
    seed(ISSUES, {
      selectedReviewFile: "math_utils.c",
      selectedReviewFunction: "unsafe_copy",
      functionInfos: [
        info("unsafe_copy", "math_utils.c", "把源串拷进 8 字节栈缓冲。"),
        info("auth_check", "math_utils.c", "校验口令。"),
      ],
    });
    renderDock();
    expect(screen.getByText("把源串拷进 8 字节栈缓冲。")).toBeTruthy();
    expect(screen.queryByText("校验口令。")).toBeNull();
  });

  it("matches issues without a function name via the (未命名) node", () => {
    seed(
      [
        issue("F-1", "math_utils.c", null, "未命名函数的问题"),
        issue("F-2", "math_utils.c", "auth_check", "口令比较非恒定时间"),
      ],
      { selectedReviewFile: "math_utils.c", selectedReviewFunction: "(未命名)" },
    );
    renderDock();
    expect(cardCount()).toBe(1);
    expect(screen.getByText("未命名函数的问题")).toBeTruthy();
  });

  it("scopes the list to the task selected in 功能模块列表", () => {
    const withTask = (base: ReviewIssueView, taskId: string): ReviewIssueView => ({
      ...base,
      taskId,
      key: `${taskId}::${base.id}`,
    });
    seed(
      [
        withTask(issue("C-1", "auth.c", "login", "错误被吞"), "t1"),
        withTask(issue("C-2", "auth.c", "login", "循环依赖"), "t1"),
        withTask(issue("C-3", "pay.c", "charge", "竞态"), "t2"),
      ],
      { selectedReviewTaskId: "t1" },
    );
    renderDock();
    expect(cardCount()).toBe(2);
    expect(screen.queryByText("竞态")).toBeNull();
  });

  it("renames the overview block by review mode (链路审查 → 链路功能概述)", () => {
    seed(ISSUES, { outputMode: "chain" });
    renderDock();
    expect(screen.getByText("链路功能概述")).toBeTruthy();
    expect(screen.queryByText("函数功能概述")).toBeNull();
  });

  it("keeps the function wording when no mode is resolved", () => {
    seed(ISSUES);
    renderDock();
    expect(screen.getByText("函数功能概述")).toBeTruthy();
  });
});
