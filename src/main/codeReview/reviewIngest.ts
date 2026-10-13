import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ProjectLocation } from "@/shared/contracts";
import type { ReviewCreateTaskPayload, ReviewTaskView } from "@/shared/ipc";
import {
  parseProgressFile,
  parseRegressionDiffFile,
  parseReviewFile,
  parseReviewFileName,
  parseProgressFileName,
  type RegressionDiffReport,
  type ReviewCallGraph,
  type ReviewFeatureView,
  type ReviewFunctionInfo,
  type ReviewIssueView,
  type ReviewProgress,
} from "@/shared/codeReviewReport";
import { resolveProjectFsPath } from "@/main/attachments/localFiles";
import { getSqlite } from "@/main/db/connection";

const REVIEW_DIR = "reviews";

/**
 * The aggregated review state for one project, mirrored from its
 * `<project>/reviews/*.json` reports into the global `state.sqlite`. The
 * renderer queries this via the `reviewGetProjectData` IPC instead of reading
 * the report files directly, so the review task / issue / diff rows live in the
 * same database as projects.
 */
export interface ProjectReviewData {
  issues: readonly ReviewIssueView[];
  /** 当前主审查任务的进度（最近更新的 running，回退最新一个）。 */
  progress: ReviewProgress | null;
  diffReports: readonly RegressionDiffReport[];
  /** 该项目全部审查任务（创建即落库 + 报告摄入镜像合并）。 */
  tasks: readonly ReviewTaskView[];
  /** 各报告的函数功能概述（`function_info`），供问题单上方展示；无报告时为空。 */
  functionInfos: readonly ReviewFunctionInfo[];
  /** 各报告的功能模块（`features`），供四栏布局第一栏渲染；无报告时为空。 */
  features: readonly ReviewFeatureView[];
  /** 各报告的可选调用关系图（`callgraph`），按 taskId 索引；无则不含该键。 */
  callgraphs: Readonly<Record<string, ReviewCallGraph>>;
}

/** `kind` distinguishes the review type (function / chain / feature / regression). */
export type ReviewKind = "function" | "chain" | "feature" | "regression";

/** Infer the review type from a report file name. */
function inferKind(fileName: string): ReviewKind {
  if (/regression/i.test(fileName)) return "regression";
  const mode = parseReviewFileName(fileName)?.mode ?? parseProgressFileName(fileName)?.mode ?? null;
  if (mode === "function" || mode === "chain" || mode === "feature") return mode;
  return "regression";
}

/** Read a JSON report file under `<project>/reviews/`, tolerant of transient locks. */
function readJson(root: string, name: string): string | null {
  try {
    return readFileSync(join(root, REVIEW_DIR, name), "utf8");
  } catch {
    return null;
  }
}

interface TaskAgg {
  kind: ReviewKind;
  status: string;
  total: number;
  done: number;
  issueCount: number;
  diffCount: number;
  updatedAt: string | null;
}

const taskKey = (taskId: string, kind: ReviewKind): string => `${taskId}::${kind}`;

/**
 * Scan a project's `reviews/` directory, parse every report JSON, upsert the
 * rows into the global `state.sqlite`, and return the aggregated state. Called
 * by `reviewGetProjectData` on each poll so the database stays mirrored to the
 * reports the review skills wrote. Idempotent: rows are INSERT OR REPLACE'd.
 */
