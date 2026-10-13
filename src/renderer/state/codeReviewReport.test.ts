import { describe, expect, it } from "vitest";
import {
  buildFeatureTree,
  buildReviewTree,
  chainOrderIndex,
  chainOrderLabel,
  collectFeatureFiles,
  collectFeatureIds,
  fileLevelLocation,
  filterIssuesByFile,
  filterIssuesByScope,
  filterIssuesByTask,
  filterIssuesToFeature,
  isFilteredSeverity,
  issueBelongsToFunction,
  parseProgressFile,
  parseRegressionDiffFile,
  parseRegressionDiffFileName,
  parseReviewFile,
  sameReviewFileExact,
  splitDescriptionLocation,
  UNNAMED_FUNCTION,
  type ReviewFeatureView,
  type ReviewFunctionInfo,
  type ReviewIssueView,
} from "./codeReviewReport";

const PROBLEMS_SAMPLE = JSON.stringify({
  kind: "code-review-report",
  version: 1,
  mode: "function",
  scope: { rootDir: "src", files: ["src/nav.c"] },
  problems: [
    {
      id: "F-1",
      file_name: "src/nav.c",
      function_name: "distance_km",
      source_code: "void distance_km() { dlat = x; }",
      problem_reason: "fn-bounds：数组越界 / 缓冲区风险",
      issue_level: "重要问题",
      issue_name: "dlat 换算未做范围保护",
      issue_location: "src/nav.c:distance_km",
      description_requirement: "应在换算前校验 lat/lon 范围。",
      description_issue: "dlat 换算对异常输入未做范围保护。",
      description_location:
        "src/nav.c文件的distance_km函数的23行：dlat = x;源程序为：\nvoid distance_km() {\n    dlat = x;\n}",
      description_impact: "极端输入下结果不可信。",
      related: [],
      evidence: "get_function: distance_km 第23行",
    },
  ],
  function_info: {
    function_name: "distance_km",
    function_description: "计算球面距离。",
    commented_code: "void distance_km() {\n    dlat = x; // 换算\n}",
  },
});

