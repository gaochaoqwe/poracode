import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ProjectLocation } from "@/shared/contracts";
import {
  parseStaticAnalysisProgressFile,
  parseStaticAnalysisReportFile,
  type StaticAnalysisFile,
  type StaticAnalysisMode,
  type StaticAnalysisProblem,
  type StaticAnalysisProgress,
  type StaticAnalysisProjectData,
  type StaticAnalysisReport,
  type StaticAnalysisRule,
  type StaticAnalysisRuleType,
  type StaticAnalysisTaskView,
} from "@/shared/staticAnalysisReport";
import { resolveProjectFsPath } from "@/main/attachments/localFiles";
import { getSqlite } from "@/main/db/connection";

const STATIC_DIR = "static-analysis";

export type { StaticAnalysisProjectData, StaticAnalysisTaskView };

export interface CreateStaticAnalysisTaskInput {
  taskName: string;
  mode: StaticAnalysisMode;
  selectedRules: readonly string[];
  excelFile?: string | null;
  codebasePath?: string | null;
}

function domainForMode(mode: StaticAnalysisMode): string {
  switch (mode) {
    case "normal_c":
      return "normalModeC";
    case "normal_fpga":
      return "normalModeFpga";
    case "filter_c":
      return "filter";
    case "filter_fpga":
      return "filterFpga";
  }
}

const MODE_PATTERN = /^(.+)-(\w+)-report\.json$/i;