export function ingestProjectReviews(
  projectLocation: ProjectLocation,
  projectId: string,
): ProjectReviewData {
  const root = resolveProjectFsPath({ projectLocation });
  const dir = join(root, REVIEW_DIR);
  const data: ProjectReviewData = {
    issues: [],
    progress: null,
    diffReports: [],
    tasks: [],
    functionInfos: [],
    features: [],
    callgraphs: {},
  };
  // tasks 在所有分支（含无报告文件提前 return）都返回：创建即落库 + 报告镜像合并。
  data.tasks = getReviewTasks(projectId);
  if (!existsSync(dir)) return data;

  let files: string[];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return data;
  }
  if (files.length === 0) return data;

  const sqlite = getSqlite();
  // Upsert mirrors report counters into an existing (possibly create-first)
  // task row without clobbering its task_name / created_at.
  const upsertTask = sqlite.prepare(
    `INSERT INTO review_tasks
       (project_id, task_id, kind, status, total, done, issue_count, diff_count, updated_at, created_at, task_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
     ON CONFLICT(project_id, task_id, kind) DO UPDATE SET
       status = excluded.status,
       total = excluded.total,
       done = excluded.done,
       issue_count = excluded.issue_count,
       diff_count = excluded.diff_count,
       updated_at = excluded.updated_at`,
  );
  const deleteIssues = sqlite.prepare(
    "DELETE FROM review_issues WHERE project_id = ? AND task_id = ?",
  );
  const insertIssue = sqlite.prepare(
    `INSERT OR REPLACE INTO review_issues
       (project_id, task_id, issue_id, kind, file, function_name, line, type, severity, summary,
        description_issue, suggestion, impact, description_location, code_statement,
        problem_reason, issue_location, source_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const deleteDiffs = sqlite.prepare(
    "DELETE FROM review_diff_files WHERE project_id = ? AND task_id = ?",
  );
  const insertDiff = sqlite.prepare(
    `INSERT OR REPLACE INTO review_diff_files
       (project_id, task_id, path, status, left_content, right_content)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const deleteFeatures = sqlite.prepare(
    "DELETE FROM review_features WHERE project_id = ? AND task_id = ?",
  );
  const insertFeature = sqlite.prepare(
    `INSERT OR REPLACE INTO review_features
       (project_id, task_id, feature_id, parent_id, kind, ordinal, name, section, description,
        entry_function, status, files, functions, chain_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const agg = new Map<string, TaskAgg>();
  const allIssues: ReviewIssueView[] = [];
  const allFunctionInfos: ReviewFunctionInfo[] = [];
  const allFeatures: ReviewFeatureView[] = [];
  const callgraphs: Record<string, ReviewCallGraph> = {};
  const progressCandidates: ReviewProgress[] = [];
  const diffReports: RegressionDiffReport[] = [];
  const now = new Date().toISOString();

  for (const name of files) {
    const content = readJson(root, name);
    if (content === null) continue;

    if (/-regression-diff\.json$/i.test(name)) {
      const report = parseRegressionDiffFile(content, name);
      if (!report) continue;
      diffReports.push(report);
      deleteDiffs.run(projectId, report.taskId);
      const key = taskKey(report.taskId, "regression");
      const cur = agg.get(key) ?? {
        kind: "regression",
        status: "",
        total: 0,
        done: 0,
        issueCount: 0,
        diffCount: 0,
        updatedAt: null,
      };
      cur.diffCount += report.changedFiles.length;
      const reportedAt = report.updatedAt ?? null;
      if (reportedAt && (!cur.updatedAt || reportedAt > cur.updatedAt)) cur.updatedAt = reportedAt;
      agg.set(key, cur);
      for (const file of report.changedFiles) {
        insertDiff.run(
          projectId,
          report.taskId,
          file.path,
          file.status,
          file.left,
          file.right,
        );
      }
      continue;
    }

    if (/-progress\.json$/i.test(name)) {
      const progress = parseProgressFile(content, name);
      if (!progress) continue;
      progressCandidates.push(progress);
      const kind = inferKind(name);
      const key = taskKey(progress.taskId, kind);
      const cur = agg.get(key) ?? {
        kind,
        status: progress.status ?? "",
        total: 0,
        done: 0,
        issueCount: 0,
        diffCount: 0,
        updatedAt: null,
      };
      if (progress.status) cur.status = progress.status;
      if (progress.total > 0) cur.total = progress.total;
      if (progress.done > 0) cur.done = progress.done;
      if (progress.updatedAt && (!cur.updatedAt || progress.updatedAt > cur.updatedAt)) {
        cur.updatedAt = progress.updatedAt;
      }
      agg.set(key, cur);
      continue;
    }

    if (/-review\.json$/i.test(name)) {
      const report = parseReviewFile(content, name);
      if (!report) continue;
      const kind = inferKind(name);
      deleteIssues.run(projectId, report.taskId);
      const key = taskKey(report.taskId, kind);
      const cur = agg.get(key) ?? {
        kind,
        status: "",
        total: 0,
        done: 0,
        issueCount: 0,
        diffCount: 0,
        updatedAt: null,
      };
      cur.issueCount += report.issues.length;
      agg.set(key, cur);
      allFunctionInfos.push(...report.functionInfos);
      if (report.callgraph) callgraphs[report.taskId] = report.callgraph;
      // 功能模块平铺镜像：报告里的原始顺序即 ordinal（树形由 parent_id 还原）。
      deleteFeatures.run(projectId, report.taskId);
      report.features.forEach((feature, ordinal) => {
        allFeatures.push(feature);
        insertFeature.run(
          projectId,
          report.taskId,
          feature.id,
          feature.parentId,
          kind,
          ordinal,
          feature.name,
          feature.section || null,
          feature.description || null,
          feature.entryFunction || null,
          feature.status || null,
          JSON.stringify(feature.files),
          JSON.stringify(feature.functions),
          JSON.stringify(feature.chainOrder),
        );
      });
      for (const issue of report.issues) {
        allIssues.push(issue);
        insertIssue.run(
          projectId,
          report.taskId,
          issue.id,
          kind,
          issue.file,
          issue.functionName,
          issue.line,
          issue.type,
          issue.severity,
          issue.summary,
          issue.descriptionIssue,
          issue.suggestion,
          issue.impact,
          issue.descriptionLocation,
          issue.codeStatement,
          issue.problemReason,
          issue.issueLocation,
          issue.sourceCode,
        );
      }
    }
  }

  for (const [key, cur] of agg) {
    const sep = key.indexOf("::");
    const taskId = key.slice(0, sep);
    upsertTask.run(
      projectId,
      taskId,
      cur.kind,
      cur.status,
      cur.total,
      cur.done,
      cur.issueCount,
      cur.diffCount,
      cur.updatedAt,
      now,
    );
  }

  // 进度：优先最近更新的 running/paused，否则最新一个（与渲染端原逻辑一致）。
  let primary: { progress: ReviewProgress; score: number } | null = null;
  for (const progress of progressCandidates) {
    const ts = progress.updatedAt ? new Date(progress.updatedAt).getTime() || 0 : 0;
    const runningWeight = progress.status === "running" ? 1 : 0;
    const score = runningWeight * Number.MAX_SAFE_INTEGER + ts;
    if (!primary || score > primary.score) primary = { progress, score };
  }

  data.issues = allIssues;
  data.functionInfos = allFunctionInfos;
  data.features = allFeatures;
  data.callgraphs = callgraphs;
  data.progress = primary?.progress ?? null;
  data.diffReports = diffReports;
  return data;
}

interface ReviewTaskRow {
  task_id: string;
  kind: string;
  task_name: string;
  status: string;
  total: number;
  done: number;
  issue_count: number;
  diff_count: number;
  updated_at: string | null;
  created_at: string | null;
}

function toTaskView(row: ReviewTaskRow): ReviewTaskView {
  const kind = row.kind as ReviewTaskView["kind"];
  return {
    taskId: row.task_id,
    kind: kind === "function" || kind === "chain" || kind === "feature" || kind === "regression" ? kind : "regression",
    taskName: row.task_name,
    status: row.status,
    total: row.total,
    done: row.done,
    issueCount: row.issue_count,
    diffCount: row.diff_count,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

/**
 * Create a code-review task and persist it immediately (创建任务即落库), aligned
 * with static-analysis. The row is written before any review starts; the ingest
 * service later updates status/counters from the agent-written report files
 * (preserving this row's task_name / created_at).
 */
export function createReviewTask(
  projectLocation: ProjectLocation,
  projectId: string,
  input: ReviewCreateTaskPayload,
): ReviewTaskView {
  const taskId = randomUUID();
  const now = new Date().toISOString();
  const sqlite = getSqlite();
  sqlite
    .prepare(
      `INSERT INTO review_tasks
         (project_id, task_id, kind, task_name, status, total, done, issue_count, diff_count, updated_at, created_at)
       VALUES (?, ?, ?, ?, 'pending', 0, 0, 0, 0, ?, ?)`,
    )
    .run(projectId, taskId, input.kind, input.taskName, now, now);
  return {
    taskId,
    kind: input.kind,
    taskName: input.taskName,
    status: "pending",
    total: 0,
    done: 0,
    issueCount: 0,
    diffCount: 0,
    updatedAt: now,
    createdAt: now,
  };
}

/** All persisted review tasks for a project (create-first + report-mirrored). */
export function getReviewTasks(projectId: string): ReviewTaskView[] {
  const sqlite = getSqlite();
  const rows = sqlite
    .prepare(
      `SELECT task_id, kind, task_name, status, total, done, issue_count, diff_count, updated_at, created_at
       FROM review_tasks WHERE project_id = ? ORDER BY created_at DESC`,
    )
    .all(projectId) as ReviewTaskRow[];
  return rows.map(toTaskView);
}

/** Remove a project's persisted review rows (called when its review records are cleared). */
export function clearProjectReviewRows(projectId: string): void {
  const sqlite = getSqlite();
  sqlite.prepare("DELETE FROM review_issues WHERE project_id = ?").run(projectId);
  sqlite.prepare("DELETE FROM review_diff_files WHERE project_id = ?").run(projectId);
  sqlite.prepare("DELETE FROM review_features WHERE project_id = ?").run(projectId);
  sqlite.prepare("DELETE FROM review_tasks WHERE project_id = ?").run(projectId);
}