describe("codeReviewReport parseReviewFile", () => {
  it("parses the problems[] format into ReviewIssueView", () => {
    const report = parseReviewFile(PROBLEMS_SAMPLE, "abc123-function-review.json");
    expect(report).not.toBeNull();
    expect(report!.mode).toBe("function");
    expect(report!.taskId).toBe("abc123");
    expect(report!.issues).toHaveLength(1);

    const issue = report!.issues[0]!;
    expect(issue.file).toBe("src/nav.c");
    expect(issue.functionName).toBe("distance_km");
    expect(issue.severity).toBe("重要问题");
    expect(issue.summary).toBe("dlat 换算未做范围保护");
    expect(issue.descriptionIssue).toBe("dlat 换算对异常输入未做范围保护。");
    expect(issue.suggestion).toBe("应在换算前校验 lat/lon 范围。");
    expect(issue.impact).toBe("极端输入下结果不可信。");
    expect(issue.type).toBe("fn-bounds：数组越界 / 缓冲区风险");
    expect(issue.problemReason).toBe("fn-bounds：数组越界 / 缓冲区风险");
    expect(issue.issueLocation).toBe("src/nav.c:distance_km");
    expect(issue.key).toBe("abc123::F-1");
  });

  it("extracts line and code statement from description_location", () => {
    const report = parseReviewFile(PROBLEMS_SAMPLE, "abc123-function-review.json");
    const issue = report!.issues[0]!;
    expect(issue.line).toBe(23);
    expect(issue.codeStatement).toBe("dlat = x;");
    expect(issue.descriptionLocation).toContain("源程序为：");
  });

  it("carries the report-level function_info as the function overview", () => {
    const report = parseReviewFile(PROBLEMS_SAMPLE, "abc123-function-review.json");
    expect(report!.functionInfos).toEqual([
      {
        taskId: "abc123",
        mode: "function",
        functionName: "distance_km",
        fileName: "",
        functionDescription: "计算球面距离。",
      },
    ]);
  });

  it("keeps the issue source_code for the export 源代码 column", () => {
    const report = parseReviewFile(PROBLEMS_SAMPLE, "abc123-function-review.json");
    expect(report!.issues[0]!.sourceCode).toBe("void distance_km() { dlat = x; }");
  });

  it("reads function_info.file_name so the tree can nest the function under its file", () => {
    const raw = JSON.stringify({
      kind: "code-review-report",
      version: 1,
      mode: "function",
      problems: [],
      function_info: { function_name: "a", file_name: "src/a.c", function_description: "A" },
    });
    const report = parseReviewFile(raw, "abc123-function-review.json");
    expect(report!.functionInfos[0]!.fileName).toBe("src/a.c");
  });

  it("accepts function_info as an array and keeps empty descriptions", () => {
    const raw = JSON.stringify({
      kind: "code-review-report",
      version: 1,
      mode: "function",
      problems: [],
      function_info: [
        { function_name: "a", function_description: "A 的功能" },
        { function_name: "b", function_description: "" },
        { function_description: "" }, // 无函数名也无描述 → 丢弃
        { function_name: "c" }, // 有函数名无描述 → 保留（面板显示占位）
      ],
    });
    const report = parseReviewFile(raw, "abc123-function-review.json");
    expect(report!.functionInfos.map((info) => info.functionName)).toEqual(["a", "b", "c"]);
    expect(report!.functionInfos[0]!.functionDescription).toBe("A 的功能");
    expect(report!.functionInfos[1]!.functionDescription).toBe("");
    expect(report!.functionInfos[2]!.functionDescription).toBe("");
  });

  it("yields empty functionInfos when function_info is absent", () => {
    const raw = JSON.stringify({
      kind: "code-review-report",
      version: 1,
      mode: "function",
      problems: [{ id: "F-1", file_name: "src/a.c", issue_name: "X" }],
    });
    const report = parseReviewFile(raw, "abc123-function-review.json");
    expect(report!.functionInfos).toEqual([]);
  });

  it("drops 建议改进 issues at parse time and reports how many were filtered", () => {
    const raw = JSON.stringify({
      kind: "code-review-report",
      version: 1,
      mode: "function",
      problems: [
        { id: "F-1", file_name: "src/a.c", issue_name: "真缺陷", issue_level: "重要问题" },
        { id: "F-2", file_name: "src/a.c", issue_name: "建议改名", issue_level: "建议改进" },
        { id: "F-3", file_name: "src/a.c", issue_name: "建议", issue_level: "suggestion" },
        // 缺 file_name 的等级问题也应被算作过滤，而不是当作格式错误丢弃。
        { id: "F-4", issue_name: "风格", severity: "low" },
      ],
    });
    const report = parseReviewFile(raw, "abc123-function-review.json");
    expect(report!.issues.map((issue) => issue.id)).toEqual(["F-1"]);
    expect(report!.filteredCount).toBe(3);
  });

  it("recognizes the suggestion-level aliases", () => {
    expect(isFilteredSeverity("建议改进")).toBe(true);
    expect(isFilteredSeverity("建议")).toBe(true);
    expect(isFilteredSeverity("minor")).toBe(true);
    expect(isFilteredSeverity("重要问题")).toBe(false);
    expect(isFilteredSeverity("一般问题")).toBe(false);
  });

  it("falls back to the old issues[] shape", () => {
    const legacy = JSON.stringify({
      kind: "code-review-report",
      version: 1,
      mode: "function",
      issues: [
        {
          id: "F-1",
          source: { file: "src/nav.c", function: "distance_km", line: 23, locator: "distance_km:23" },
          type: "fn-bounds",
          severity: "high",
          summary: "旧格式问题",
          suggestion: "修复",
        },
      ],
    });
    const report = parseReviewFile(legacy, "abc123-function-review.json");
    expect(report!.issues[0]!.file).toBe("src/nav.c");
    expect(report!.issues[0]!.severity).toBe("high");
  });

  it("falls back problemReason/issueLocation when raw fields are missing", () => {
    const raw = JSON.stringify({
      kind: "code-review-report",
      version: 1,
      mode: "function",
      problems: [
        {
          id: "F-2",
          file_name: "src/util.c",
          // problem_reason 缺失 → 回退 record.type
          type: "null-deref",
          issue_name: "未判空指针",
          // issue_location 缺失 → 回退 source.locator
          source: { locator: "util.c:parse" },
        },
        {
          id: "F-3",
          file_name: "src/legacy.c",
          // problem_reason / type 均缺失 → 回退 issue_name
          issue_name: "未初始化",
          // issue_location / source.locator / source.location 均缺失 → 空串
          source: {},
        },
      ],
    });
    const report = parseReviewFile(raw, "def456-function-review.json");
    expect(report).not.toBeNull();
    expect(report!.issues).toHaveLength(2);

    const first = report!.issues[0]!;
    expect(first.problemReason).toBe("null-deref");
    expect(first.issueLocation).toBe("util.c:parse");

    const second = report!.issues[1]!;
    expect(second.problemReason).toBe("未初始化");
    expect(second.issueLocation).toBe("");
  });

  it("yields null for malformed JSON", () => {
    expect(parseReviewFile("not json", "a-function-review.json")).toBeNull();
  });
});

