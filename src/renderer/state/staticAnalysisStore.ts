import { create } from "zustand";
import { useEffect } from "react";
import type { ProjectLocation } from "@/shared/contracts";
import type {
  StaticAnalysisFile,
  StaticAnalysisProblem,
  StaticAnalysisProjectData,
  StaticAnalysisRule,
  StaticAnalysisTaskView,
} from "@/shared/staticAnalysisReport";
import { readBridge } from "@/renderer/bridge";

export interface StaticAnalysisCreateInput {
  taskName: string;
  mode: "normal_c" | "normal_fpga" | "filter_c" | "filter_fpga";
  selectedRules: readonly string[];
  excelFile?: string | null;
  codebasePath?: string | null;
}

export interface StaticAnalysisState {
  /** Per-project aggregated data (tasks/problems/files/rules). */
  data: Record<string, StaticAnalysisProjectData>;
  /** Currently selected task per project. */
  activeTaskId: Record<string, string | null>;
  /** Problem list query filter. */
  query: string;
  /** Active rule-type tab (gjb | cwe). */
  ruleTypeFilter: "gjb" | "cwe";
  /** Only show filtered-out (工具模式 AI 已过滤) problems? */
  includeFiltered: boolean;
  /** Currently selected file path for the code view. */
  selectedFile: Record<string, string | null>;
  /** Problem the code view should focus (key = taskId::problemId). */
  focusProblemKey: string | null;
  /** Dock visibility (三栏一体的静态分析模块界面). */
  staticAnalysisOpen: boolean;
  /** Code view visibility within the module. */
  codeViewOpen: boolean;
  /** The rules picker's selected codes (persisted into the task on create). */
  draftSelectedRules: string[];
  /** Uploaded 科代 result Excel path (tool mode). */
  draftExcelFile: string | null;

  subscribe(projectId: string, location: ProjectLocation): () => void;
  setStaticAnalysisOpen(open: boolean): void;
  setCodeViewOpen(open: boolean): void;
  setActiveTask(projectId: string, taskId: string | null): void;
  setQuery(query: string): void;
  setRuleTypeFilter(type: "gjb" | "cwe"): void;
  setIncludeFiltered(include: boolean): void;
  setSelectedFile(projectId: string, filePath: string | null): void;
  setFocusProblemKey(key: string | null): void;
  setDraftSelectedRules(rules: string[]): void;
  setDraftExcelFile(path: string | null): void;
  createTask(projectId: string, location: ProjectLocation, input: StaticAnalysisCreateInput): Promise<StaticAnalysisTaskView>;
  setProblemStatus(projectId: string, taskId: string, problemId: string, status: number): void;
  clearProject(projectId: string, location: ProjectLocation): Promise<void>;
}

const ACTIVE_POLL_MS = 3000;

const pollers = new Map<
  string,
  { location: ProjectLocation; timer: ReturnType<typeof setInterval> }
>();

function tick(projectId: string): void {
  const poller = pollers.get(projectId);
  if (!poller) return;
  const store = useStaticAnalysisStore.getState();
  store.data = { ...store.data };
  void (async () => {
    try {
      const data = await readBridge().staticAnalysisGetProjectData({
        projectLocation: poller.location,
        projectId,
      });
      const current = useStaticAnalysisStore.getState();
      const active = current.activeTaskId[projectId];
      // 若无选中任务，自动选中最新一个（有结果或进行中的）。
      let nextActive = active;
      if (!nextActive || !data.tasks.some((t) => t.taskId === nextActive)) {
        nextActive = data.tasks[0]?.taskId ?? null;
      }
      useStaticAnalysisStore.setState({
        data: { ...current.data, [projectId]: data },
        activeTaskId: { ...current.activeTaskId, [projectId]: nextActive },
      });
    } catch {
      useStaticAnalysisStore.setState((s) => ({
        data: { ...s.data, [projectId]: { tasks: [], problems: [], files: [], rules: [] } },
      }));
    }
  })();
}