function modeFromFileName(fileName: string): StaticAnalysisMode | null {
  const match = MODE_PATTERN.exec(fileName);
  if (!match) return null;
  const mode = (match[2] ?? "").toLowerCase();
  return mode === "normal_c" ||
    mode === "normal_fpga" ||
    mode === "filter_c" ||
    mode === "filter_fpga"
    ? mode
    : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Create a static-analysis task and persist it immediately (创建任务即落库).
 * The row is written before any analysis starts; the ingest service later
 * updates status/progress/counters from the agent-written report files.
 */
export function createStaticAnalysisTask(
  projectLocation: ProjectLocation,
  projectId: string,
  input: CreateStaticAnalysisTaskInput,
): StaticAnalysisTaskView {
  seedStaticAnalysisRules();
  const taskId = randomUUID();
  const now = new Date().toISOString();
  const sqlite = getSqlite();
  sqlite
    .prepare(
      `INSERT INTO static_analysis_tasks
         (project_id, task_id, task_name, mode, domain, status, progress,
          selected_rules, excel_file, codebase_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?)`,
    )
    .run(
      projectId,
      taskId,
      input.taskName,
      input.mode,
      domainForMode(input.mode),
      JSON.stringify([...input.selectedRules]),
      input.excelFile ?? null,
      input.codebasePath ?? null,
      now,
      now,
    );
  return {
    taskId,
    taskName: input.taskName,
    mode: input.mode,
    domain: domainForMode(input.mode),
    status: "pending",
    progress: 0,
    totalFiles: 0,
    processedFiles: 0,
    totalProblems: 0,
    totalRules: 0,
    accurateRules: 0,
    uncertainRules: 0,
    totalUnits: 0,
    processedUnits: 0,
    currentRuleCode: null,
    currentAnalyzingIssue: null,
    toolCallsCount: 0,
    selectedRules: [...input.selectedRules],
    excelFile: input.excelFile ?? null,
    codebasePath: input.codebasePath ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

interface TaskRow {
  task_id: string;
  task_name: string;
  mode: string;
  domain: string;
  status: string;
  progress: number;
  total_files: number;
  processed_files: number;
  total_problems: number;
  total_rules: number;
  accurate_rules: number;
  uncertain_rules: number;
  total_units: number;
  processed_units: number;
  current_rule_code: string | null;
  current_analyzing_issue: string | null;
  tool_calls_count: number;
  selected_rules: string;
  excel_file: string | null;
  codebase_path: string | null;
  created_at: string;
  updated_at: string;
}

function toTaskView(row: TaskRow): StaticAnalysisTaskView {
  const mode = row.mode as StaticAnalysisMode;
  return {
    taskId: row.task_id,
    taskName: row.task_name,
    mode: mode === "normal_c" || mode === "normal_fpga" || mode === "filter_c" || mode === "filter_fpga" ? mode : null,
    domain: row.domain,
    status: row.status,
    progress: row.progress,
    totalFiles: row.total_files,
    processedFiles: row.processed_files,
    totalProblems: row.total_problems,
    totalRules: row.total_rules,
    accurateRules: row.accurate_rules,
    uncertainRules: row.uncertain_rules,
    totalUnits: row.total_units,
    processedUnits: row.processed_units,
    currentRuleCode: row.current_rule_code,
    currentAnalyzingIssue: row.current_analyzing_issue,
    toolCallsCount: row.tool_calls_count,
    selectedRules: parseRuleList(row.selected_rules),
    excelFile: row.excel_file,
    codebasePath: row.codebase_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseRuleList(json: string): readonly string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.map((r) => asString(r)).filter((r) => r.length > 0) : [];
  } catch {
    return [];
  }
}

function readJson(root: string, name: string): string | null {
  try {
    return readFileSync(join(root, STATIC_DIR, name), "utf8");
  } catch {
    return null;
  }
}

/**
 * Scan a project's `static-analysis/` directory, parse report/progress JSON,
 * upsert rows into the global `state.sqlite`, and return the aggregated state.
 * Idempotent; mirrors whatever the agent skill wrote.
 */
export function ingestStaticAnalysis(
  projectLocation: ProjectLocation,
  projectId: string,
): StaticAnalysisProjectData {
  seedStaticAnalysisRules();
  const root = resolveProjectFsPath({ projectLocation });
  const dir = join(root, STATIC_DIR);
  const empty: StaticAnalysisProjectData = { tasks: [], problems: [], files: [], rules: [] };
  if (!existsSync(dir)) return empty;

  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return empty;
  }
  if (names.length === 0) return empty;

  const sqlite = getSqlite();
  const upsertTask = sqlite.prepare(
    `INSERT OR REPLACE INTO static_analysis_tasks
       (project_id, task_id, task_name, mode, domain, status, progress, total_files,
        processed_files, total_problems, total_rules, accurate_rules, uncertain_rules,
        total_units, processed_units, current_rule_code, current_analyzing_issue,
        tool_calls_count, selected_rules, excel_file, codebase_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const deleteProblems = sqlite.prepare(
    "DELETE FROM static_analysis_problems WHERE project_id = ? AND task_id = ?",
  );
  const insertProblem = sqlite.prepare(
    `INSERT OR REPLACE INTO static_analysis_problems
       (project_id, task_id, problem_id, issue_name, issue_file, issue_line, issue_location,
        issue_description, issue_level, rule_code, rule_type, rule_accuracy_type,
        ai_analyzed, ai_is_real_issue, ai_confidence, ai_analysis_result, ai_reasoning,
        ai_recommendations, problem_status, is_filtered, filter_reason, file_name,
        violation_rules, description_requirement, description_issue, description_location,
        description_impact, problem_sheet, function_name, source_code, sheet_name, row_index)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const deleteFiles = sqlite.prepare(
    "DELETE FROM static_analysis_files WHERE project_id = ? AND task_id = ?",
  );
  const insertFile = sqlite.prepare(
    `INSERT OR REPLACE INTO static_analysis_files
       (project_id, task_id, file_name, file_path, source_code)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const reports = new Map<string, StaticAnalysisReport>();
  const progresses = new Map<string, StaticAnalysisProgress>();
  const now = new Date().toISOString();

  for (const name of names) {
    const content = readJson(root, name);
    if (content === null) continue;
    if (/-report\.json$/i.test(name)) {
      const report = parseStaticAnalysisReportFile(content, name);
      if (report?.taskId) reports.set(report.taskId, report);
    } else if (/-progress\.json$/i.test(name)) {
      const progress = parseStaticAnalysisProgressFile(content, name);
      if (progress?.taskId) progresses.set(progress.taskId, progress);
    }
  }

  for (const [taskId, report] of reports) {
    const progress = progresses.get(taskId);
    const mode = report.mode ?? progress?.mode ?? modeFromFileName(report.fileName);
    // 任务关联：报告文件名里的 taskId 若找不到行，则自动关联该项目同模式下唯一
    // 的 pending 任务（即模块里"创建任务即落库"的那一行），避免出现重复任务。
    let effectiveTaskId = taskId;
    let existing = sqlite
      .prepare(
        "SELECT task_name, domain, status, excel_file, codebase_path, selected_rules, created_at FROM static_analysis_tasks WHERE project_id = ? AND task_id = ?",
      )
      .get(projectId, taskId) as
      | { task_name: string; domain: string; status: string; excel_file: string | null; codebase_path: string | null; selected_rules: string; created_at: string }
      | undefined;
    if (!existing) {
      const pending = sqlite
        .prepare(
          "SELECT task_id, task_name, domain, excel_file, codebase_path, selected_rules, created_at FROM static_analysis_tasks WHERE project_id = ? AND mode = ? AND status = 'pending' ORDER BY created_at LIMIT 1",
        )
        .get(projectId, mode ?? "") as
        | { task_id: string; task_name: string; domain: string; excel_file: string | null; codebase_path: string | null; selected_rules: string; created_at: string }
        | undefined;
      if (pending) {
        effectiveTaskId = pending.task_id;
        existing = {
          task_name: pending.task_name,
          domain: pending.domain,
          status: "pending",
          excel_file: pending.excel_file,
          codebase_path: pending.codebase_path,
          selected_rules: pending.selected_rules,
          created_at: pending.created_at,
        };
      }
    }
    upsertTask.run(
      projectId,
      effectiveTaskId,
      existing?.task_name ?? `静态分析-${effectiveTaskId.slice(0, 8)}`,
      mode ?? "",
      existing?.domain ?? (mode ? domainForMode(mode) : ""),
      progress?.status ?? existing?.status ?? "completed",
      progress?.progress ?? 100,
      progress?.totalFiles ?? report.files.length,
      progress?.processedFiles ?? report.files.length,
      report.problems.length,
      progress?.totalRules ?? 0,
      progress?.accurateRules ?? 0,
      progress?.uncertainRules ?? 0,
      progress?.totalUnits ?? 0,
      progress?.processedUnits ?? 0,
      progress?.currentRuleCode ?? null,
      progress?.currentAnalyzingIssue ?? null,
      progress?.toolCallsCount ?? 0,
      JSON.stringify([...(report.selectedRules.length > 0 ? report.selectedRules : parseRuleList(existing?.selected_rules ?? "[]"))]),
      existing?.excel_file ?? null,
      existing?.codebase_path ?? null,
      existing?.created_at ?? now,
      progress?.updatedAt ?? now,
    );

    deleteProblems.run(projectId, effectiveTaskId);
    for (const problem of report.problems) {
      insertProblem.run(
        projectId,
        effectiveTaskId,
        problem.problemId,
        problem.issue_name,
        problem.issue_file,
        problem.issue_line,
        problem.issue_location,
        problem.issue_description,
        problem.issue_level,
        problem.rule_code,
        problem.rule_type,
        problem.rule_accuracy_type,
        problem.ai_analyzed ? 1 : 0,
        problem.ai_is_real_issue === null ? null : problem.ai_is_real_issue ? 1 : 0,
        problem.ai_confidence,
        problem.ai_analysis_result,
        problem.ai_reasoning,
        problem.ai_recommendations,
        problem.problem_status,
        problem.is_filtered ? 1 : 0,
        problem.filter_reason,
        problem.file_name,
        problem.violation_rules,
        problem.description_requirement,
        problem.description_issue,
        problem.description_location,
        problem.description_impact,
        problem.problem_sheet ? JSON.stringify(problem.problem_sheet) : null,
        problem.function_name,
        problem.source_code,
        problem.sheet_name,
        problem.row_index,
      );
    }

    deleteFiles.run(projectId, effectiveTaskId);
    for (const file of report.files) {
      insertFile.run(projectId, effectiveTaskId, file.file_name, file.file_path, file.source_code);
    }
  }

  return buildProjectData(sqlite, projectId);
}

function buildProjectData(sqlite: ReturnType<typeof getSqlite>, projectId: string): StaticAnalysisProjectData {
  const taskRows = sqlite
    .prepare("SELECT * FROM static_analysis_tasks WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as unknown as TaskRow[];
  const tasks = taskRows.map(toTaskView);

  const problemRows = sqlite
    .prepare(
      `SELECT problem_id, task_id, issue_name, issue_file, issue_line, issue_location,
              issue_description, issue_level, rule_code, rule_type, rule_accuracy_type,
              ai_analyzed, ai_is_real_issue, ai_confidence, ai_analysis_result, ai_reasoning,
              ai_recommendations, problem_status, is_filtered, filter_reason, file_name,
              violation_rules, description_requirement, description_issue, description_location,
              description_impact, problem_sheet, function_name, source_code, sheet_name, row_index
       FROM static_analysis_problems WHERE project_id = ? ORDER BY issue_file, issue_line`,
    )
    .all(projectId) as unknown as Array<Record<string, unknown>>;
  const problems: StaticAnalysisProblem[] = problemRows.map((row) => {
    let problemSheet: StaticAnalysisProblem["problem_sheet"] = null;
    try {
      const sheet = row.problem_sheet ? JSON.parse(String(row.problem_sheet)) : null;
      if (sheet && typeof sheet === "object") {
        problemSheet = {
          issue_name: asString((sheet as Record<string, unknown>).issue_name),
          four_part_description: asString((sheet as Record<string, unknown>).four_part_description),
          test_unit_opinion: asString((sheet as Record<string, unknown>).test_unit_opinion),
        };
      }
    } catch {
      problemSheet = null;
    }
    return {
      problemId: asString(row.problem_id),
      issue_name: asString(row.issue_name),
      issue_file: asString(row.issue_file),
      issue_line: typeof row.issue_line === "number" ? row.issue_line : null,
      issue_location: asString(row.issue_location),
      issue_description: asString(row.issue_description),
      issue_level: asString(row.issue_level),
      rule_code: asString(row.rule_code),
      rule_type: (["gjb", "cwe", "fpga"].includes(String(row.rule_type)) ? String(row.rule_type) : null) as StaticAnalysisRuleType | null,
      rule_accuracy_type: asString(row.rule_accuracy_type),
      ai_analyzed: Number(row.ai_analyzed) === 1,
      ai_is_real_issue: row.ai_is_real_issue === null ? null : Number(row.ai_is_real_issue) === 1,
      ai_confidence: typeof row.ai_confidence === "number" ? row.ai_confidence : null,
      ai_analysis_result: asString(row.ai_analysis_result),
      ai_reasoning: asString(row.ai_reasoning),
      ai_recommendations: asString(row.ai_recommendations),
      problem_status: typeof row.problem_status === "number" ? row.problem_status : 0,
      is_filtered: Number(row.is_filtered) === 1,
      filter_reason: asString(row.filter_reason),
      file_name: asString(row.file_name),
      violation_rules: asString(row.violation_rules),
      description_requirement: asString(row.description_requirement),
      description_issue: asString(row.description_issue),
      description_location: asString(row.description_location),
      description_impact: asString(row.description_impact),
      problem_sheet: problemSheet,
      function_name: asString(row.function_name),
      source_code: asString(row.source_code),
      sheet_name: asString(row.sheet_name),
      row_index: typeof row.row_index === "number" ? row.row_index : null,
    };
  });

  const fileRows = sqlite
    .prepare("SELECT file_name, file_path, source_code FROM static_analysis_files WHERE project_id = ? ORDER BY file_path")
    .all(projectId) as unknown as Array<{ file_name: string; file_path: string; source_code: string }>;
  const files: StaticAnalysisFile[] = fileRows.map((row) => ({
    file_name: row.file_name,
    file_path: row.file_path,
    source_code: row.source_code,
  }));

  const countByRule = new Map<string, number>();
  for (const problem of problems) {
    if (problem.rule_code) {
      countByRule.set(problem.rule_code, (countByRule.get(problem.rule_code) ?? 0) + 1);
    }
  }

  const ruleRows = sqlite
    .prepare("SELECT rule_code, rule_type, rule_name, rule_description, category, accuracy_type, analysis_complexity, detection_method, keywords FROM static_analysis_rules")
    .all() as unknown as Array<Record<string, unknown>>;
  const rules: StaticAnalysisRule[] = ruleRows.map((row) => {
    let keywords: StaticAnalysisRule["keywords"] = [];
    try {
      const parsed: unknown = JSON.parse(asString(row.keywords, "[]"));
      if (Array.isArray(parsed)) {
        keywords = parsed
          .map((k) => {
            if (!k || typeof k !== "object") return null;
            const rec = k as Record<string, unknown>;
            return { keyword: asString(rec.keyword), keywordType: typeof rec.keyword_type === "string" ? rec.keyword_type : null };
          })
          .filter((k): k is StaticAnalysisRule["keywords"][number] => k !== null);
      }
    } catch {
      keywords = [];
    }
    const ruleCode = asString(row.rule_code);
    return {
      ruleCode,
      ruleType: (["gjb", "cwe", "fpga"].includes(String(row.rule_type)) ? String(row.rule_type) : "gjb") as StaticAnalysisRuleType,
      ruleName: asString(row.rule_name),
      ruleDescription: asString(row.rule_description),
      category: asString(row.category),
      accuracyType: asString(row.accuracy_type, "uncertain") === "accurate" ? "accurate" : "uncertain",
      analysisComplexity: asString(row.analysis_complexity),
      detectionMethod: asString(row.detection_method),
      keywords,
      problemCount: countByRule.get(ruleCode) ?? 0,
      isSelected: false,
    };
  });

  return { tasks, problems, files, rules };
}

/** Seed the GJB8114 / CWE rule library from the bundled assets, once. */
export function seedStaticAnalysisRules(): void {
  const sqlite = getSqlite();
  const existing = sqlite
    .prepare("SELECT COUNT(*) AS c FROM static_analysis_rules")
    .get() as { c: number };
  if (existing.c > 0) return;

  // 候选规则库路径：打包(extraResources) / dist/main / src 源码与 vitest 测试。
  const candidates = [
    ...(typeof process.resourcesPath === "string"
      ? [join(process.resourcesPath, "static-analysis", "rules")]
      : []),
    join(__dirname, "..", "..", "resources", "static-analysis", "rules"),
    join(__dirname, "..", "..", "..", "resources", "static-analysis", "rules"),
  ];
  const rulesDir = candidates.find((p) => existsSync(p));
  if (!rulesDir) return;
  const insert = sqlite.prepare(
    `INSERT OR REPLACE INTO static_analysis_rules
       (rule_code, rule_type, rule_name, rule_description, category, accuracy_type,
        analysis_complexity, detection_method, keywords)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const seed = (fileName: string, ruleType: StaticAnalysisRuleType): void => {
    const path = join(rulesDir, fileName);
    if (!existsSync(path)) return;
    let rows: unknown;
    try {
      rows = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return;
    }
    if (!Array.isArray(rows)) return;
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const record = raw as Record<string, unknown>;
      insert.run(
        asString(record.rule_code),
        ruleType,
        asString(record.rule_name),
        asString(record.rule_description),
        asString(record.category),
        asString(record.accuracy_type, "uncertain") === "accurate" ? "accurate" : "uncertain",
        asString(record.analysis_complexity),
        asString(record.detection_method),
        JSON.stringify(
          Array.isArray(record.keywords)
            ? record.keywords.filter((k): k is Record<string, unknown> => Boolean(k) && typeof k === "object")
            : [],
        ),
      );
    }
  };
  seed("gjb8114.json", "gjb");
  seed("cwe.json", "cwe");
}

/** All rules from the library (problem counts filled in by buildProjectData). */
export function getStaticAnalysisRules(): StaticAnalysisRule[] {
  seedStaticAnalysisRules();
  const sqlite = getSqlite();
  const ruleRows = sqlite
    .prepare("SELECT rule_code, rule_type, rule_name, rule_description, category, accuracy_type, analysis_complexity, detection_method, keywords FROM static_analysis_rules ORDER BY rule_type, rule_code")
    .all() as unknown as Array<Record<string, unknown>>;
  return ruleRows.map((row) => {
    let keywords: StaticAnalysisRule["keywords"] = [];
    try {
      const parsed: unknown = JSON.parse(asString(row.keywords, "[]"));
      if (Array.isArray(parsed)) {
        keywords = parsed
          .map((k) => {
            if (!k || typeof k !== "object") return null;
            const rec = k as Record<string, unknown>;
            return { keyword: asString(rec.keyword), keywordType: typeof rec.keyword_type === "string" ? rec.keyword_type : null };
          })
          .filter((k): k is StaticAnalysisRule["keywords"][number] => k !== null);
      }
    } catch {
      keywords = [];
    }
    return {
      ruleCode: asString(row.rule_code),
      ruleType: (["gjb", "cwe", "fpga"].includes(String(row.rule_type)) ? String(row.rule_type) : "gjb") as StaticAnalysisRuleType,
      ruleName: asString(row.rule_name),
      ruleDescription: asString(row.rule_description),
      category: asString(row.category),
      accuracyType: asString(row.accuracy_type, "uncertain") === "accurate" ? "accurate" : "uncertain",
      analysisComplexity: asString(row.analysis_complexity),
      detectionMethod: asString(row.detection_method),
      keywords,
      problemCount: 0,
      isSelected: false,
    };
  });
}

/** 全局默认选中的规则码集合（"保存为默认规则配置"写入，合并 gjb+cwe）。 */
export function getStaticAnalysisDefaultRules(): string[] {
  const sqlite = getSqlite();
  const row = sqlite
    .prepare("SELECT selected_rules FROM static_analysis_default_rules WHERE id = 1")
    .get() as { selected_rules: string } | undefined;
  if (!row) return [];
  try {
    const parsed: unknown = JSON.parse(row.selected_rules);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    /* ignore */
  }
  return [];
}

/** 把当前勾选的规则码集合保存为全局默认配置（幂等去重）。 */
export function setStaticAnalysisDefaultRules(selectedRules: string[]): string[] {
  const now = new Date().toISOString();
  getSqlite()
    .prepare(
      `INSERT INTO static_analysis_default_rules (id, selected_rules, updated_at)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET selected_rules = excluded.selected_rules, updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify([...new Set(selectedRules)]), now);
  return getStaticAnalysisDefaultRules();
}

/** Update one problem's audit status (0 新发现 / 1 已查看 / 2 已过滤 / 3 已标记). */
export function setStaticAnalysisProblemStatus(
  projectId: string,
  taskId: string,
  problemId: string,
  status: number,
): void {
  getSqlite()
    .prepare(
      "UPDATE static_analysis_problems SET problem_status = ? WHERE project_id = ? AND task_id = ? AND problem_id = ?",
    )
    .run(status, projectId, taskId, problemId);
}

/** Remove a project's static-analysis rows and its report directory (项目保留). */
export function clearProjectStaticAnalysis(
  projectLocation: ProjectLocation,
  projectId: string,
): void {
  const sqlite = getSqlite();
  sqlite.prepare("DELETE FROM static_analysis_problems WHERE project_id = ?").run(projectId);
  sqlite.prepare("DELETE FROM static_analysis_files WHERE project_id = ?").run(projectId);
  sqlite.prepare("DELETE FROM static_analysis_tasks WHERE project_id = ?").run(projectId);
  sqlite.prepare("DELETE FROM static_analysis_marked_problems WHERE project_id = ?").run(projectId);
  try {
    const dir = join(resolveProjectFsPath({ projectLocation }), STATIC_DIR);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  } catch {
    // Report dir already gone or unresolvable — rows are cleared regardless.
  }
}