describe("codeReviewReport parseProgressFile", () => {
  it("parses a running progress file with current function", () => {
    const raw = JSON.stringify({
      kind: "code-review-progress",
      version: 1,
      taskId: "abc123",
      mode: "function",
      status: "running",
      total: 12000,
      done: 240,
      batchSize: 30,
      currentFile: "src/core/route/nav.c",
      currentFunction: "distance_km",
      issuesInBatch: 3,
      accumulatedIssues: 42,
      startedAt: "2026-10-09T09:00:00Z",
      updatedAt: "2026-10-09T09:30:00Z",
    });
    const progress = parseProgressFile(raw, "abc123-function-progress.json");
    expect(progress).not.toBeNull();
    expect(progress!.taskId).toBe("abc123");
    expect(progress!.mode).toBe("function");
    expect(progress!.status).toBe("running");
    expect(progress!.total).toBe(12000);
    expect(progress!.done).toBe(240);
    expect(progress!.currentFunction).toBe("distance_km");
    expect(progress!.currentFile).toBe("src/core/route/nav.c");
    expect(progress!.accumulatedIssues).toBe(42);
  });

  it("parses a done progress", () => {
    const raw = JSON.stringify({
      kind: "code-review-progress",
      version: 1,
      taskId: "abc123",
      mode: "chain",
      status: "done",
      total: 500,
      done: 500,
      accumulatedIssues: 17,
    });
    const progress = parseProgressFile(raw, "abc123-chain-progress.json");
    expect(progress!.status).toBe("done");
    expect(progress!.done).toBe(500);
    expect(progress!.currentFunction).toBeNull();
  });

  it("yields null for malformed progress JSON", () => {
    expect(parseProgressFile("not json", "a-function-progress.json")).toBeNull();
  });
});