export const useStaticAnalysisStore = create<StaticAnalysisState>()((set, get) => ({
  data: {},
  activeTaskId: {},
  query: "",
  ruleTypeFilter: "gjb",
  includeFiltered: false,
  selectedFile: {},
  focusProblemKey: null,
  staticAnalysisOpen: false,
  codeViewOpen: true,
  draftSelectedRules: [],
  draftExcelFile: null,

  subscribe(projectId, location) {
    const existing = pollers.get(projectId);
    if (existing) {
      existing.location = location;
      return () => {};
    }
    const timer = setInterval(() => tick(projectId), ACTIVE_POLL_MS);
    pollers.set(projectId, { location, timer });
    tick(projectId);
    return () => {
      const poller = pollers.get(projectId);
      if (poller) {
        clearInterval(poller.timer);
        pollers.delete(projectId);
      }
    };
  },

  setStaticAnalysisOpen(open) {
    set({ staticAnalysisOpen: open });
  },
  setCodeViewOpen(open) {
    set({ codeViewOpen: open });
  },
  setActiveTask(projectId, taskId) {
    set((s) => ({ activeTaskId: { ...s.activeTaskId, [projectId]: taskId } }));
  },
  setQuery(query) {
    set({ query });
  },
  setRuleTypeFilter(ruleTypeFilter) {
    set({ ruleTypeFilter });
  },
  setIncludeFiltered(includeFiltered) {
    set({ includeFiltered });
  },
  setSelectedFile(projectId, filePath) {
    set((s) => ({ selectedFile: { ...s.selectedFile, [projectId]: filePath } }));
  },
  setFocusProblemKey(focusProblemKey) {
    set({ focusProblemKey });
  },
  setDraftSelectedRules(draftSelectedRules) {
    set({ draftSelectedRules });
  },
  setDraftExcelFile(draftExcelFile) {
    set({ draftExcelFile });
  },

  async createTask(projectId, location, input) {
    const task = await readBridge().staticAnalysisCreateTask({
      projectLocation: location,
      projectId,
      taskName: input.taskName,
      mode: input.mode,
      selectedRules: [...input.selectedRules],
      ...(input.excelFile ? { excelFile: input.excelFile } : {}),
      ...(input.codebasePath ? { codebasePath: input.codebasePath } : {}),
    });
    const data = get().data[projectId];
    const nextData: StaticAnalysisProjectData = {
      tasks: [task, ...(data?.tasks ?? [])],
      problems: data?.problems ?? [],
      files: data?.files ?? [],
      rules: data?.rules ?? [],
    };
    set((s) => ({
      data: { ...s.data, [projectId]: nextData },
      activeTaskId: { ...s.activeTaskId, [projectId]: task.taskId },
      // 任务已创建（已触发）→ 允许显示代码视图。
      codeViewOpen: true,
    }));
    return task;
  },

  setProblemStatus(projectId, taskId, problemId, status) {
    void readBridge().staticAnalysisSetProblemStatus({ projectId, taskId, problemId, status });
    const data = get().data[projectId];
    if (!data) return;
    const problems = data.problems.map((p) =>
      p.problemId === problemId ? { ...p, problem_status: status } : p,
    );
    set((s) => ({ data: { ...s.data, [projectId]: { ...data, problems } } }));
  },

  async clearProject(projectId, location) {
    await readBridge().staticAnalysisClearProject({ projectLocation: location, projectId });
    set((s) => ({
      data: { ...s.data, [projectId]: { tasks: [], problems: [], files: [], rules: s.data[projectId]?.rules ?? [] } },
      activeTaskId: { ...s.activeTaskId, [projectId]: null },
    }));
  },
}));

/** 项目静态分析聚合数据（未订阅时返回 undefined）。 */
export function useProjectStaticAnalysis(projectId: string): StaticAnalysisProjectData | undefined {
  return useStaticAnalysisStore((s) => s.data[projectId]);
}

/** 面板挂载期间启动（引用计数）轮询。 */
export function useStaticAnalysisPoll(
  projectId: string | null | undefined,
  location: ProjectLocation | undefined,
): void {
  const subscribe = useStaticAnalysisStore((s) => s.subscribe);
  useEffect(() => {
    if (!projectId || !location) return;
    return subscribe(projectId, location);
  }, [projectId, location, subscribe]);
}

/** 当前任务的规则（含 selected 标记）与问题/文件选择器。 */
export function useActiveStaticAnalysisTask(projectId: string): StaticAnalysisTaskView | null {
  const data = useProjectStaticAnalysis(projectId);
  const activeTaskId = useStaticAnalysisStore((s) => s.activeTaskId[projectId]);
  return data?.tasks.find((t) => t.taskId === activeTaskId) ?? data?.tasks[0] ?? null;
}

/** 当前任务的规则列表，isSelected 由任务选中规则合并（供创建表单/规则 Tab 复用）。 */
export function useActiveTaskRules(projectId: string): StaticAnalysisRule[] {
  const data = useProjectStaticAnalysis(projectId);
  const task = useActiveStaticAnalysisTask(projectId);
  const rules = [...(data?.rules ?? [])];
  if (!task) return rules;
  const selected = new Set(task.selectedRules);
  return rules.map((rule) => ({ ...rule, isSelected: selected.has(rule.ruleCode) }));
}

/** 当前任务的问题单（过滤查询 + 规则类型 + 已过滤开关）。 */
export function useActiveTaskProblems(projectId: string): StaticAnalysisProblem[] {
  const data = useProjectStaticAnalysis(projectId);
  const task = useActiveStaticAnalysisTask(projectId);
  const query = useStaticAnalysisStore((s) => s.query);
  const ruleTypeFilter = useStaticAnalysisStore((s) => s.ruleTypeFilter);
  const includeFiltered = useStaticAnalysisStore((s) => s.includeFiltered);
  const problems = [...(data?.problems ?? [])];
  if (!task) return [];
  let result = problems;
  if (ruleTypeFilter === "gjb" || ruleTypeFilter === "cwe") {
    result = result.filter((p) => (p.rule_type ?? "gjb") === ruleTypeFilter);
  }
  if (!includeFiltered) {
    result = result.filter((p) => !p.is_filtered);
  }
  if (query.trim()) {
    const q = query.trim().toLowerCase();
    result = result.filter(
      (p) =>
        p.issue_name.toLowerCase().includes(q) ||
        p.issue_file.toLowerCase().includes(q) ||
        p.rule_code.toLowerCase().includes(q),
    );
  }
  return result;
}

/** 当前任务的文件清单（代码视图左栏），问题所在文件优先置顶。 */
export function useActiveTaskFiles(projectId: string): StaticAnalysisFile[] {
  const data = useProjectStaticAnalysis(projectId);
  const task = useActiveStaticAnalysisTask(projectId);
  const files = data?.files ?? [];
  if (!task) return [];
  const withProblems = new Set(
    (data?.problems ?? []).filter((p) => p.issue_file).map((p) => p.issue_file),
  );
  return [...files].sort((a, b) => {
    const aHas = withProblems.has(a.file_path) ? 0 : 1;
    const bHas = withProblems.has(b.file_path) ? 0 : 1;
    return aHas - bHas || a.file_path.localeCompare(b.file_path);
  });
}

/** 任务状态中文标签。 */
export function staticAnalysisStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "待处理";
    case "running":
      return "处理中";
    case "paused":
      return "已暂停";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return status;
  }
}
