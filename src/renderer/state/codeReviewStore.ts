import { useEffect } from "react";
import { create } from "zustand";
import type { ProjectLocation } from "@/shared/contracts";
import type { ReviewIssueStatus, ReviewTaskView } from "@/shared/ipc";
import { readBridge } from "@/renderer/bridge";
import {
  sameReviewFileExact,
  type RegressionDiffReport,
  type ReviewCallGraph,
  type ReviewFeatureView,
  type ReviewFunctionInfo,
  type ReviewIssueView,
  type ReviewMode,
  type ReviewProgress,
} from "./codeReviewReport";

/**
 * Ref-counted poller for the code-review panel. Queries the global `state.sqlite`
 * via the `reviewGetProjectData` IPC (the main process ingests the project's
 * `reviews/*.json` reports into the DB and returns the aggregated state), then
 * merges the persisted 4-state audit flags from the project sqlite. One poll
 * loop per project, keyed by projectId.
 */

const ACTIVE_POLL_MS = 3000;

interface PollerState {
  location: ProjectLocation;
  refCount: number;
  timer: ReturnType<typeof setTimeout> | null;
  cancelled: boolean;
}

interface ProjectReviewState {
  issues: readonly ReviewIssueView[];
  /** key = `${taskId}::${issueId}` -> status */
  statuses: Readonly<Record<string, ReviewIssueStatus>>;
  /** 当前主审查任务的进度（最近更新的 running progress，回退最新一个） */
  progress: ReviewProgress | null;
  /** 回归审查的差异数据（供前端 DiffEditor 渲染） */
  diffReports: readonly RegressionDiffReport[];
  /** 该项目全部审查任务（创建即落库 + 报告摄入镜像合并）。 */
  tasks: readonly ReviewTaskView[];
  /** 各报告的函数功能概述（`function_info`），问题单上方常显区块渲染用。 */
  functionInfos: readonly ReviewFunctionInfo[];
  /** 各报告的功能模块（`features`），链路 / 功能审查四栏第一栏渲染用。 */
  features: readonly ReviewFeatureView[];
  /** 各报告的可选调用关系图（`callgraph`），按 taskId 索引，链路审查第二栏用。 */
  callgraphs: Readonly<Record<string, ReviewCallGraph>>;
  loading: boolean;
  /** Guard against concurrent sqlite read races in the same tick. */
  polling: boolean;
}

export interface ReviewFilters {
  query: string;
  /** true = AND (all terms), false = OR (any term). */
  andMode: boolean;
  mode: ReviewMode | null;
  severity: string | null;
  /** Only the marked state, when true. */
  markedOnly: boolean;
}

