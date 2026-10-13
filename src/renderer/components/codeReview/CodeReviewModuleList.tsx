import { useMemo, useRef, useState } from "react";
import {
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  ListChecks,
  Loader2,
  PauseCircle,
} from "lucide-react";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useCodeReviewStore, useProjectReviewState } from "@/renderer/state/codeReviewStore";
import type { ReviewTaskView } from "@/shared/ipc";
import {
  buildFeatureTree,
  collectFeatureFiles,
  collectFeatureFunctions,
  collectFeatureIds,
  filterIssuesToFeature,
  type ReviewFeatureNode,
  type ReviewIssueView,
} from "@/renderer/state/codeReviewReport";
import {
  REVIEW_MODE_LABELS,
  REVIEW_MODE_MODULE_TITLE,
  featureStatusMeta,
  useReviewMode,
} from "@/renderer/state/codeReviewMode";

const WIDTH_KEY = "agentemployee-code-review-modulelist-width";
const MIN_WIDTH = 200;
const MAX_WIDTH = 460;
const DEFAULT_WIDTH = 260;

function loadWidth(): number {
  try {
    const raw = Number.parseInt(localStorage.getItem(WIDTH_KEY) ?? "", 10);
    if (Number.isFinite(raw)) return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, raw));
  } catch {
    /* ignore */
  }
  return DEFAULT_WIDTH;
}

/** 任务状态 → 文案 + 配色（沿用面板真实 design token）。 */
function statusMeta(status: string): { label: string; className: string; icon: typeof Loader2 } {
  if (status === "done") return { label: "已完成", className: "text-success", icon: CheckCircle2 };
  if (status === "running") return { label: "进行中", className: "text-accent", icon: Loader2 };
  if (status === "paused") return { label: "已暂停", className: "text-warning", icon: PauseCircle };
  return { label: "待开始", className: "text-muted", icon: CircleDashed };
}

/** 报告镜像进来的任务没有 task_name（agent 直接写报告），用短 taskId 兜底。 */
function taskLabel(task: ReviewTaskView): string {
  const name = task.taskName?.trim();
  if (name) return name;
  return `审查任务 ${task.taskId.slice(0, 8)}`;
}

/** 一个功能模块的问题统计（对齐源项目功能模块列表的三档角标）。 */
interface FeatureStats {
  unfiltered: number;
  filtered: number;
  marked: number;
}

/** 功能模块角标（未过滤 / 已过滤 / 已标记），对齐源项目 `status-badge-*`。 */
function FeatureBadges(props: { stats: FeatureStats }) {
  const { stats } = props;
  if (stats.unfiltered === 0 && stats.filtered === 0 && stats.marked === 0) return null;
  const badge = (value: number, className: string, title: string) =>
    value > 0 ? (
      <span className={`shrink-0 rounded px-1 text-[0.68em] font-semibold leading-4 ${className}`} title={title}>
        {value}
      </span>
    ) : null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {badge(stats.unfiltered, "bg-danger/15 text-danger", `未过滤问题：${stats.unfiltered}`)}
      {badge(stats.filtered, "bg-foreground/10 text-muted", `已过滤问题：${stats.filtered}`)}
      {badge(stats.marked, "bg-accent/15 text-accent", `已标记问题：${stats.marked}`)}
    </span>
  );
}

/** 按功能模块（含子树）统计问题三档数量。 */
function statsFor(
  node: ReviewFeatureNode,
  issues: readonly ReviewIssueView[],
  statuses: Readonly<Record<string, string>>,
): FeatureStats {
  const scoped = filterIssuesToFeature(issues, {
    featureIds: collectFeatureIds(node),
    files: collectFeatureFiles(node),
    functions: collectFeatureFunctions(node),
  });
  let filtered = 0;
  let marked = 0;
  for (const issue of scoped) {
    const status = statuses[issue.key];
    if (status === "filtered") filtered += 1;
    else if (status === "marked") marked += 1;
  }
  return { unfiltered: scoped.length - filtered - marked, filtered, marked };
}

/**
 * 四栏布局的**第一栏**：「功能模块列表」（链路审查）/「功能列表」（功能审查）。
 *
 * 对齐源项目 requirement_extractor：
 * - 链路审查第一栏是**按需求章节组织的功能模块树**（`features[].sub_features` 嵌套），
 *   叶子节点带「未过滤 / 已过滤 / 已标记」三档问题角标；
 * - 功能审查第一栏是**功能卡片清单**（名称 + 状态标签 + 功能描述 + 涉及文件/函数）。
 *
 * 数据来自报告 `features[]`（经主进程 ingest 镜像入库 → IPC → store）。
 * **报告没有 `features` 的老数据**时退化为「按审查任务列出」（一个任务一行），
 * 保证不空白、仍可收敛——`selectedReviewTaskId` 两者共用。
 *
 * 函数审查保持三栏，本栏不渲染（`REVIEW_MODE_MODULE_TITLE.function` 为空）。
 */