describe("codeReviewReport parseRegressionDiffFile", () => {
  const DIFF_SAMPLE = JSON.stringify({
    kind: "code-review-regression-diff",
    version: 1,
    taskId: "abc123",
    leftPath: "/tmp/baseline",
    rightPath: "/tmp/current",
    updatedAt: "2026-10-09T09:30:00Z",
    changedFiles: [
      {
        path: "src/core/route/nav.c",
        status: "modified",
        left: "int route_ok() { return 0; }",
        right: "int route_ok() { if (x > MAX) return -1; return 0; }",
      },
      {
        path: "src/core/route/new.c",
        status: "added",
        left: null,
        right: "int new_fn() { return 1; }",
      },
      {
        path: "src/core/route/old.c",
        status: "deleted",
        left: "int old_fn() { return 1; }",
        right: null,
      },
      {
        path: "src/core/route/weird.c",
        status: "weird-status",
        left: "old",
        right: "new",
      },
    ],
  });

  it("parses changed files and extracts taskId from fileName", () => {
    const report = parseRegressionDiffFile(DIFF_SAMPLE, "abc123-regression-diff.json");
    expect(report).not.toBeNull();
    expect(report!.taskId).toBe("abc123");
    expect(report!.fileName).toBe("abc123-regression-diff.json");
    expect(report!.schemaVersion).toBe(1);
    expect(report!.leftPath).toBe("/tmp/baseline");
    expect(report!.rightPath).toBe("/tmp/current");
    expect(report!.updatedAt).toBe("2026-10-09T09:30:00Z");
    expect(report!.changedFiles).toHaveLength(4);

    const modified = report!.changedFiles[0]!;
    expect(modified.path).toBe("src/core/route/nav.c");
    expect(modified.status).toBe("modified");
    expect(modified.left).toBe("int route_ok() { return 0; }");
    expect(modified.right).toBe("int route_ok() { if (x > MAX) return -1; return 0; }");

    const added = report!.changedFiles[1]!;
    expect(added.status).toBe("added");
    expect(added.left).toBeNull();
    expect(added.right).not.toBeNull();

    const deleted = report!.changedFiles[2]!;
    expect(deleted.status).toBe("deleted");
    expect(deleted.right).toBeNull();
    expect(deleted.left).not.toBeNull();

    const weird = report!.changedFiles[3]!;
    expect(weird.status).toBe("modified");
  });

  it("yields null for malformed JSON and empty text", () => {
    expect(parseRegressionDiffFile("not json", "a-regression-diff.json")).toBeNull();
    expect(parseRegressionDiffFile("", "a-regression-diff.json")).toBeNull();
    expect(parseRegressionDiffFile("   ", "a-regression-diff.json")).toBeNull();
    expect(parseRegressionDiffFile(null, "a-regression-diff.json")).toBeNull();
  });

  it("treats non-array changedFiles as empty and drops invalid entries", () => {
    const raw = JSON.stringify({
      kind: "code-review-regression-diff",
      version: 1,
      changedFiles: "not-an-array",
    });
    const report = parseRegressionDiffFile(raw, "abc123-regression-diff.json");
    expect(report).not.toBeNull();
    expect(report!.changedFiles).toHaveLength(0);
  });

  it("drops entries with non-string path and non-string left/right", () => {
    const raw = JSON.stringify({
      kind: "code-review-regression-diff",
      version: 1,
      changedFiles: [
        { path: "", status: "modified", left: "l", right: "r" },
        { path: 123, status: "modified", left: "l", right: "r" },
        { path: "src/a.c", status: "added", left: 42, right: "r" },
        { path: "src/b.c", status: "deleted", left: "l", right: null },
        { path: "src/c.c", status: "modified", left: null, right: null },
      ],
    });
    const report = parseRegressionDiffFile(raw, "abc123-regression-diff.json");
    expect(report!.changedFiles).toHaveLength(2);

    const withNonStringLeft = report!.changedFiles[0]!;
    expect(withNonStringLeft.path).toBe("src/a.c");
    expect(withNonStringLeft.left).toBeNull();
    expect(withNonStringLeft.right).toBe("r");
  });
});

describe("codeReviewReport parseRegressionDiffFileName", () => {
  it("extracts taskId from a matching file name", () => {
    expect(parseRegressionDiffFileName("abc123-regression-diff.json")).toEqual({
      taskId: "abc123",
    });
  });

  it("returns null for a non-matching file name", () => {
    expect(parseRegressionDiffFileName("abc123-regression-review.json")).toBeNull();
    expect(parseRegressionDiffFileName("foo-review.json")).toBeNull();
  });
});

describe("codeReviewReport splitDescriptionLocation", () => {
  it("splits the locator summary from the quoted source program", () => {
    const value =
      "src/nav.c文件的distance_km函数的23行：dlat = x;源程序为：\nvoid distance_km() {\n    dlat = x;\n}";
    const { summary, source } = splitDescriptionLocation(value);
    expect(summary).toBe("src/nav.c文件的distance_km函数的23行：dlat = x;");
    expect(source).toBe("void distance_km() {\n    dlat = x;\n}");
  });

  it("normalizes escaped newlines and accepts tolerant markers", () => {
    const { summary, source } = splitDescriptionLocation("定位说明源代码为:\\nint a = 1;");
    expect(summary).toBe("定位说明");
    expect(source).toBe("int a = 1;");
  });

  it("returns the whole text as summary when no marker is present", () => {
    const { summary, source } = splitDescriptionLocation("仅一段定位说明");
    expect(summary).toBe("仅一段定位说明");
    expect(source).toBe("");
  });
});

