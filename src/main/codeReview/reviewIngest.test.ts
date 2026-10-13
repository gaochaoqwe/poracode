import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, getSqlite, initDatabase } from "../db/connection";
import { resolveProjectFsPath } from "@/main/attachments/localFiles";
import {
  clearProjectReviewRows,
  createReviewTask,
  getReviewTasks,
  ingestProjectReviews,
} from "./reviewIngest";

const serverNativeBinding = join(process.cwd(), "dist", "server-native", "better_sqlite3.node");
let nativeBindingEnv: string | undefined;
let sqliteAvailable = true;
try {
  new Database(":memory:").close();
} catch {
  if (existsSync(serverNativeBinding)) {
    nativeBindingEnv = serverNativeBinding;
  } else {
    sqliteAvailable = false;
  }
}
if (nativeBindingEnv) process.env.BETTER_SQLITE3_NATIVE_BINDING_ENV = nativeBindingEnv;

vi.mock("@/main/attachments/localFiles", () => ({
  resolveProjectFsPath: vi.fn<(payload: { projectLocation: unknown }) => string>(),
}));

let projectDir: string;
let dataDir: string;

function writeReview(relative: string, content: unknown): void {
  writeFileSync(join(projectDir, "reviews", relative), JSON.stringify(content), "utf8");
}