export function CodeReviewModuleList() {
  const open = usePanelStore((s) => s.codeReviewPanelOpen);
  const context = usePanelStore((s) => s.codeReviewPanelContext);
  const projectId = context?.projectId;
  const activeScenario = useAppStore((s) =>
    projectId ? s.activeScenarioByProject[projectId] : undefined,
  );
  const mode = useReviewMode(projectId);
  const state = useProjectReviewState(projectId ?? null);
  const selectedReviewTaskId = useCodeReviewStore((s) => s.selectedReviewTaskId);
  const selectedReviewFeatureId = useCodeReviewStore((s) => s.selectedReviewFeatureId);
  const selectReviewTask = useCodeReviewStore((s) => s.selectReviewTask);
  const selectReviewFeature = useCodeReviewStore((s) => s.selectReviewFeature);
  const [width, setWidth] = useState(loadWidth);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const draggingRef = useRef<{
    startX: number;
    startWidth: number;
    handle: HTMLDivElement | null;
  } | null>(null);

  const issues = state?.issues ?? [];
  const statuses = state?.statuses ?? {};
  const modeFeatures = useMemo(
    () => (state?.features ?? []).filter((feature) => feature.mode === mode),
    [state?.features, mode],
  );
  const featureTree = useMemo(() => buildFeatureTree(modeFeatures), [modeFeatures]);
  // 任务内问题（功能角标只统计当前模式的报告；老报告按任务列出时用不到）。
  const modeTasks = useMemo(
    () => (state?.tasks ?? []).filter((task) => task.kind === mode),
    [state?.tasks, mode],
  );

  if (!open || !projectId || activeScenario !== "code-review") return null;
  // 函数审查（以及未解析出模式时）保持三栏，不渲染这一栏。
  if (mode !== "chain" && mode !== "feature") return null;

  const hasFeatures = featureTree.length > 0;
  const issuesOfMode = issues.filter((issue) =>
    modeTasks.some((task) => task.taskId === issue.taskId),
  );
  const issueCountOfTask = (taskId: string) =>
    issues.reduce((sum, issue) => (issue.taskId === taskId ? sum + 1 : sum), 0);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    draggingRef.current = { startX: event.clientX, startWidth: width, handle };
    handle.setPointerCapture(event.pointerId);
  };

  const rowClass = (active: boolean) =>
    `mb-1 flex w-full flex-col gap-0.5 rounded border px-2 py-1.5 text-left text-xs transition-colors ${
      active
        ? "border-accent/50 bg-accent/10"
        : "border-[color:var(--border)] hover:border-accent/35 hover:bg-foreground/5"
    }`;

  const TitleIcon = mode === "chain" ? Boxes : ListChecks;

  const toggleCollapsed = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onSelectFeature = (node: ReviewFeatureNode) => {
    selectReviewFeature({
      taskId: node.taskId,
      featureId: node.id,
      featureIds: collectFeatureIds(node),
    });
  };

  /** 渲染一个功能模块节点（链路=树行；功能=卡片行）。 */
  const renderFeature = (node: ReviewFeatureNode, depth: number): React.ReactNode => {
    const key = `${node.taskId}::${node.id}`;
    const active = selectedReviewTaskId === node.taskId && selectedReviewFeatureId === node.id;
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(key);
    const stats = statsFor(node, issuesOfMode, statuses);
    const meta = featureStatusMeta(node.status);
    const isCard = mode === "feature";

    return (
      <div key={key} className="mb-0.5">
        <div
          className={`flex w-full items-start gap-0.5 rounded border transition-colors ${
            active
              ? "border-accent/50 bg-accent/10"
              : "border-transparent hover:border-accent/35 hover:bg-foreground/5"
          }`}
          style={{ paddingLeft: depth > 0 && !isCard ? depth * 12 : undefined }}
        >
          {hasChildren && !isCard ? (
            <button
              type="button"
              onClick={() => toggleCollapsed(key)}
              aria-label={isCollapsed ? "展开子功能" : "折叠子功能"}
              aria-expanded={!isCollapsed}
              className="ml-0.5 mt-1 flex size-4 shrink-0 items-center justify-center rounded text-muted hover:bg-foreground/10 hover:text-foreground"
            >
              {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
            </button>
          ) : (
            <span className="ml-0.5 mt-1 size-4 shrink-0" aria-hidden="true" />
          )}
          <button
            type="button"
            onClick={() => onSelectFeature(node)}
            className="min-w-0 flex-1 px-1 py-1 text-left"
            title={node.description || node.name}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className={`min-w-0 flex-1 truncate font-medium ${active ? "text-accent" : "text-foreground"}`}
              >
                {node.section && node.section !== node.name
                  ? `${node.section} ${node.name}`
                  : node.name}
              </span>
              {isCard ? (
                <span className={`shrink-0 text-[0.72em] ${meta.className}`}>{meta.label}</span>
              ) : null}
              <FeatureBadges stats={stats} />
            </span>
            {isCard ? (
              <span className="mt-0.5 flex flex-col gap-0.5">
                {node.description ? (
                  <span className="line-clamp-2 break-words text-[0.75em] leading-[1.5] text-muted">
                    {node.description}
                  </span>
                ) : null}
                <span className="flex flex-wrap items-center gap-x-2 text-[0.7em] text-muted">
                  {node.entryFunction ? <span>入口 {node.entryFunction}</span> : null}
                  {node.files.length > 0 ? <span>文件 {node.files.length}</span> : null}
                  {node.functions.length > 0 ? <span>函数 {node.functions.length}</span> : null}
                </span>
              </span>
            ) : node.files.length > 0 || node.functions.length > 0 ? (
              <span className="mt-0.5 block truncate text-[0.7em] text-muted">
                {node.files.length > 0 ? `${node.files.length} 文件` : ""}
                {node.files.length > 0 && node.functions.length > 0 ? " · " : ""}
                {node.functions.length > 0 ? `${node.functions.length} 函数` : ""}
              </span>
            ) : null}
          </button>
        </div>
        {hasChildren && !isCard && !isCollapsed
          ? node.children.map((child) => renderFeature(child, depth + 1))
          : null}
      </div>
    );
  };

  return (
    <div
      className="relative z-30 flex h-full min-h-0 shrink-0 flex-col border-r border-[color:var(--border)] bg-[var(--content-background)]"
      style={{ width, minWidth: width }}
    >
      <div className="flex shrink-0 items-center justify-between gap-1 border-b border-[color:var(--border)] px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted">
          <TitleIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{REVIEW_MODE_MODULE_TITLE[mode]}</span>
        </span>
        <span className="shrink-0 text-[0.72em] text-muted">
          {hasFeatures ? `共 ${modeFeatures.length}` : ""}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        <button
          type="button"
          aria-label={`全部${REVIEW_MODE_LABELS[mode]}`}
          onClick={() => selectReviewTask(null)}
          className={rowClass(selectedReviewTaskId === null)}
        >
          <span className="flex items-center gap-1.5">
            <span className="flex size-3.5 shrink-0 items-center justify-center text-[0.8em]">∗</span>
            <span className="min-w-0 flex-1 truncate font-medium">
              全部{REVIEW_MODE_LABELS[mode]}
            </span>
            <span className="shrink-0 text-[0.72em] text-muted">{issuesOfMode.length}</span>
          </span>
        </button>

        {hasFeatures
          ? featureTree.map((node) => renderFeature(node, 0))
          : /* 兜底：报告没有 features 时按审查任务列出（一个任务 = 一条），保证不空白。 */
            modeTasks.map((task) => {
              const active = selectedReviewTaskId === task.taskId;
              const meta = statusMeta(task.status);
              const StatusIcon = meta.icon;
              const count = issueCountOfTask(task.taskId);
              return (
                <button
                  key={`${task.taskId}::${task.kind}`}
                  type="button"
                  onClick={() => selectReviewTask(task.taskId)}
                  className={rowClass(active)}
                  title={task.taskName || task.taskId}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <StatusIcon
                      className={`size-3.5 shrink-0 ${meta.className} ${
                        task.status === "running" ? "animate-spin" : ""
                      }`}
                    />
                    <span
                      className={`min-w-0 flex-1 truncate font-medium ${active ? "text-accent" : "text-foreground"}`}
                    >
                      {taskLabel(task)}
                    </span>
                    {count > 0 ? (
                      <span
                        className="shrink-0 rounded-full bg-danger/15 px-1.5 text-[0.72em] font-semibold text-danger"
                        title={`${count} 个问题`}
                      >
                        {count}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-2 pl-5 text-[0.72em] text-muted">
                    <span className={meta.className}>{meta.label}</span>
                    {task.total > 0 ? (
                      <span>
                        {task.done}/{task.total}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}

        {!hasFeatures && modeTasks.length === 0 ? (
          <div className="px-2 py-3 text-[0.8em] text-muted">
            {state?.loading
              ? "正在读取审查结果…"
              : `暂无${REVIEW_MODE_LABELS[mode]}结果。运行该模式的代码审查后，功能模块会出现在这里。`}
          </div>
        ) : null}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整功能列表宽度"
        className="agentemployee-review-resize-handle absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-accent/60"
        onPointerDown={startDrag}
        onPointerMove={(event) => {
          const drag = draggingRef.current;
          if (!drag || !drag.handle) return;
          const delta = event.clientX - drag.startX;
          const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, drag.startWidth + delta));
          setWidth(next);
          try {
            localStorage.setItem(WIDTH_KEY, String(Math.round(next)));
          } catch {
            /* ignore */
          }
        }}
        onPointerUp={() => {
          draggingRef.current = null;
        }}
      />
    </div>
  );
}
