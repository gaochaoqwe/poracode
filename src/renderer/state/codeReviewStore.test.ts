import { beforeEach, describe, expect, it } from "vitest";
import { useCodeReviewStore } from "./codeReviewStore";

/**
 * `selectReviewTarget` 是左侧目录树的唯一入口：点文件 / 点函数 / 「定位」都走它。
 * 这里锁定它对**函数筛选**的三种语义：
 * - 显式传 `functionName` → 按该函数过滤；
 * - 传 `null` → 清空；
 * - 省略 → 保持（且只要文件没换；换文件必须清掉，否则旧函数会把新文件的问题全滤没）。
 */
function resetStore(): void {
  useCodeReviewStore.setState({
    byProjectId: {},
    selectedReviewFile: null,
    selectedReviewFunction: null,
    selectedReviewTaskId: null,
    codeViewOpen: false,
    boardTakeover: false,
    focusIssueKey: null,
    focusNonce: 0,
  });
}

describe("codeReviewStore selectReviewTarget", () => {
  beforeEach(resetStore);

  it("sets the file and the function filter when a function node is clicked", () => {
    useCodeReviewStore
      .getState()
      .selectReviewTarget({ file: "math_utils.c", issueKey: "t::F-1", functionName: "unsafe_copy" });
    const s = useCodeReviewStore.getState();
    expect(s.selectedReviewFile).toBe("math_utils.c");
    expect(s.selectedReviewFunction).toBe("unsafe_copy");
    expect(s.focusIssueKey).toBe("t::F-1");
    expect(s.codeViewOpen).toBe(true);
  });

  it("clears the function filter when a file node / 全部 is clicked", () => {
    useCodeReviewStore
      .getState()
      .selectReviewTarget({ file: "math_utils.c", functionName: "unsafe_copy" });
    useCodeReviewStore.getState().selectReviewTarget({ file: "math_utils.c", functionName: null });
    expect(useCodeReviewStore.getState().selectedReviewFunction).toBeNull();

    useCodeReviewStore.getState().selectReviewTarget({ file: null, functionName: null });
    expect(useCodeReviewStore.getState().selectedReviewFile).toBeNull();
  });

  it("keeps the function filter when 定位 targets an issue of the same file", () => {
    useCodeReviewStore
      .getState()
      .selectReviewTarget({ file: "math_utils.c", functionName: "unsafe_copy" });
    const before = useCodeReviewStore.getState().focusNonce;
    // 「定位」不带 functionName：同文件 → 不打断函数视图。
    useCodeReviewStore
      .getState()
      .selectReviewTarget({ file: "math_utils.c", issueKey: "t::F-2" });
    const s = useCodeReviewStore.getState();
    expect(s.selectedReviewFunction).toBe("unsafe_copy");
    expect(s.focusNonce).toBe(before + 1);
  });

  it("drops the function filter when 定位 lands on another file", () => {
    useCodeReviewStore
      .getState()
      .selectReviewTarget({ file: "math_utils.c", functionName: "unsafe_copy" });
    useCodeReviewStore
      .getState()
      .selectReviewTarget({ file: "src/nav.c", issueKey: "t::F-9" });
    const s = useCodeReviewStore.getState();
    expect(s.selectedReviewFile).toBe("src/nav.c");
    expect(s.selectedReviewFunction).toBeNull();
  });

  it("treats equivalent path spellings as the same file (no reload, filter kept)", () => {
    useCodeReviewStore
      .getState()
      .selectReviewTarget({ file: "src/a.c", functionName: "alpha" });
    useCodeReviewStore.getState().selectReviewTarget({ file: "./src/a.c", issueKey: "t::F-1" });
    const s = useCodeReviewStore.getState();
    expect(s.selectedReviewFile).toBe("src/a.c");
    expect(s.selectedReviewFunction).toBe("alpha");
  });

  it("clears the function filter on an explicit 显示全部函数 and on setSelectedReviewFile", () => {
    useCodeReviewStore
      .getState()
      .selectReviewTarget({ file: "math_utils.c", functionName: "unsafe_copy" });
    useCodeReviewStore.getState().clearSelectedReviewFunction();
    expect(useCodeReviewStore.getState().selectedReviewFunction).toBeNull();

    useCodeReviewStore
      .getState()
      .selectReviewTarget({ file: "math_utils.c", functionName: "unsafe_copy" });
    useCodeReviewStore.getState().setSelectedReviewFile("math_utils.c");
    expect(useCodeReviewStore.getState().selectedReviewFunction).toBeNull();
  });
});

/**
 * 链路 / 功能审查的四栏布局：左侧「功能模块列表 / 功能列表」选中一条任务后，
 * 其余面板只看该任务。「定位」只切文件、不打断任务筛选。
 */
describe("codeReviewStore selectReviewTask", () => {
  beforeEach(resetStore);

  it("sets the task and drops file/function selections from the previous task", () => {
    useCodeReviewStore
      .getState()
      .selectReviewTarget({ file: "math_utils.c", functionName: "unsafe_copy" });
    useCodeReviewStore.getState().selectReviewTask("t1");
    const s = useCodeReviewStore.getState();
    expect(s.selectedReviewTaskId).toBe("t1");
    expect(s.selectedReviewFile).toBeNull();
    expect(s.selectedReviewFunction).toBeNull();
  });

  it("clears the task scope with null", () => {
    useCodeReviewStore.getState().selectReviewTask("t1");
    useCodeReviewStore.getState().selectReviewTask(null);
    expect(useCodeReviewStore.getState().selectedReviewTaskId).toBeNull();
  });

  it("keeps the task scope when 定位 switches file within it", () => {
    useCodeReviewStore.getState().selectReviewTask("t1");
    useCodeReviewStore.getState().selectReviewTarget({ file: "src/nav.c", issueKey: "t1::C-1" });
    const s = useCodeReviewStore.getState();
    expect(s.selectedReviewTaskId).toBe("t1");
    expect(s.selectedReviewFile).toBe("src/nav.c");
  });
});
