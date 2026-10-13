import type { Project, ProjectLocation } from "@/shared/contracts";
import type { ReviewProjectData } from "@/shared/ipc/schemas";
import type { StaticAnalysisTaskView } from "@/shared/staticAnalysisReport";
import { staticAnalysisModeLabel } from "@/shared/staticAnalysisReport";
import { readBridge } from "@/renderer/bridge";

/**
 * One card on the project board: what a single project has accumulated in the
 * code-review / static-analysis stores. Derived purely from the two module
 * payloads so the aggregation stays unit-testable without a bridge.
 */
export interface ProjectBoardEntry {
  project: Project;
  issueCount: number;
  diffCount: number;
  /** 最近一次更新（毫秒时间戳；无进度文件为 0）。 */
  lastUpdatedAt: number;
  status: "running" | "paused" | "done" | null;
  taskIds: readonly string[];
  modes: readonly string[];
  hasReview: boolean;
  hasDiff: boolean;
  staticTasks: readonly StaticAnalysisTaskView[];
  staticTotalProblems: number;
}

/** 定位的目录展示文本。 */
export function projectLocationLabel(location: ProjectLocation | undefined): string {
  if (!location) return "（无位置）";
  if (location.kind === "wsl") return `WSL ${location.distro ?? ""} ${location.linuxPath ?? ""}`;
  if (location.kind === "windows") return location.path ?? "（Windows）";
  return location.kind;
}

const STATUS_LABELS: Record<NonNullable<ProjectBoardEntry["status"]>, string> = {
  running: "进行中",
  paused: "已暂停",
  done: "已完成",
};

export function projectStatusLabel(status: NonNullable<ProjectBoardEntry["status"]>): string {
  return STATUS_LABELS[status];
}

/** 静态分析任务的模式串（如「纯AI / 工具」）。 */
export function staticModesLabel(tasks: readonly StaticAnalysisTaskView[]): string {
  return tasks.map((task) => staticAnalysisModeLabel(task.mode)).join(" / ");
}

export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  if (!ts) return "—";
  const date = new Date(ts);
  const diffMin = Math.floor((now - ts) / 60000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)} 小时前`;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Fold the review + static-analysis payloads of one project into a board entry.
 * Returns null when the project has no records at all, so the board only lists
 * projects that actually ran a scenario.
 */
export function buildProjectBoardEntry(
  project: Project,
  data: ReviewProjectData,
  staticData: { tasks: readonly StaticAnalysisTaskView[]; problems: readonly unknown[] },
): ProjectBoardEntry | null {
  const issueCount = data.issues.length;
  const diffCount = data.diffReports.length;
  const staticTotalProblems = staticData.problems.length;
  if (issueCount === 0 && diffCount === 0 && !data.progress && staticData.tasks.length === 0) {
    return null;
  }

  const taskIds = new Set<string>();
  const modes = new Set<string>();
  for (const issue of data.issues) {
    if (issue.taskId) taskIds.add(issue.taskId);
    if (issue.mode) modes.add(issue.mode);
  }
  for (const diff of data.diffReports) {
    if (diff.taskId) taskIds.add(diff.taskId);
  }
  if (data.progress) {
    if (data.progress.taskId) taskIds.add(data.progress.taskId);
    if (data.progress.mode) modes.add(data.progress.mode);
  }

  let lastUpdatedAt = 0;
  if (data.progress?.updatedAt) lastUpdatedAt = new Date(data.progress.updatedAt).getTime() || 0;
  for (const diff of data.diffReports) {
    const ts = diff.updatedAt ? new Date(diff.updatedAt).getTime() || 0 : 0;
    if (ts > lastUpdatedAt) lastUpdatedAt = ts;
  }
  for (const task of staticData.tasks) {
    const ts = task.updatedAt ? new Date(task.updatedAt).getTime() || 0 : 0;
    if (ts > lastUpdatedAt) lastUpdatedAt = ts;
  }

  return {
    project,
    issueCount,
    diffCount,
    lastUpdatedAt,
    status: data.progress?.status ?? null,
    taskIds: [...taskIds],
    modes: [...modes],
    hasReview: issueCount > 0,
    hasDiff: diffCount > 0,
    staticTasks: staticData.tasks,
    staticTotalProblems,
  };
}

const EMPTY_REVIEW_DATA: ReviewProjectData = {
  issues: [],
  progress: null,
  diffReports: [],
  tasks: [],
  functionInfos: [],
  features: [],
  callgraphs: {},
};

/** 读全局库汇总单个项目；无审查记录返回 null。 */
async function loadProjectBoardEntry(project: Project): Promise<ProjectBoardEntry | null> {
  const location = project.location;
  if (!location) return null;
  let data: ReviewProjectData;
  let staticData: { tasks: readonly StaticAnalysisTaskView[]; problems: readonly unknown[] };
  try {
    data = await readBridge().reviewGetProjectData({ projectLocation: location, projectId: project.id });
  } catch {
    data = EMPTY_REVIEW_DATA;
  }
  try {
    staticData = await readBridge().staticAnalysisGetProjectData({
      projectLocation: location,
      projectId: project.id,
    });
  } catch {
    staticData = { tasks: [], problems: [] };
  }
  return buildProjectBoardEntry(project, data, staticData);
}

/** 扫描全部项目，返回最近更新在前的看板卡片；单个项目失败不影响其余项目。 */
export async function loadProjectBoard(
  projects: readonly Project[],
): Promise<ProjectBoardEntry[]> {
  const entries: ProjectBoardEntry[] = [];
  for (const project of projects) {
    try {
      const entry = await loadProjectBoardEntry(project);
      if (entry) entries.push(entry);
    } catch {
      // 单个项目扫描失败不影响其余项目
    }
  }
  entries.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt || b.issueCount - a.issueCount);
  return entries;
}