interface CodeReviewStore {
  byProjectId: Record<string, ProjectReviewState>;
  filters: ReviewFilters;
  /** 当前选中的审查文件（配置项/回归场景左侧问题单按文件过滤；null = 不过滤） */
  selectedReviewFile: string | null;
  setSelectedReviewFile: (file: string | null) => void;
  /**
   * 当前选中的**函数**（左侧目录树的函数节点）。非 null 时问题单只显示该函数的
   * 问题，其它函数的一律不显示。函数名与树节点同名（无函数名的问题归到
   * `(未命名)`，用 `issueBelongsToFunction` 匹配）。跟随文件联动：换文件即清空。
   */
  selectedReviewFunction: string | null;
  /**
   * 左侧目录树点击联动：切到目标文件（顺带确保代码视图可见），可选聚焦某个问题、
   * 可选按函数过滤。与 `setSelectedReviewFile` 的区别是这里会**主动打开代码视图**，
   * 避免用户此前关掉过代码视图后面板隐藏、点击文件看起来「切不过去」。
   *
   * `functionName`：省略 = 保持当前函数筛选（「定位」只切文件/聚焦，不打断函数视图）；
   * `null` = 清空（点文件节点 / 「全部」）；字符串 = 选中该函数。
   */
  selectReviewTarget: (target: {
    file: string | null;
    issueKey?: string | null;
    functionName?: string | null;
  }) => void;
  /** 清空函数筛选（问题单回到「该文件全部函数」）。 */
  clearSelectedReviewFunction: () => void;
  /**
   * 当前选中的**审查任务**（链路 / 功能审查左侧「功能模块列表 / 功能列表」里的那一项）。
   * 非 null 时，代码结构树 / 代码视图 / 问题单一律只显示该任务的结果。null = 全部任务。
   * 函数审查是三栏布局、没有这一栏，因此保持 null。
   */
  selectedReviewTaskId: string | null;
  /** 选中某个审查任务（同时清掉文件 / 函数 / 功能筛选，避免跨任务残留）。 */
  selectReviewTask: (taskId: string | null) => void;
  /**
   * 当前选中的**功能模块**（链路 / 功能审查四栏第一栏里的那一项）的 id 集合：
   * 选中父模块时是「它本身 + 全部子模块」的 id（见 `collectFeatureIds`），空数组 = 不按功能过滤。
   *
   * 与 `selectedReviewTaskId` 是**与**关系：任务给出报告边界，功能 id 在任务内进一步精确收敛
   * （一个任务可能覆盖多个功能模块）。老报告没有 `feature_id` 时集合为空，退化为按任务收敛。
   */
  selectedReviewFeatureIds: readonly string[];
  /**
   * 当前选中功能模块**自身**的 id（`selectedReviewFeatureIds[0]`，显式留一份给渲染层判选中态，
   * 避免依赖「集合第一项就是自己」这种约定）。null = 未选中任何功能模块。
   */
  selectedReviewFeatureId: string | null;
  /** 选中某个功能模块（同时清掉文件 / 函数筛选）。 */
  selectReviewFeature: (selection: {
    taskId: string | null;
    featureId: string | null;
    featureIds: readonly string[];
  }) => void;
  /** 深色代码视图面板是否显示（可在问题单头部切换，persisted per-session）。 */
  codeViewOpen: boolean;
  setCodeViewOpen: (open: boolean) => void;
  /**
   * 「接管」模式：从工作台「项目看板」点击「代码视图」进入时置位，让代码视图
   * 三栏（文件清单 / 源码 / 问题清单）占满主区，隐藏右侧工作台。不是持久化
   * 偏好 —— 关闭审查面板或点击「返回工作台」时复位。
   */
  boardTakeover: boolean;
  setBoardTakeover: (takeover: boolean) => void;
  /** 当前被“定位”聚焦的问题 key；代码视图据此滚动并高亮该问题行。 */
  focusIssueKey: string | null;
  /** 每次“定位”自增 —— 让重复定位同一问题时也能重新闪烁高亮。 */
  focusNonce: number;
  setFocusIssueKey: (key: string | null) => void;
  /** 移除某个项目的审查状态（清除审查记录后调用，停止轮询并清空内存）。 */
  clearProjectState: (projectId: string) => void;
  subscribe: (projectId: string, location: ProjectLocation) => () => void;
  setQuery: (query: string) => void;
  setAndMode: (andMode: boolean) => void;
  setMode: (mode: ReviewMode | null) => void;
  setSeverity: (severity: string | null) => void;
  setMarkedOnly: (markedOnly: boolean) => void;
  clearFilters: () => void;
  setIssueStatus: (
    projectId: string,
    issueKey: string,
    status: ReviewIssueStatus,
  ) => void;
  clearTaskStates: (projectId: string, taskId: string) => void;
  /** 创建审查任务并立即落库（对齐静态分析：创建任务即存数据库）。 */
  createTask: (
    projectId: string,
    location: ProjectLocation,
    input: { taskName: string; kind: ReviewTaskView["kind"] },
  ) => Promise<ReviewTaskView>;
}