describe("codeReviewReport fileLevelLocation", () => {
  it("strips the function and line from the locator (导出「问题来源」列)", () => {
    expect(fileLevelLocation("src/nav.c:distance_km", "src/nav.c")).toBe("src/nav.c");
    expect(fileLevelLocation("src/nav.c#distance_km", "src/nav.c")).toBe("src/nav.c");
    expect(fileLevelLocation("src/nav.c::distance_km", "src/nav.c")).toBe("src/nav.c");
    expect(fileLevelLocation("src/nav.c:23", "src/nav.c")).toBe("src/nav.c");
    expect(fileLevelLocation("src/nav.c文件的distance_km函数的23行：dlat = x;", "src/nav.c")).toBe(
      "src/nav.c",
    );
  });

  it("falls back to the file name when the locator is empty", () => {
    expect(fileLevelLocation("", "src/nav.c")).toBe("src/nav.c");
    expect(fileLevelLocation("   ", "src/nav.c")).toBe("src/nav.c");
  });

  it("keeps a Windows-style path without a line suffix intact", () => {
    expect(fileLevelLocation("D:/proj/src/nav.c", "nav.c")).toBe("D:/proj/src/nav.c");
  });
});

describe("codeReviewReport file matching", () => {
  const issue = (file: string): ReviewIssueView =>
    ({
      id: file,
      key: `t::${file}`,
      taskId: "t",
      mode: "function",
      file,
      functionName: null,
      line: null,
      type: "",
      severity: "一般问题",
      summary: "",
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
    }) satisfies ReviewIssueView;

  it("matches normalized paths exactly", () => {
    expect(sameReviewFileExact("./src/a.c", "src/a.c")).toBe(true);
    expect(sameReviewFileExact("src\\a.c", "src/a.c")).toBe(true);
    expect(sameReviewFileExact("lib/a.c", "src/a.c")).toBe(false);
    expect(sameReviewFileExact("", "")).toBe(false);
  });

  it("prefers exact file matches and only falls back to suffix matching", () => {
    // 精确命中时不会把 `a.c` 这种只是后缀相同的另一个文件的问题带出来。
    const ambiguous = [issue("a.c"), issue("src/a.c")];
    expect(filterIssuesByFile(ambiguous, "src/a.c").map((i) => i.file)).toEqual(["src/a.c"]);

    const plain = [issue("src/a.c"), issue("src/b.c")];
    // 只有后缀形式能匹配时才回退（报告路径与项目路径前缀不同）。
    expect(filterIssuesByFile(plain, "nested/src/a.c").map((i) => i.file)).toEqual(["src/a.c"]);
  });
});

