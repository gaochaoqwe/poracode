import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, getSqlite, initDatabase } from "../db/connection";
import { resolveProjectFsPath } from "@/main/attachments/localFiles";
import {
  clearProjectStaticAnalysis,
  createStaticAnalysisTask,
  getStaticAnalysisDefaultRules,
  ingestStaticAnalysis,
  setStaticAnalysisDefaultRules,
} from "./staticAnalysisIngest";

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

function writeStatic(relative: string, content: unknown): void {
  writeFileSync(join(projectDir, "static-analysis", relative), JSON.stringify(content), "utf8");
}

describe.skipIf(!sqliteAvailable)("staticAnalysisIngest (real sqlite round-trip)", () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "agentemployee-static-ingest-"));
    projectDir = mkdtempSync(join(tmpdir(), "agentemployee-static-project-"));
    mkdirSync(join(projectDir, "static-analysis"));
    initDatabase(join(dataDir, "state.sqlite"));
    // static analysis rows FK to projects(id); seed the row the ingest writes against.
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

  it("persists a task on creation (创建任务即落库) and seeds the rule library", () => {
    const task = createStaticAnalysisTask(
      { kind: "windows", path: projectDir } as never,
      "project-1",
      {
        taskName: "GJB 规则检查",
        mode: "normal_c",
        selectedRules: ["R-1-1-1"],
        excelFile: null,
      },
    );
    expect(task.status).toBe("pending");
    expect(task.progress).toBe(0);

    const rows = getSqlite()
      .prepare("SELECT task_id, task_name, mode, domain, status FROM static_analysis_tasks WHERE project_id = ?")
      .all("project-1") as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      task_id: task.taskId,
      task_name: "GJB 规则检查",
      mode: "normal_c",
      domain: "normalModeC",
      status: "pending",
    });

    // Rule library seeded (GJB + CWE assets loaded into the global db).
    const ruleCount = getSqlite()
      .prepare("SELECT COUNT(*) AS c FROM static_analysis_rules")
      .get() as { c: number };
    expect(ruleCount.c).toBeGreaterThan(100);
    const rule = getSqlite()
      .prepare("SELECT rule_code, rule_type, accuracy_type FROM static_analysis_rules WHERE rule_code = 'R-1-1-1'")
      .get() as Record<string, unknown>;
    expect(rule.rule_type).toBe("gjb");
  });

  it("ingests report + progress, upserts the task row, and returns the aggregate", () => {
    const created = createStaticAnalysisTask(
      { kind: "windows", path: projectDir } as never,
      "project-1",
      { taskName: "t1", mode: "filter_c", selectedRules: ["R-1-1-1"], excelFile: "res.xlsx" },
    );
    const taskId = created.taskId;

    writeStatic(`${taskId}-filter_c-report.json`, {
      version: 1,
      selectedRules: ["R-1-1-1"],
      files: [{ file_path: "src/main.c", file_name: "main.c", source_code: "int main(){return 0;}" }],
      problems: [
        {
          id: "p1",
          file_name: "src/main.c",
          issue_name: "未检查返回值",
          issue_line: 3,
          issue_location: "3",
          issue_level: "重要问题",
          rule_code: "R-1-1-1",
          rule_type: "gjb",
          rule_accuracy_type: "accurate",
          description_requirement: "根据GJB8114编码规范要求R-1-1-1条规定：必须检查函数返回值。",
          description_issue: "未检查返回值。",
          description_location: "src/main.c文件3行，具体内容如下：\"x = open();\"。",
          description_impact: "可能导致资源泄漏。",
          problem_sheet: {
            issue_name: "未检查返回值",
            four_part_description:
              "需求描述：根据GJB8114编码规范要求R-1-1-1条规定：必须检查函数返回值。问题描述：未检查返回值。问题定位：src/main.c文件3行。影响分析：可能导致资源泄漏。",
            test_unit_opinion: "1.请确认是否是问题\n2. 若是问题，建议检查返回值",
          },
          source_code: "x = open();",
        },
      ],
    });
    writeStatic(`${taskId}-filter_c-progress.json`, {
      status: "running",
      progress: 50,
      totalFiles: 1,
      processedFiles: 1,
      totalRules: 1,
      accurateRules: 1,
      currentRuleCode: "R-1-1-1",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const data = ingestStaticAnalysis({ kind: "windows", path: projectDir } as never, "project-1");

    const taskView = data.tasks.find((t) => t.taskId === taskId);
    expect(taskView?.status).toBe("running");
    expect(taskView?.progress).toBe(50);
    expect(taskView?.totalProblems).toBe(1);
    expect(data.problems).toHaveLength(1);
    const problem = data.problems[0];
    expect(problem?.problemId).toBe("p1");
    expect(problem?.problem_sheet?.test_unit_opinion).toContain("请确认是否是问题");
    expect(problem?.issue_level).toBe("重要问题");
    expect(data.files).toHaveLength(1);
    expect(data.files[0]?.file_path).toBe("src/main.c");

    // Persisted rows.
    const taskRow = getSqlite()
      .prepare("SELECT status, progress, total_problems FROM static_analysis_tasks WHERE task_id = ?")
      .get(taskId) as Record<string, unknown>;
    expect(taskRow.status).toBe("running");
    expect(taskRow.progress).toBe(50);
    const problemRows = getSqlite()
      .prepare("SELECT problem_id, rule_code, problem_sheet FROM static_analysis_problems WHERE task_id = ?")
      .all(taskId) as Array<Record<string, unknown>>;
    expect(problemRows).toHaveLength(1);
    expect(problemRows[0]?.problem_sheet).toContain("请确认是否是问题");

    // Rules aggregated with problem counts.
    const rules = data.rules.filter((r) => r.ruleCode === "R-1-1-1");
    expect(rules).toHaveLength(1);
    expect(rules[0]?.problemCount).toBe(1);
  });

  it("keeps an existing task's status when a report exists but no progress file (bind-undefined regression)", () => {
    const created = createStaticAnalysisTask(
      { kind: "windows", path: projectDir } as never,
      "project-1",
      { taskName: "t2", mode: "normal_fpga", selectedRules: [] },
    );
    const taskId = created.taskId;

    // Report only — no progress file. Must not throw (previously bound `undefined`).
    writeStatic(`${taskId}-normal_fpga-report.json`, {
      version: 1,
      problems: [],
      files: [],
    });

    const data = ingestStaticAnalysis({ kind: "windows", path: projectDir } as never, "project-1");
    const taskView = data.tasks.find((t) => t.taskId === taskId);
    expect(taskView?.status).toBe("pending");
    expect(taskView?.progress).toBe(100);
  });

  it("links an agent-written report (arbitrary task id) to the project's pending created task", () => {
    const created = createStaticAnalysisTask(
      { kind: "windows", path: projectDir } as never,
      "project-1",
      { taskName: "工具过滤", mode: "filter_c", selectedRules: ["R-1-1-1"] },
    );
    const taskId = created.taskId;

    // Agent names the file with its own id — the ingest must attach it to the
    // single pending created task of the same mode instead of creating a duplicate.
    writeStatic("agent-run-xyz-filter_c-report.json", {
      version: 1,
      selectedRules: ["R-1-1-1"],
      files: [{ file_path: "src/a.c", file_name: "a.c", source_code: "int a(){return 0;}" }],
      problems: [
        {
          id: "q1",
          file_name: "src/a.c",
          issue_name: "魔法数",
          issue_line: 7,
          issue_level: "一般问题",
          rule_code: "R-1-1-1",
          rule_type: "gjb",
          rule_accuracy_type: "accurate",
        },
      ],
    });

    const data = ingestStaticAnalysis({ kind: "windows", path: projectDir } as never, "project-1");
    expect(data.tasks).toHaveLength(1);
    const taskView = data.tasks[0];
    expect(taskView?.taskId).toBe(taskId);
    expect(taskView?.totalProblems).toBe(1);
    expect(data.problems[0]?.problemId).toBe("q1");
    const rows = getSqlite()
      .prepare("SELECT COUNT(*) AS c FROM static_analysis_tasks WHERE project_id = ?")
      .get("project-1") as { c: number };
    expect(rows.c).toBe(1);
  });

  it("returns empty state when there is no static-analysis directory", () => {
    rmSync(join(projectDir, "static-analysis"), { recursive: true, force: true });
    const data = ingestStaticAnalysis({ kind: "windows", path: projectDir } as never, "project-1");
    expect(data.tasks).toHaveLength(0);
    expect(data.problems).toHaveLength(0);
  });

  it("ignores malformed JSON reports without throwing", () => {
    writeFileSync(join(projectDir, "static-analysis", "t3-normal_c-report.json"), "{ not json", "utf8");
    writeFileSync(join(projectDir, "static-analysis", "t3-normal_c-progress.json"), "nope", "utf8");
    const data = ingestStaticAnalysis({ kind: "windows", path: projectDir } as never, "project-1");
    expect(data.tasks).toHaveLength(0);
    expect(data.problems).toHaveLength(0);
  });

  it("clears a project's rows and report dir while keeping the project", () => {
    const created = createStaticAnalysisTask(
      { kind: "windows", path: projectDir } as never,
      "project-1",
      { taskName: "t4", mode: "normal_c", selectedRules: [] },
    );
    writeStatic(`${created.taskId}-normal_c-report.json`, { version: 1, problems: [], files: [] });
    ingestStaticAnalysis({ kind: "windows", path: projectDir } as never, "project-1");

    clearProjectStaticAnalysis({ kind: "windows", path: projectDir } as never, "project-1");

    const rows = getSqlite()
      .prepare("SELECT COUNT(*) AS c FROM static_analysis_tasks WHERE project_id = ?")
      .get("project-1") as { c: number };
    expect(rows.c).toBe(0);
    expect(existsSync(join(projectDir, "static-analysis"))).toBe(false);
    const projectRows = getSqlite()
      .prepare("SELECT COUNT(*) AS c FROM projects WHERE id = ?")
      .get("project-1") as { c: number };
    expect(projectRows.c).toBe(1);
  });

  it("set/get global default rule configuration (保存为默认规则配置)", () => {
    // 初始为空
    expect(getStaticAnalysisDefaultRules()).toEqual([]);
    // 写入（含重复去重）
    setStaticAnalysisDefaultRules(["R-1-1-1", "R-1-1-1", "R-1-6-8"]);
    const defaults = getStaticAnalysisDefaultRules();
    expect(defaults).toEqual(["R-1-1-1", "R-1-6-8"]);
    // 幂等覆盖
    setStaticAnalysisDefaultRules(["R-1-1-13"]);
    expect(getStaticAnalysisDefaultRules()).toEqual(["R-1-1-13"]);
  });
});