describe.skipIf(!sqliteAvailable)("reviewIngest create-first + mirror (real sqlite)", () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "agentemployee-review-ingest-"));
    projectDir = mkdtempSync(join(tmpdir(), "agentemployee-review-project-"));
    mkdirSync(join(projectDir, "reviews"));
    initDatabase(join(dataDir, "state.sqlite"));
    getSqlite()
      .prepare(
        "INSERT INTO projects (id, name, location_kind, created_at) VALUES (?, ?, ?, ?)",
      )
      .run("project-1", "Probe", "windows", "2026-01-01T00:00:00.000Z");
    vi.mocked(resolveProjectFsPath).mockReturnValue(projectDir);
  });

  afterEach(() => {
    closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("persists a review task on creation (创建任务即落库)", () => {
    const view = createReviewTask(
      { kind: "windows", path: projectDir } as never,
      "project-1",
      { projectLocation: { kind: "windows", path: projectDir } as never, projectId: "project-1", taskName: "函数审查-A", kind: "function" },
    );
    expect(view.taskId).toBeTruthy();
    expect(view.kind).toBe("function");
    expect(view.taskName).toBe("函数审查-A");
    expect(view.status).toBe("pending");

    const tasks = getReviewTasks("project-1");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.taskName).toBe("函数审查-A");
    expect(tasks[0]!.status).toBe("pending");
  });

  it("ingest mirrors a report into the created row and preserves its task_name", () => {
    const task = createReviewTask(
      { kind: "windows", path: projectDir } as never,
      "project-1",
      { projectLocation: { kind: "windows", path: projectDir } as never, projectId: "project-1", taskName: "链路审查-B", kind: "chain" },
    );
    writeReview(
      `${task.taskId}-chain-review.json`,
      {
        kind: "code-review-report",
        version: 1,
        mode: "chain",
        taskId: task.taskId,
        scope: { rootDir: ".", files: ["src/a.c"] },
        problems: [
          {
            id: "C-1",
            file_name: "src/a.c",
            function_name: "fn",
            problem_reason: "fn-bounds：数组越界",
            issue_level: "重要问题",
            issue_name: "越界",
            issue_location: "src/a.c:fn",
            description_issue: "越界",
            suggestion: "修",
            impact: "崩溃",
          },
        ],
      },
    );
    const data = ingestProjectReviews(
      { kind: "windows", path: projectDir } as never,
      "project-1",
    );
    expect(data.issues).toHaveLength(1);
    expect(data.progress).toBeNull();
    expect(data.functionInfos).toEqual([]);
    // 报告镜像后，任务行仍保留创建时的 task_name / created_at。
    const tasks = getReviewTasks("project-1");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.taskName).toBe("链路审查-B");
    expect(tasks[0]!.issueCount).toBe(1);
    expect(tasks[0]!.status).toBe("");
  });

  it("ingestProjectReviews returns tasks (create-first + report-mirrored combined)", () => {
    const created = createReviewTask(
      { kind: "windows", path: projectDir } as never,
      "project-1",
      { projectLocation: { kind: "windows", path: projectDir } as never, projectId: "project-1", taskName: "回归审查-C", kind: "regression" },
    );
    const data = ingestProjectReviews(
      { kind: "windows", path: projectDir } as never,
      "project-1",
    );
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0]!.taskId).toBe(created.taskId);
    expect(data.tasks[0]!.kind).toBe("regression");
  });

  it("mirrors function_info and drops 建议改进 issues at ingest", () => {
    writeReview("t9-function-review.json", {
      kind: "code-review-report",
      version: 1,
      mode: "function",
      scope: { rootDir: ".", files: ["src/a.c"] },
      problems: [
        {
          id: "F-1",
          file_name: "src/a.c",
          function_name: "fn",
          issue_level: "重要问题",
          issue_name: "越界",
        },
        {
          id: "F-2",
          file_name: "src/a.c",
          function_name: "fn",
          issue_level: "建议改进",
          issue_name: "命名建议",
        },
      ],
      function_info: [
        { function_name: "fn", file_name: "src/a.c", function_description: "做一件事。" },
        { function_name: "fn2", function_description: "" },
      ],
    });
    const data = ingestProjectReviews(
      { kind: "windows", path: projectDir } as never,
      "project-1",
    );
    expect(data.issues.map((issue) => issue.id)).toEqual(["F-1"]);
    expect(data.functionInfos).toEqual([
      {
        taskId: "t9",
        mode: "function",
        functionName: "fn",
        fileName: "src/a.c",
        functionDescription: "做一件事。",
      },
      {
        taskId: "t9",
        mode: "function",
        functionName: "fn2",
        fileName: "",
        functionDescription: "",
      },
    ]);
    // 过滤后的计数不进入任务行的 issue_count。
    const tasks = getReviewTasks("project-1");
    expect(tasks.find((task) => task.taskId === "t9")?.issueCount).toBe(1);
  });

  it("mirrors issue source_code so the export 源代码 column survives the round-trip", () => {
    writeReview("t10-function-review.json", {
      kind: "code-review-report",
      version: 1,
      mode: "function",
      problems: [
        {
          id: "F-1",
          file_name: "src/a.c",
          function_name: "fn",
          source_code: "void fn(void) { char b[8]; }",
          issue_level: "重要问题",
          issue_name: "越界",
        },
      ],
    });
    const data = ingestProjectReviews(
      { kind: "windows", path: projectDir } as never,
      "project-1",
    );
    expect(data.issues[0]!.sourceCode).toBe("void fn(void) { char b[8]; }");
    const row = getSqlite()
      .prepare("SELECT source_code FROM review_issues WHERE project_id = ? AND task_id = ?")
      .get("project-1", "t10") as { source_code: string } | undefined;
    expect(row?.source_code).toBe("void fn(void) { char b[8]; }");
  });

  it("mirrors features + callgraph and returns them for the four-column layout", () => {
    writeReview("t11-chain-review.json", {
      kind: "code-review-report",
      version: 1,
      mode: "chain",
      problems: [
        {
          id: "C-1",
          file_name: "src/a.c",
          function_name: "route_ok",
          feature_id: "CH-1",
          affected_functions: "route_ok、normalize",
          issue_level: "重要问题",
          issue_name: "链上错误被吞",
        },
      ],
      features: [
        {
          id: "CH-1",
          name: "导航距离计算链路",
          section: "3.2",
          description: "入口 route_ok → normalize 归一化。",
          entry_function: "route_ok",
          files: ["src/a.c"],
          functions: ["route_ok"],
          chain_order: ["route_ok", "normalize"],
          sub_features: [{ id: "CH-1.1", name: "输入归一化", files: ["src/b.c"] }],
        },
      ],
      callgraph: { nodes: [{ id: "route_ok", label: "route_ok", type: "function" }], edges: [] },
    });
    const data = ingestProjectReviews(
      { kind: "windows", path: projectDir } as never,
      "project-1",
    );
    expect(data.features.map((feature) => feature.id)).toEqual(["CH-1", "CH-1.1"]);
    expect(data.features[1]!.parentId).toBe("CH-1");
    expect(data.features[0]!.chainOrder).toEqual(["route_ok", "normalize"]);
    expect(data.issues[0]!.featureId).toBe("CH-1");
    expect(data.issues[0]!.affectedFunctions).toBe("route_ok、normalize");
    expect(data.callgraphs.t11?.nodes).toHaveLength(1);

    // 平铺镜像入库（parent_id 指回父模块，数组字段以 JSON 文本存储）。
    const rows = getSqlite()
      .prepare(
        `SELECT feature_id, parent_id, files, chain_order FROM review_features
         WHERE project_id = ? AND task_id = ? ORDER BY ordinal`,
      )
      .all("project-1", "t11") as {
      feature_id: string;
      parent_id: string | null;
      files: string;
      chain_order: string;
    }[];
    expect(rows.map((row) => row.feature_id)).toEqual(["CH-1", "CH-1.1"]);
    expect(rows[0]!.parent_id).toBeNull();
    expect(rows[1]!.parent_id).toBe("CH-1");
    expect(JSON.parse(rows[0]!.chain_order)).toEqual(["route_ok", "normalize"]);
    expect(JSON.parse(rows[1]!.files)).toEqual(["src/b.c"]);
  });

  it("clearProjectReviewRows removes created + mirrored rows", () => {    createReviewTask(
      { kind: "windows", path: projectDir } as never,
      "project-1",
      { projectLocation: { kind: "windows", path: projectDir } as never, projectId: "project-1", taskName: "X", kind: "feature" },
    );
    expect(getReviewTasks("project-1")).toHaveLength(1);
    clearProjectReviewRows("project-1");
    expect(getReviewTasks("project-1")).toHaveLength(0);
  });
});