describe("codeReviewReport buildReviewTree", () => {
  const issue = (
    id: string,
    file: string,
    functionName: string,
    line: number | null,
  ): ReviewIssueView =>
    ({
      id,
      key: `t::${id}`,
      taskId: "t",
      mode: "function",
      file,
      functionName,
      line,
      type: "",
      severity: "一般问题",
      summary: "",
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
    }) satisfies ReviewIssueView;

  const info = (
    functionName: string,
    fileName: string,
    functionDescription = "",
  ): ReviewFunctionInfo => ({ taskId: "t", mode: "function", functionName, fileName, functionDescription });

  it("nests functions under their file with problem counts and the first issue", () => {
    const tree = buildReviewTree(
      [
        issue("F-2", "src/a.c", "beta", 40),
        issue("F-1", "src/a.c", "alpha", 10),
        issue("F-3", "src/b.c", "gamma", 5),
      ],
      [],
      { "t::F-1": "marked" },
    );
    expect(tree.map((file) => file.key)).toEqual(["src/a.c", "src/b.c"]);

    const a = tree[0]!;
    expect(a.name).toBe("a.c");
    expect(a.problemCount).toBe(2);
    expect(a.markedCount).toBe(1);
    // 函数按首个问题行号升序。
    expect(a.functions.map((fn) => fn.name)).toEqual(["alpha", "beta"]);
    expect(a.functions[0]!.firstIssueKey).toBe("t::F-1");
    expect(a.functions[0]!.firstIssueLine).toBe(10);
    expect(a.functions[0]!.markedCount).toBe(1);
    expect(a.functions[1]!.markedCount).toBe(0);
  });

  it("shows files/functions that come only from function_info (no problems)", () => {
    const tree = buildReviewTree([], [info("clean_fn", "src/clean.c", "无问题")], {});
    expect(tree.map((file) => file.key)).toEqual(["src/clean.c"]);
    expect(tree[0]!.problemCount).toBe(0);
    expect(tree[0]!.functions.map((fn) => fn.name)).toEqual(["clean_fn"]);
    expect(tree[0]!.functions[0]!.firstIssueKey).toBeNull();
  });

  it("merges function_info into the node created from problems", () => {
    const tree = buildReviewTree(
      [issue("F-1", "src/a.c", "alpha", 3)],
      [info("alpha", "src/a.c", "描述")],
      {},
    );
    expect(tree[0]!.functions).toHaveLength(1);
    expect(tree[0]!.functions[0]!.problemCount).toBe(1);
  });

  it("ignores function_info without a file (old reports) instead of guessing a file", () => {
    const tree = buildReviewTree([], [info("orphan", "", "无文件")], {});
    expect(tree).toEqual([]);
  });

  it("groups issues without a function name under (未命名)", () => {
    const tree = buildReviewTree([issue("F-1", "src/a.c", "", 1)], [], {});
    expect(tree[0]!.functions[0]!.name).toBe("(未命名)");
  });
});

describe("codeReviewReport issueBelongsToFunction", () => {
  it("matches by exact function name only", () => {
    expect(issueBelongsToFunction({ functionName: "alpha" }, "alpha")).toBe(true);
    expect(issueBelongsToFunction({ functionName: "alpha_2" }, "alpha")).toBe(false);
    expect(issueBelongsToFunction({ functionName: null }, "alpha")).toBe(false);
  });

  it("treats UNNAMED_FUNCTION as the bucket of issues without a function name", () => {
    expect(issueBelongsToFunction({ functionName: null }, UNNAMED_FUNCTION)).toBe(true);
    expect(issueBelongsToFunction({ functionName: "alpha" }, UNNAMED_FUNCTION)).toBe(false);
  });
});