const CODE_VIEW_OPEN_KEY = "agentemployee-code-review-codeview-open";
function loadCodeViewOpen(): boolean {
  try {
    const raw = localStorage.getItem(CODE_VIEW_OPEN_KEY);
    if (raw !== null) return raw === "1";
  } catch {
    /* ignore */
  }
  return true;
}
function persistCodeViewOpen(open: boolean): void {
  try {
    localStorage.setItem(CODE_VIEW_OPEN_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

const pollers = new Map<string, PollerState>();

function keyOf(issue: ReviewIssueView): string {
  return issue.key;
}

/**
 * 「是不是同一个文件」的宽容判断（归一化后比较，null 只能与 null 相等）。
 * `selectReviewTarget` 用它判断这次点击是否**换了文件** —— 只有真的换文件，
 * 才清掉关联的函数筛选；`./src/a.c` 与 `src/a.c` 这种写法差异不算换文件。
 */
function sameReviewFileSelection(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return sameReviewFileExact(a, b);
}

export const useCodeReviewStore = create<CodeReviewStore>((set, get) => {
  function setEntry(projectId: string, patch: Partial<ProjectReviewState>): void {
    set((state) => {
      const previous = state.byProjectId[projectId] ?? {
        issues: [],
        statuses: {},
        progress: null,
        diffReports: [],
        tasks: [],
        functionInfos: [],
        features: [],
        callgraphs: {},
        loading: true,
        polling: false,
      };
      return { byProjectId: { ...state.byProjectId, [projectId]: { ...previous, ...patch } } };
    });
  }

  async function loadStatuses(location: ProjectLocation, issues: readonly ReviewIssueView[]) {
    const byTask = new Map<string, ReviewIssueView[]>();
    for (const issue of issues) {
      const list = byTask.get(issue.taskId);
      if (list) list.push(issue);
      else byTask.set(issue.taskId, [issue]);
    }
    const statuses: Record<string, ReviewIssueStatus> = {};
    for (const [taskId, taskIssues] of byTask) {
      try {
        const result = await readBridge().reviewGetIssueStates({ projectLocation: location, taskId });
        for (const issue of taskIssues) {
          const status = result[issue.id];
          if (status) statuses[keyOf(issue)] = status;
        }
      } catch {
        // sqlite not ready — treat all as unmarked (new).
      }
    }
    return statuses;
  }

  async function tick(projectId: string): Promise<void> {
    const poller = pollers.get(projectId);
    if (!poller || poller.cancelled) return;
    const current = get().byProjectId[projectId];
    if (current?.polling) return;
    setEntry(projectId, { polling: true });
    let issues: readonly ReviewIssueView[] = [];
    let progress: ReviewProgress | null = null;
    let diffReports: readonly RegressionDiffReport[] = [];
    let tasks: readonly ReviewTaskView[] = [];
    let functionInfos: readonly ReviewFunctionInfo[] = [];
    let features: readonly ReviewFeatureView[] = [];
    let callgraphs: Readonly<Record<string, ReviewCallGraph>> = {};
    try {
      const data = await readBridge().reviewGetProjectData({
        projectLocation: poller.location,
        projectId,
      });
      issues = data.issues;
      progress = data.progress;
      diffReports = data.diffReports;
      tasks = data.tasks ?? [];
      functionInfos = data.functionInfos ?? [];
      features = data.features ?? [];
      callgraphs = data.callgraphs ?? {};
    } catch {
      // No reviews yet (or not started) — nothing to show.
      issues = [];
    }
    if (poller.cancelled) return;
    const statuses = await loadStatuses(poller.location, issues);
    if (poller.cancelled) return;
    setEntry(projectId, {
      issues,
      statuses,
      progress,
      diffReports,
      tasks,
      functionInfos,
      features,
      callgraphs,
      loading: false,
      polling: false,
    });
    poller.timer = setTimeout(() => void tick(projectId), ACTIVE_POLL_MS);
  }

  return {
    byProjectId: {},
    filters: { query: "", andMode: false, mode: null, severity: null, markedOnly: false },
    selectedReviewFile: null,
    selectedReviewFunction: null,
    selectedReviewTaskId: null,
    selectedReviewFeatureIds: [],
    selectedReviewFeatureId: null,
    codeViewOpen: loadCodeViewOpen(),
    boardTakeover: false,
    focusIssueKey: null,
    focusNonce: 0,

    subscribe(projectId, location) {
      const poller = pollers.get(projectId);
      if (poller) {
        poller.refCount += 1;
        if (!poller.timer) poller.timer = setTimeout(() => void tick(projectId), 0);
      } else {
        pollers.set(projectId, { location, refCount: 1, timer: null, cancelled: false });
        if (!get().byProjectId[projectId]) {
          setEntry(projectId, { issues: [], statuses: {}, loading: true, polling: false });
        }
        const created = pollers.get(projectId);
        if (created) created.timer = setTimeout(() => void tick(projectId), 0);
      }
      return () => {
        const active = pollers.get(projectId);
        if (!active) return;
        active.refCount = Math.max(0, active.refCount - 1);
        if (active.refCount === 0) {
          active.cancelled = true;
          if (active.timer) {
            clearTimeout(active.timer);
            active.timer = null;
          }
          pollers.delete(projectId);
        }
      };
    },

    setQuery: (query) => set((s) => (s.filters.query === query ? {} : { filters: { ...s.filters, query } })),
    setAndMode: (andMode) => set((s) => (s.filters.andMode === andMode ? {} : { filters: { ...s.filters, andMode } })),
    setMode: (mode) => set((s) => (s.filters.mode === mode ? {} : { filters: { ...s.filters, mode } })),
    setSeverity: (severity) => set((s) => (s.filters.severity === severity ? {} : { filters: { ...s.filters, severity } })),
    setMarkedOnly: (markedOnly) => set((s) => (s.filters.markedOnly === markedOnly ? {} : { filters: { ...s.filters, markedOnly } })),
    clearFilters: () =>
      set((s) =>
        s.filters.query === "" &&
        !s.filters.andMode &&
        s.filters.mode === null &&
        s.filters.severity === null &&
        !s.filters.markedOnly
          ? {}
          : { filters: { query: "", andMode: false, mode: null, severity: null, markedOnly: false } },
      ),

    setSelectedReviewFile: (file) =>
      set((s) =>
        s.selectedReviewFile === file && s.selectedReviewFunction === null
          ? {}
          : // 换文件（含清空）即意味着旧的函数筛选不再适用，一并清掉。
            { selectedReviewFile: file, selectedReviewFunction: null },
      ),

    selectReviewTarget: ({ file, issueKey, functionName }) => {
      // 点击目录树即意味着「我要看这个文件的代码」——把代码视图打开，避免此前
      // 被用户关掉后面板隐藏、点击看起来没反应（切不过去）。
      persistCodeViewOpen(true);
      set((s) => {
        const sameTargetFile = sameReviewFileSelection(s.selectedReviewFile, file);
        return {
          // 同一个文件就不改写原值（避免路径写法差异触发代码视图重载）。
          selectedReviewFile: sameTargetFile ? s.selectedReviewFile : file,
          // 换文件 → 旧的函数筛选不再适用；`functionName` 显式给出时以它为准。
          selectedReviewFunction:
            functionName !== undefined
              ? functionName
              : sameTargetFile
                ? s.selectedReviewFunction
                : null,
          codeViewOpen: true,
          ...(issueKey ? { focusIssueKey: issueKey, focusNonce: s.focusNonce + 1 } : {}),
        };
      });
    },

    clearSelectedReviewFunction: () =>
      set((s) => (s.selectedReviewFunction === null ? {} : { selectedReviewFunction: null })),

    selectReviewTask: (taskId) =>
      set((s) =>
        s.selectedReviewTaskId === taskId &&
        s.selectedReviewFeatureIds.length === 0 &&
        s.selectedReviewFeatureId === null &&
        s.selectedReviewFile === null &&
        s.selectedReviewFunction === null
          ? {}
          : // 换任务（含清空）即意味着原来的文件 / 函数 / 功能筛选不再适用。
            {
              selectedReviewTaskId: taskId,
              selectedReviewFeatureIds: [],
              selectedReviewFeatureId: null,
              selectedReviewFile: null,
              selectedReviewFunction: null,
            },
      ),

    selectReviewFeature: ({ taskId, featureId, featureIds }) =>
      set({
        selectedReviewTaskId: taskId,
        selectedReviewFeatureIds: featureIds,
        selectedReviewFeatureId: featureId,
        selectedReviewFile: null,
        selectedReviewFunction: null,
      }),

    setCodeViewOpen: (open) => {
      persistCodeViewOpen(open);
      set((s) => (s.codeViewOpen === open ? {} : { codeViewOpen: open }));
    },

    setBoardTakeover: (takeover) =>
      set((s) => (s.boardTakeover === takeover ? {} : { boardTakeover: takeover })),

    setFocusIssueKey: (key) =>
      set((s) => ({ focusIssueKey: key, focusNonce: s.focusNonce + 1 })),

    clearProjectState(projectId) {
      const poller = pollers.get(projectId);
      if (poller) {
        poller.cancelled = true;
        if (poller.timer) {
          clearTimeout(poller.timer);
          poller.timer = null;
        }
        pollers.delete(projectId);
      }
      set((state) => {
        if (!(projectId in state.byProjectId)) return {};
        const { [projectId]: _removed, ...rest } = state.byProjectId;
        return { byProjectId: rest };
      });
    },

    setIssueStatus(projectId, issueKey, status) {
      const location = pollers.get(projectId)?.location;
      const state = get().byProjectId[projectId];
      if (!location || !state) return;
      const issue = state.issues.find((i) => keyOf(i) === issueKey);
      set((s) => {
        const entry = s.byProjectId[projectId];
        if (!entry) return {};
        return {
          byProjectId: {
            ...s.byProjectId,
            [projectId]: {
              ...entry,
              statuses: { ...entry.statuses, [issueKey]: status },
            },
          },
        };
      });
      if (issue) {
        readBridge()
          .reviewSetIssueState({ projectLocation: location, taskId: issue.taskId, issueId: issue.id, status })
          .catch(() => undefined);
      }
    },

    clearTaskStates(projectId, taskId) {
      const location = pollers.get(projectId)?.location;
      if (!location) return;
      set((s) => {
        const entry = s.byProjectId[projectId];
        if (!entry) return {};
        const statuses = { ...entry.statuses };
        for (const key of Object.keys(statuses)) {
          if (key.startsWith(`${taskId}::`)) delete statuses[key];
        }
        return {
          byProjectId: { ...s.byProjectId, [projectId]: { ...entry, statuses } },
        };
      });
      readBridge()
        .reviewClearIssueStates({ projectLocation: location, taskId })
        .catch(() => undefined);
    },

    async createTask(projectId, location, input) {
      const task = await readBridge().reviewCreateTask({
        projectLocation: location,
        projectId,
        taskName: input.taskName,
        kind: input.kind,
      });
      // 触发一次立即拉取，让新任务尽快出现（不必等 3s 轮询）。
      void tick(projectId);
      return task;
    },
  };
});

/** Subscribed, live project state. */
export function useProjectReviewState(projectId: string | null | undefined) {
  return useCodeReviewStore((s) => (projectId ? s.byProjectId[projectId] : undefined));
}

/** All persisted review tasks for a project (create-first + report-mirrored). */
export function selectReviewTasks(
  state: CodeReviewStore,
  projectId: string | null | undefined,
): readonly ReviewTaskView[] {
  const entry = projectId ? state.byProjectId[projectId] : undefined;
  return entry?.tasks ?? [];
}

/** Start (ref-counted) polling for a project while mounted. */
export function useCodeReviewPoll(
  projectId: string | null | undefined,
  location: ProjectLocation | undefined,
): void {
  const subscribe = useCodeReviewStore((s) => s.subscribe);
  useEffect(() => {
    if (!projectId || !location) return;
    const unsubscribe = subscribe(projectId, location);
    return unsubscribe;
  }, [projectId, location, subscribe]);
}

function matchesQuery(issue: ReviewIssueView, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = [
    issue.file,
    issue.functionName ?? "",
    issue.type,
    issue.severity,
    issue.summary,
    issue.suggestion,
    issue.id,
  ]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** 回归审查的差异数据（供前端 DiffEditor 渲染），按项目读取。 */
export function selectRegressionDiffReports(
  state: CodeReviewStore,
  projectId: string | null | undefined,
): readonly RegressionDiffReport[] {
  const entry = projectId ? state.byProjectId[projectId] : undefined;
  if (!entry) return [];
  return entry.diffReports ?? [];
}

/** Filtered issue list for a project given the store's filters. */
export function selectFilteredIssues(
  state: CodeReviewStore,
  projectId: string | null | undefined,
): readonly ReviewIssueView[] {
  const entry = projectId ? state.byProjectId[projectId] : undefined;
  if (!entry) return [];
  const { query, andMode, mode, severity, markedOnly } = state.filters;
  const terms = query
    .split(/\s+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
  return entry.issues.filter((issue) => {
    if (mode && issue.mode && issue.mode !== mode) return false;
    if (severity && issue.severity !== severity) return false;
    if (markedOnly && entry.statuses[keyOf(issue)] !== "marked") return false;
    if (andMode) return matchesQuery(issue, terms);
    return terms.length === 0 || terms.some((term) => matchesQuery(issue, [term]));
  });
}
