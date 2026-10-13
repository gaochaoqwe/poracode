import { useEffect, useState } from "react";
import {
  Bot,
  Code,
  ExternalLink,
  FolderGit2,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { Button, Chip } from "@heroui/react";
import type { ProjectLocation } from "@/shared/contracts";
import { HOME_PROJECT_ID } from "@/shared/homeScope";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useCodeReviewStore } from "@/renderer/state/codeReviewStore";
import { useStaticAnalysisStore } from "@/renderer/state/staticAnalysisStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useProjectFlowStore } from "@/renderer/state/projectFlowStore";
import { readBridge } from "@/renderer/bridge";
import { pipelineLanesFromThreadItems } from "@/renderer/state/orgFlow";
import {
  FLOW_STEP_OWNER_LABELS,
  PROJECT_FLOW_KINDS,
  PROJECT_FLOW_KIND_LABELS,
  findFlowEdge,
  findFlowNode,
  inferProjectFlowKind,
  projectFlowTemplate,
  resolveFlowStepOwner,
  resolveProjectFlowPosition,
  type FlowStepOwner,
  type ProjectFlowKind,
  type ProjectFlowPosition,
  type ProjectFlowTemplate,
} from "@/renderer/state/projectFlows";
import { employeeWorkspaces, hiddenTeamIds } from "@/renderer/views/OfficeView/hierarchy";
import { ProjectFlowCanvas, type FlowSelection } from "./ProjectFlowCanvas";
import {
  formatRelativeTime,
  loadProjectBoard,
  projectLocationLabel,
  projectStatusLabel,
  staticModesLabel,
  type ProjectBoardEntry,
} from "./projectBoard";

/** 状态小标签的配色（进行中=琥珀，已完成=绿，已暂停=灰）。 */
const STATUS_CHIP_CLASS: Record<NonNullable<ProjectBoardEntry["status"]>, string> = {
  running: "text-amber-600 dark:text-amber-400",
  paused: "",
  done: "text-emerald-600 dark:text-emerald-400",
};

/** 项目当前进度的可读描述（节点 / 连线 / 未接入）。 */
function positionLabel(
  template: ProjectFlowTemplate,
  position: ProjectFlowPosition | null,
): string {
  if (!position) return "未接入进度";
  if (position.nodeId) {
    const node = findFlowNode(template, position.nodeId);
    return node ? `停在：${node.label}` : "—";
  }
  if (position.edgeId) {
    const edge = findFlowEdge(template, position.edgeId);
    if (!edge) return "流转中";
    const from = findFlowNode(template, edge.from)?.label ?? "";
    const to = findFlowNode(template, edge.to)?.label ?? "";
    return `交接中：${from} → ${to}`;
  }
  return "—";
}

/**
 * 项目看板 —— 工作台的一个标签页。
 *
 * 左侧是项目列表，右侧是该项目对应的整条流程图：节点与节点之间的连线一起
 * 呈现，可以直观看到项目当前卡在哪个节点 / 哪条连线上；每个节点与连线都带
 * 执行方（自动 = 数字员工，人工 = 使用人员），用户可逐个改写并持久化。
 *
 * 流程图模板按条线套用：测试项目（对齐测评中心流水线与 8 人测试团队）、
 * 办公项目（接收→理解→出文档）、开发类任务（台账登记→任务列表）。
 * 原有能力（代码视图 / 静态分析 / 打开目录 / 清除记录）保留在右侧操作区。
 */