describe("codeReviewReport filterIssuesByScope", () => {
  const row = (file: string, functionName: string | null) => ({ file, functionName });

  it("returns every issue when neither a file nor a function is selected", () => {
    const rows = [row("src/a.c", "alpha"), row("src/b.c", "beta")];
    expect(filterIssuesByScope(rows, null, null)).toHaveLength(2);
  });

  it("filters by file only when a file node is selected", () => {
    const rows = [row("src/a.c", "alpha"), row("src/a.c", "beta"), row("src/b.c", "beta")];
    expect(filterIssuesByScope(rows, "src/a.c", null).map((r) => r.functionName)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("keeps only the selected function's issues in that file", () => {
    const rows = [
      row("src/a.c", "alpha"),
      row("src/a.c", "alpha"),
      row("src/a.c", "beta"),
      row("src/b.c", "alpha"),
    ];
    const scoped = filterIssuesByScope(rows, "src/a.c", "alpha");
    expect(scoped).toHaveLength(2);
    expect(scoped.every((r) => r.file === "src/a.c" && r.functionName === "alpha")).toBe(true);
  });

  it("matches issues without a function name via UNNAMED_FUNCTION", () => {
    const rows = [row("src/a.c", null), row("src/a.c", "alpha")];
    expect(filterIssuesByScope(rows, "src/a.c", UNNAMED_FUNCTION)).toEqual([row("src/a.c", null)]);
  });

  it("scopes by review task first (功能模块列表选中某条链路/功能)", () => {
    const rows = [
      { ...row("src/a.c", "alpha"), taskId: "t1" },
      { ...row("src/a.c", "beta"), taskId: "t2" },
      { ...row("src/b.c", "alpha"), taskId: "t1" },
    ];
    expect(filterIssuesByScope(rows, null, null, "t1").map((r) => r.taskId)).toEqual(["t1", "t1"]);
    // 任务 + 文件 + 函数可叠加
    expect(filterIssuesByScope(rows, "src/a.c", "beta", "t1")).toEqual([]);
    expect(filterIssuesByScope(rows, "src/a.c", "beta", "t2")).toEqual([
      { ...row("src/a.c", "beta"), taskId: "t2" },
    ]);
    // null = 不过滤
    expect(filterIssuesByScope(rows, null, null, null)).toHaveLength(3);
  });
});

describe("codeReviewReport filterIssuesByTask", () => {
  it("keeps only the selected task's rows and passes everything through for null", () => {
    const rows = [
      { taskId: "t1", file: "a.c" },
      { taskId: "t2", file: "b.c" },
    ];
    expect(filterIssuesByTask(rows, "t2")).toEqual([{ taskId: "t2", file: "b.c" }]);
    expect(filterIssuesByTask(rows, null)).toHaveLength(2);
    expect(filterIssuesByTask(rows, "nope")).toEqual([]);
  });
});

describe("codeReviewReport features（链路 / 功能审查的功能模块）", () => {
  const FEATURES_SAMPLE = JSON.stringify({
    kind: "code-review-report",
    version: 1,
    mode: "chain",
    scope: { rootDir: "src" },
    features: [
      {
        id: "CH-1",
        name: "导航距离计算链路",
        section: "3.2",
        description: "入口 route_ok → normalize 归一化 → distance_km 计算距离。",
        entry_function: "route_ok",
        files: ["src/nav.c"],
        functions: ["route_ok", "normalize"],
        chain_order: ["route_ok", "normalize", "distance_km"],
        sub_features: [
          {
            id: "CH-1.1",
            name: "输入归一化",
            files: ["src/normalize.c"],
            functions: ["normalize"],
          },
        ],
      },
    ],
    callgraph: {
      nodes: [
        { id: "route_ok", label: "route_ok", type: "function", file: "src/nav.c" },
        { id: "normalize", label: "normalize", type: "function" },
      ],
      edges: [{ from: "route_ok", to: "normalize" }],
    },
    problems: [
      {
        id: "C-1",
        file_name: "src/nav.c",
        function_name: "route_ok",
        feature_id: "CH-1",
        affected_functions: "route_ok、normalize",
        issue_level: "重要问题",
        issue_name: "链上错误被吞",
        issue_location: "src/nav.c:route_ok",
        description_location: "src/nav.c文件的route_ok函数的30行：return ok;",
      },
    ],
  });

  it("parses features into a flat array with parentId, files/functions and chain order", () => {
    const report = parseReviewFile(FEATURES_SAMPLE, "t1-chain-review.json");
    expect(report).not.toBeNull();
    const features = report?.features ?? [];
    expect(features.map((f) => f.id)).toEqual(["CH-1", "CH-1.1"]);
    expect(features[0]?.section).toBe("3.2");
    expect(features[0]?.entryFunction).toBe("route_ok");
    expect(features[0]?.chainOrder).toEqual(["route_ok", "normalize", "distance_km"]);
    expect(features[0]?.parentId).toBeNull();
    expect(features[1]?.parentId).toBe("CH-1");
  });

  it("parses feature_id / affected_functions onto issues", () => {
    const report = parseReviewFile(FEATURES_SAMPLE, "t1-chain-review.json");
    expect(report?.issues[0]?.featureId).toBe("CH-1");
    expect(report?.issues[0]?.affectedFunctions).toBe("route_ok、normalize");
  });

  it("parses the optional callgraph", () => {
    const report = parseReviewFile(FEATURES_SAMPLE, "t1-chain-review.json");
    expect(report?.callgraph?.nodes).toHaveLength(2);
    expect(report?.callgraph?.edges).toEqual([{ from: "route_ok", to: "normalize" }]);
  });

  it("returns empty features / null callgraph for reports without them", () => {
    const report = parseReviewFile(PROBLEMS_SAMPLE, "t2-function-review.json");
    expect(report?.features).toEqual([]);
    expect(report?.callgraph).toBeNull();
  });

  it("rebuilds the tree and collects every descendant id", () => {
    const report = parseReviewFile(FEATURES_SAMPLE, "t1-chain-review.json");
    const tree = buildFeatureTree(report?.features ?? []);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children.map((c) => c.id)).toEqual(["CH-1.1"]);
    const root = tree[0];
    expect(root ? collectFeatureIds(root) : []).toEqual(["CH-1", "CH-1.1"]);
    expect(root ? collectFeatureFiles(root) : []).toEqual(["src/nav.c", "src/normalize.c"]);
  });

  it("scopes issues by featureId first, falling back to files/functions", () => {
    const base = (id: string, file: string, functionName: string | null, featureId: string | null) => ({
      id,
      file,
      functionName,
      featureId,
    });
    const rows = [
      base("a", "src/nav.c", "route_ok", "CH-1"),
      base("b", "src/other.c", "other", null),
    ];
    expect(filterIssuesToFeature(rows, { featureIds: ["CH-1"], files: [], functions: [] }).map((r) => r.id)).toEqual([
      "a",
    ]);
    // 报告没填 feature_id → 退化为按 files / functions 命中
    const noFeatureIds = [base("c", "src/nav.c", "route_ok", null), base("d", "src/x.c", "zzz", null)];
    expect(
      filterIssuesToFeature(noFeatureIds, { featureIds: ["CH-1"], files: ["src/nav.c"], functions: [] }).map(
        (r) => r.id,
      ),
    ).toEqual(["c"]);
    expect(
      filterIssuesToFeature(noFeatureIds, { featureIds: ["CH-1"], files: [], functions: ["zzz"] }).map((r) => r.id),
    ).toEqual(["d"]);
  });

  it("scopes by feature inside filterIssuesByScope", () => {
    const rows = [
      { file: "src/nav.c", functionName: "route_ok", taskId: "t1", featureId: "CH-1" },
      { file: "src/nav.c", functionName: "other", taskId: "t1", featureId: "CH-2" },
    ];
    expect(filterIssuesByScope(rows, null, null, "t1", ["CH-2"]).map((r) => r.featureId)).toEqual(["CH-2"]);
    // 空集合 = 不按功能过滤
    expect(filterIssuesByScope(rows, null, null, "t1", [])).toHaveLength(2);
  });

  it("labels chain order as A/B/C…Z/AA and indexes names", () => {
    expect(chainOrderLabel(0)).toBe("A");
    expect(chainOrderLabel(25)).toBe("Z");
    expect(chainOrderLabel(26)).toBe("AA");
    expect(chainOrderLabel(-1)).toBe("");
    const map = chainOrderIndex(["route_ok", "normalize", "route_ok"]);
    expect(map.get("route_ok")).toBe(0);
    expect(map.get("normalize")).toBe(1);
  });

  it("accepts a flat feature list (功能审查) as a single-level tree", () => {
    const flat = JSON.stringify({
      kind: "code-review-report",
      version: 1,
      mode: "feature",
      problems: [],
      features: [
        { id: "F-1", name: "导航距离计算", description: "球面距离", entry_function: "distance_km", status: "done" },
      ],
    });
    const report = parseReviewFile(flat, "t3-feature-review.json");
    const tree = buildFeatureTree(report?.features ?? []);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children).toEqual([]);
    expect(tree[0]?.status).toBe("done");
    expect(tree[0]?.description).toBe("球面距离");
  });
});

describe("codeReviewReport feature fallbacks", () => {
  it("ignores feature entries without id or name", () => {
    const report = parseReviewFile(
      JSON.stringify({
        kind: "code-review-report",
        version: 1,
        mode: "chain",
        problems: [],
        features: [{ name: "没有 id" }, { id: "no-name" }, { id: "ok", name: "有效" }],
      }),
      "t9-chain-review.json",
    );
    expect(report?.features.map((f: ReviewFeatureView) => f.id)).toEqual(["ok"]);
  });
});