export function ProjectBoardPanel() {
  const projects = useAppStore((s) => s.projects);
  const threads = useAppStore((s) => s.threads);
  const itemIdsByThread = useAppStore((s) => s.runtimeItemIdsByThread);
  const itemsByIdByThread = useAppStore((s) => s.runtimeItemsByIdByThread);
  const workspaces = useSharedSettings((s) => s.workspaces);
  const teams = useSharedSettings((s) => s.teams);
  const overrides = useProjectFlowStore((s) => s.overrides);
  const kindOverrides = useProjectFlowStore((s) => s.kinds);
  const setStepOwner = useProjectFlowStore((s) => s.setStepOwner);
  const setProjectFlowKind = useProjectFlowStore((s) => s.setProjectFlowKind);
  const resetProjectFlow = useProjectFlowStore((s) => s.resetProjectFlow);

  const [entries, setEntries] = useState<ProjectBoardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const [selection, setSelection] = useState<FlowSelection | null>(null);

  // 进入标签页（以及项目列表变化）时扫描一次；`cancelled` 让切走后的结果丢弃。
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react/set-state-in-effect -- 扫描期间先亮 loading，异步完成后收回
    setLoading(true);
    void loadProjectBoard(projects).then((next) => {
      if (cancelled) return;
      setEntries(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [projects]);

  /**
   * 手动重扫（刷新按钮 / 清除某项目记录后）。普通函数即可 —— 仓库里 React
   * Compiler 负责记忆化，手工 useCallback 反而会踩 memo-dependencies。
   */
  async function refresh(): Promise<void> {
    setLoading(true);
    try {
      setEntries(await loadProjectBoard(projects));
    } finally {
      setLoading(false);
    }
  }

  const visibleProjects = projects.filter((project) => project.id !== HOME_PROJECT_ID);

  // ── 当前进度来源：测评中心流水线阶段（投影自线程里的 test_phase_advance
  //    调用）+ 正在作业的岗位。与 OfficeView 的投影方式保持一致。
  const employees = employeeWorkspaces(workspaces, hiddenTeamIds(teams));
  const projectById = new Map(projects.map((p) => [p.id, p] as const));
  const pipelineLanes = pipelineLanesFromThreadItems(
    employees.map((ws) => ({
      employeeId: ws.id,
      threads: threads
        .filter(
          (th) => th.workspaceId === ws.id || projectById.get(th.projectId)?.workspaceId === ws.id,
        )
        .map((th) => ({
          itemIds: itemIdsByThread[th.id] ?? [],
          items: itemsByIdByThread[th.id] ?? {},
        })),
    })),
  );
  const laneByProject = new Map(pipelineLanes.map((lane) => [lane.projectId, lane] as const));

  const activeByProject = new Map<string, string[]>();
  for (const thread of threads) {
    if (thread.done || thread.archived) continue;
    const status: string = thread.status;
    if (status !== "working" && status !== "launching") continue;
    const workspaceId = thread.workspaceId ?? projectById.get(thread.projectId)?.workspaceId;
    if (!workspaceId) continue;
    const list = activeByProject.get(thread.projectId) ?? [];
    if (!list.includes(workspaceId)) list.push(workspaceId);
    activeByProject.set(thread.projectId, list);
  }

  /** 每个项目的流程类型 + 当前进度（供列表与右栏复用）。 */
  const flowInfoByProject = new Map<
    string,
    { kind: ProjectFlowKind; position: ProjectFlowPosition | null }
  >();
  for (const project of visibleProjects) {
    const kind = kindOverrides[project.id] ?? inferProjectFlowKind(project, workspaces);
    const template = projectFlowTemplate(kind);
    const lane = laneByProject.get(project.id);
    const position = resolveProjectFlowPosition(template, {
      phase: lane?.phase,
      activeEmployeeIds: activeByProject.get(project.id) ?? [],
    });
    flowInfoByProject.set(project.id, { kind, position });
  }

  const filteredProjects = query.trim()
    ? visibleProjects.filter((project) =>
        (project.name || project.id).toLowerCase().includes(query.trim().toLowerCase()),
      )
    : visibleProjects;

  const picked = pickedProjectId
    ? visibleProjects.find((project) => project.id === pickedProjectId)
    : undefined;
  const activeProject = picked ?? visibleProjects[0] ?? null;

  const activeKind: ProjectFlowKind = activeProject
    ? (kindOverrides[activeProject.id] ?? inferProjectFlowKind(activeProject, workspaces))
    : "office";
  const activeTemplate = projectFlowTemplate(activeKind);
  const activeOverrides = activeProject ? overrides[activeProject.id] : undefined;
  const activePosition = activeProject ? (flowInfoByProject.get(activeProject.id)?.position ?? null) : null;
  const activeEntry = entries.find((entry) => entry.project.id === activeProject?.id);

  const selectedNode =
    selection?.type === "node" ? findFlowNode(activeTemplate, selection.id) : undefined;
  const selectedEdge =
    selection?.type === "edge" ? findFlowEdge(activeTemplate, selection.id) : undefined;
  const selectedDefaultOwner = selectedNode?.owner ?? selectedEdge?.owner;
  const selectedOwner: FlowStepOwner | undefined =
    selectedDefaultOwner === undefined || selection === null
      ? undefined
      : resolveFlowStepOwner(selectedDefaultOwner, activeOverrides, selection.id);

  function openCodeView(entry: ProjectBoardEntry): void {
    const project = entry.project;
    const scenario = entry.hasDiff ? "code-review-regression" : "code-review";
    useAppStore.getState().setActiveScenario(project.id, scenario);
    usePanelStore.getState().openCodeReviewPanel({
      projectId: project.id,
      projectName: project.name,
      ...(project.location ? { projectLocation: project.location } : {}),
    });
    const store = useCodeReviewStore.getState();
    store.setCodeViewOpen(true);
    // 从这里进入时隐藏右侧工作台，让代码视图三栏占满主区（关闭审查面板或点
    // 击问题单头部的「打开项目看板」按钮即可回到工作台）。
    store.setBoardTakeover(true);
    store.setSelectedReviewFile(null);
    store.setFocusIssueKey(null);
  }

  async function clearReview(entry: ProjectBoardEntry): Promise<void> {
    const project = entry.project;
    if (!project.location || busyId !== null) return;
    setBusyId(project.id);
    try {
      await readBridge().reviewClearProject({
        projectLocation: project.location,
        projectId: project.id,
      });
      useCodeReviewStore.getState().clearProjectState(project.id);
      await refresh();
    } catch {
      // 删除失败保持现状
    } finally {
      setBusyId(null);
    }
  }

  function openStaticAnalysis(entry: ProjectBoardEntry): void {
    const project = entry.project;
    useAppStore.getState().setActiveScenario(project.id, "static-analysis");
    usePanelStore.getState().openStaticAnalysisPanel({
      projectId: project.id,
      projectName: project.name,
      ...(project.location ? { projectLocation: project.location } : {}),
    });
    const store = useStaticAnalysisStore.getState();
    store.setCodeViewOpen(true);
    store.setActiveTask(project.id, entry.staticTasks[0]?.taskId ?? null);
  }

  async function clearStaticAnalysis(entry: ProjectBoardEntry): Promise<void> {
    const project = entry.project;
    if (!project.location || busyId !== null) return;
    setBusyId(project.id);
    try {
      await readBridge().staticAnalysisClearProject({
        projectLocation: project.location,
        projectId: project.id,
      });
      await refresh();
    } catch {
      // 删除失败保持现状
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {/* ── 左：项目列表 ───────────────────────────────────────────── */}
      <div className="flex w-64 shrink-0 flex-col border-r border-[var(--hairline)]">
        <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-4">
          <span className="min-w-0 flex-1 truncate text-xs text-muted">
            共 <span className="tabular-nums text-foreground">{visibleProjects.length}</span> 个项目
          </span>
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            aria-label="刷新项目看板"
            isDisabled={loading}
            onPress={() => void refresh()}
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          </Button>
        </div>
        <div className="shrink-0 px-3 pb-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索项目…"
            className="w-full rounded border border-[var(--hairline)] bg-transparent px-2 py-1 text-xs text-foreground outline-none focus:border-[var(--foreground)]"
          />
        </div>

        {loading && visibleProjects.length === 0 ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            正在扫描项目…
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <FolderGit2 className="size-8 text-muted/40" aria-hidden="true" />
            <p className="text-xs text-muted">
              {visibleProjects.length === 0 ? "还没有项目" : "没有匹配的项目"}
            </p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {filteredProjects.map((project) => {
              const info = flowInfoByProject.get(project.id);
              const isActive = activeProject?.id === project.id;
              const entry = entries.find((item) => item.project.id === project.id);
              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    setPickedProjectId(project.id);
                    setSelection(null);
                  }}
                  className={`mb-1 flex w-full min-w-0 flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    isActive
                      ? "border-primary bg-[var(--surface-hover)]"
                      : "border-transparent hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <FolderGit2 className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                      {project.name || project.id}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[0.65em] text-muted">
                    <Chip size="sm" variant="soft">
                      {info ? PROJECT_FLOW_KIND_LABELS[info.kind] : "办公项目"}
                    </Chip>
                    {entry && entry.issueCount > 0 ? (
                      <span className="tabular-nums">问题 {entry.issueCount}</span>
                    ) : null}
                    {entry && entry.staticTasks.length > 0 ? (
                      <span className="tabular-nums">静态 {entry.staticTasks.length}</span>
                    ) : null}
                    {entry?.status ? (
                      <span className={STATUS_CHIP_CLASS[entry.status]}>
                        {projectStatusLabel(entry.status)}
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate text-[0.65em] text-muted">
                    {info
                      ? positionLabel(projectFlowTemplate(info.kind), info.position)
                      : "未接入进度"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 右：项目流程图 ─────────────────────────────────────────── */}
      {activeProject === null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <FolderGit2 className="size-10 text-muted/40" aria-hidden="true" />
          <p className="max-w-sm text-xs text-muted">
            还没有项目。添加项目后，这里会显示该项目对应的整条流程图。
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* 头部：项目名 / 流程类型 / 当前进度 / 操作 */}
          <div className="flex shrink-0 flex-col gap-2 border-b border-[var(--hairline)] px-4 py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <FolderGit2 className="size-4 shrink-0 text-muted" aria-hidden="true" />
              <span className="min-w-0 truncate text-sm font-medium text-foreground">
                {activeProject.name || activeProject.id}
              </span>
              <div className="flex items-center gap-1" role="tablist" aria-label="项目流程类型">
                {PROJECT_FLOW_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="tab"
                    aria-selected={activeKind === kind}
                    onClick={() => {
                      setProjectFlowKind(activeProject.id, kind);
                      setSelection(null);
                    }}
                    className={`rounded border px-1.5 py-0.5 text-[0.68em] ${
                      activeKind === kind
                        ? "border-[var(--foreground)] bg-[var(--surface-hover)] text-foreground"
                        : "border-[var(--hairline)] text-muted"
                    }`}
                  >
                    {PROJECT_FLOW_KIND_LABELS[kind]}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {activeEntry ? (
                  <>
                    <Button size="sm" variant="ghost" onPress={() => openCodeView(activeEntry)}>
                      <Code className="size-3.5" aria-hidden="true" />
                      代码视图
                    </Button>
                    {activeEntry.staticTasks.length > 0 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onPress={() => openStaticAnalysis(activeEntry)}
                      >
                        <ShieldCheck className="size-3.5" aria-hidden="true" />
                        静态分析
                      </Button>
                    ) : null}
                  </>
                ) : null}
                {activeProject.location ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    isIconOnly
                    aria-label="打开项目目录"
                    onPress={() =>
                      void readBridge().revealProjectEntry({
                        projectLocation: activeProject.location as ProjectLocation,
                        path: "",
                      })
                    }
                  >
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => {
                    resetProjectFlow(activeProject.id);
                    setSelection(null);
                  }}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  重置配置
                </Button>
                {activeEntry ? (
                  <Button
                    size="sm"
                    variant="danger"
                    isDisabled={busyId === activeProject.id}
                    aria-label={`删除 ${activeProject.name} 的审查记录`}
                    onPress={() => void clearReview(activeEntry)}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    清除审查记录
                  </Button>
                ) : null}
                {activeEntry && activeEntry.staticTasks.length > 0 ? (
                  <Button
                    size="sm"
                    variant="danger"
                    isDisabled={busyId === activeProject.id}
                    aria-label={`删除 ${activeProject.name} 的静态分析记录`}
                    onPress={() => void clearStaticAnalysis(activeEntry)}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    清除静态分析
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span className="truncate" title={activeTemplate.description}>
                {activeTemplate.description}
              </span>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="truncate font-mono text-muted">
                {projectLocationLabel(activeProject.location)}
              </span>
              <span className="flex items-center gap-1 text-muted">
                <span
                  aria-hidden="true"
                  className="inline-block size-2 rounded-full bg-orange-500"
                />
                当前进度：
                <span className="text-foreground">
                  {positionLabel(activeTemplate, activePosition)}
                </span>
              </span>
              {activePosition?.fromActivity ? (
                <span className="text-emerald-600 dark:text-emerald-400">实时作业中</span>
              ) : null}
              {activeEntry ? (
                <>
                  <span className="text-muted">
                    问题 <span className="tabular-nums text-foreground">{activeEntry.issueCount}</span>
                  </span>
                  <span className="text-muted">
                    差异 <span className="tabular-nums text-foreground">{activeEntry.diffCount}</span>
                  </span>
                  <span className="text-muted">
                    更新于 {formatRelativeTime(activeEntry.lastUpdatedAt)}
                  </span>
                  {activeEntry.staticTasks.length > 0 ? (
                    <span className="text-muted">
                      静态分析 {activeEntry.staticTasks.length} 个任务 ·{" "}
                      {staticModesLabel(activeEntry.staticTasks)}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-muted">（该项目暂无审查 / 静态分析记录）</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.68em] text-muted">
              <span className="flex items-center gap-1">
                <Bot className="size-3 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                自动 = 数字员工完成
              </span>
              <span className="flex items-center gap-1">
                <UserRound className="size-3 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                人工 = 使用人员完成
              </span>
              <span className="flex items-center gap-1">
                <span aria-hidden="true" className="inline-block size-2.5 rounded-full border-2 border-orange-500" />
                当前卡住的节点
              </span>
              <span className="flex items-center gap-1">
                <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded bg-orange-500" />
                当前交接中的连线
              </span>
              <span className="flex items-center gap-1">
                <span aria-hidden="true" className="pf-legend-flow inline-block h-0.5 w-5 rounded" />
                光带流动 = 数据沿链路流转
              </span>
              <span className="flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className="inline-block size-2.5 rounded border border-dashed border-violet-500"
                />
                质量门
              </span>
            </div>
          </div>

          {/* 画布 */}
          <div className="pf-board-surface min-h-0 flex-1 overflow-auto p-3">
            <ProjectFlowCanvas
              template={activeTemplate}
              overrides={activeOverrides}
              position={activePosition}
              selection={selection}
              onSelect={setSelection}
            />
          </div>

          {/* 详情条：点击节点 / 连线后定义执行方 */}
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--hairline)] px-4 py-2 text-xs">
            {selection === null || selectedOwner === undefined ? (
              <span className="text-muted">
                点击任意节点或连线，可定义该步骤由「数字员工自动完成」还是「使用人员手动完成」。
              </span>
            ) : (
              <>
                <span className="text-muted">
                  {selection.type === "node" ? "节点" : "连线"}：
                  <span className="text-foreground">
                    {selectedNode?.label ??
                      selectedEdge?.label ??
                      (selection.type === "edge"
                        ? `${findFlowNode(activeTemplate, selectedEdge?.from ?? "")?.label ?? ""} → ${
                            findFlowNode(activeTemplate, selectedEdge?.to ?? "")?.label ?? ""
                          }`
                        : selection.id)}
                  </span>
                </span>
                {selectedNode?.employeeLabel ? (
                  <span className="text-muted">
                    承接岗位：<span className="text-foreground">{selectedNode.employeeLabel}</span>
                  </span>
                ) : null}
                {selectedNode?.kind === "gate" ? (
                  <span className="text-muted">类型：质量门（需核验通过才放行）</span>
                ) : null}
                <span className="flex items-center gap-1.5">
                  <span className="text-muted">执行方：</span>
                  {(["auto", "manual"] as const).map((owner) => (
                    <button
                      key={owner}
                      type="button"
                      onClick={() => setStepOwner(activeProject.id, selection.id, owner)}
                      className={`flex items-center gap-1 rounded border px-2 py-0.5 ${
                        selectedOwner === owner
                          ? "border-[var(--foreground)] bg-[var(--surface-hover)] text-foreground"
                          : "border-[var(--hairline)] text-muted"
                      }`}
                    >
                      {owner === "auto" ? (
                        <Bot className="size-3" aria-hidden="true" />
                      ) : (
                        <UserRound className="size-3" aria-hidden="true" />
                      )}
                      {FLOW_STEP_OWNER_LABELS[owner]}
                    </button>
                  ))}
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
