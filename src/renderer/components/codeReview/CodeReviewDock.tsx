import { useMemo, useState } from "react";
import { Check, ChevronDown, Code, Crosshair, Download, FileCode2, FunctionSquare, Info, Plus, TriangleAlert, X } from "lucide-react";
import { Button } from "@heroui/react";
import type { ProjectLocation } from "@/shared/contracts";
import type { ReviewIssueStatus, ReviewTaskView } from "@/shared/ipc";
import { ThreadDockHeader, ThreadDockIconButton, ThreadDockList } from "@/renderer/components/thread/ThreadDockUI";
import { useCodeReviewStore, useProjectReviewState } from "@/renderer/state/codeReviewStore";
import { useAppStore } from "@/renderer/state/appStore";
import {
  buildFeatureTree,
  collectFeatureIds,
  collectFeatureFiles,
  collectFeatureFunctions,
  filterIssuesByScope,
  filterIssuesByTask,
  issueBelongsToFunction,
  sameReviewFileExact,
  splitDescriptionLocation,
  type ReviewFeatureNode,
  type ReviewFunctionInfo,
  type ReviewIssueView,
  type ReviewMode,
} from "@/renderer/state/codeReviewReport";
import {
  FEATURE_DESCRIPTION_TITLE,
  REVIEW_MODE_LABELS,
  REVIEW_MODE_OVERVIEW_TITLE,
  useReviewMode,
} from "@/renderer/state/codeReviewMode";
import { exportIssuesToXlsx } from "@/renderer/utils/codeReviewExport";
import { collapseSidebar } from "@/renderer/state/sidebarOverlayStore";

const MODE_LABELS: Record<ReviewMode, string> = {
  function: "函数审查",
  chain: "链路审查",
  feature: "功能审查",
};

const REVIEW_KIND_OPTIONS: readonly { value: ReviewTaskView["kind"]; label: string }[] = [
  { value: "function", label: "函数审查" },
  { value: "chain", label: "链路审查" },
  { value: "feature", label: "功能审查" },
  { value: "regression", label: "回归审查" },
];

/**
 * 面板配色一律使用应用**真实存在**的 design token（accent / success / warning /
 * danger / muted / foreground / border）。
 *
 * ⚠️ 不要用 `primary`、`success-500`、`danger-500` 这类名字：HeroUI v3 的主题只暴露
 * 上面那一组 token，`text-primary` / `bg-primary-500` 之类根本不会生成任何 CSS，
 * 结果就是按钮文字与背景同色、整个按钮看不见。
 */

/**
 * 状态 → 视觉色调，对齐源项目 requirement_extractor 的 problem_status 配色系统：
 *
 * | 状态   | 主色 | 卡片                |
 * |--------|------|---------------------|
 * | 新发现 | 绿   | 绿边 + 绿底、圆点发光 |
 * | 已查看 | 灰   | 灰边 + 淡化（opacity）|
 * | 已过滤 | 灰   | 灰边 + 淡化（opacity）|
 * | 已标记 | 蓝   | 蓝边 + 蓝底、圆点发光 |
 *
 * 「严重度」不再决定卡片底色（否则一张新发现的「重要问题」卡片会是绿色，语义打架），
 * 而是单独用红/橙标签表达，两者互不干扰。
 */
type StatusTone = "new" | "dimmed" | "marked";

const STATUS_TONE: Record<ReviewIssueStatus, StatusTone> = {
  new: "new",
  viewed: "dimmed",
  filtered: "dimmed",
  marked: "marked",
};

/** 卡片容器：边框 + 左侧 3px 状态色条 + 底色。 */
const CARD_CLASS: Record<StatusTone, string> = {
  new: "border-success/30 border-l-success bg-success/5 hover:border-success/55",
  dimmed: "border-[color:var(--border)] border-l-[color:var(--muted)] bg-foreground/5 opacity-80 hover:opacity-100",
  marked: "border-accent/40 border-l-accent bg-accent/5 hover:border-accent/60",
};

/** 卡片标题行（“问题 N”与其图标）的取色。 */
const CARD_TITLE_CLASS: Record<StatusTone, string> = {
  new: "text-success",
  dimmed: "text-muted",
  marked: "text-accent",
};

/** 状态圆点：新发现/已标记带光晕，其余中性灰。 */
const DOT_CLASS: Record<StatusTone, string> = {
  new: "bg-success shadow-[0_0_6px_rgba(34,197,94,0.55)]",
  dimmed: "bg-[color:var(--muted)]",
  marked: "bg-accent shadow-[0_0_6px_rgba(59,130,246,0.55)]",
};

/** 状态 chip（角标 / 按钮选中态）。 */
const STATUS_CHIP_CLASS: Record<StatusTone, string> = {
  new: "border-success/45 bg-success/15 text-success",
  dimmed: "border-[color:var(--border)] bg-foreground/10 text-foreground",
  marked: "border-accent/45 bg-accent/15 text-accent",
};

/** 4 态按钮未选中态。 */
const STATUS_IDLE_CLASS =
  "border-transparent bg-foreground/5 text-muted hover:bg-foreground/10 hover:text-foreground";

const STATUS_OPTIONS: readonly { value: ReviewIssueStatus; label: string }[] = [
  { value: "new", label: "新发现" },
  { value: "viewed", label: "已查看" },
  { value: "filtered", label: "已过滤" },
  { value: "marked", label: "已标记" },
];

function statusLabel(value: ReviewIssueStatus): string {
  return STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

/**
 * 严重度 → 标签配色。等级提示词已收窄为两级（重要问题 / 一般问题），历史报告的
 * 英文等级（high/medium）也归一化到这两级。
 */
function severityTone(severity: string): "danger" | "warning" | "muted" {
  if (severity.includes("重要") || /high|critical|major/i.test(severity)) return "danger";
  if (severity.includes("一般") || /medium|moderate/i.test(severity)) return "warning";
  return "muted";
}

function severityLabel(severity: string): string {
  const tone = severityTone(severity);
  if (tone === "danger") return "重要问题";
  if (tone === "warning") return "一般问题";
  return severity || "未分级";
}

const SEVERITY_TAG_CLASS: Record<"danger" | "warning" | "muted", string> = {
  danger: "border-danger/35 bg-danger/10 text-danger",
  warning: "border-warning/40 bg-warning/10 text-warning",
  muted: "border-[color:var(--border)] bg-foreground/5 text-muted",
};

function locateIssue(issue: ReviewIssueView): void {
  collapseSidebar();
  // 跳到代码视图：切到该问题所在文件、滚动到问题行并临时高亮（闪烁数秒）。
  useCodeReviewStore.getState().selectReviewTarget({ file: issue.file, issueKey: issue.key });
}

/**
 * 汇总报告级「函数功能概述」（报告末端 `function_info` → 主进程 ingest → IPC → store）。
 * 按（任务 + 文件 + 函数名）去重，同名保留第一条非空描述；描述为空也保留，面板显示占位。
 */
function dedupeFunctionInfos(infos: readonly ReviewFunctionInfo[]): ReviewFunctionInfo[] {
  const seen = new Map<string, ReviewFunctionInfo>();
  for (const info of infos) {
    const key = `${info.taskId}::${info.fileName}::${info.functionName}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, info);
    } else if (!existing.functionDescription && info.functionDescription) {
      seen.set(key, info);
    }
  }
  return [...seen.values()];
}

/**
 * 问题单上方要展示的概述列表，优先级：
 * 1. 选中某个函数时，只展示**该函数**的概述（与问题单按函数过滤保持一致）；
 * 2. 选中文件时，该文件下的函数概述（`function_info.file_name` 对齐）；
 * 3. 否则列出「当前问题所属函数」的概述；
 * 4. 都匹配不到时回退展示全部 —— 保证区块要么有内容、要么有明确空态。
 */
function pickOverviews(
  all: readonly ReviewFunctionInfo[],
  issues: readonly ReviewIssueView[],
  selectedFile: string | null,
  selectedFunction: string | null,
): readonly ReviewFunctionInfo[] {
  if (all.length === 0) return [];
  if (selectedFunction) {
    const byFunction = all.filter(
      (info) =>
        (!info.fileName || !selectedFile || sameReviewFileExact(info.fileName, selectedFile)) &&
        issueBelongsToFunction({ functionName: info.functionName || null }, selectedFunction),
    );
    if (byFunction.length > 0) return byFunction;
  }
  if (selectedFile) {
    const byFile = all.filter(
      (info) => info.fileName && sameReviewFileExact(info.fileName, selectedFile),
    );
    if (byFile.length > 0) return byFile;
  }
  const names = new Set(
    issues.map((issue) => issue.functionName).filter((name): name is string => Boolean(name)),
  );
  const matched = all.filter((info) => !info.functionName || names.has(info.functionName));
  return matched.length > 0 ? matched : all;
}

export function CodeReviewDock(props: {
  projectId: string;
  projectName: string;
  projectLocation?: ProjectLocation;
  onClose: () => void;
}) {
  const { projectId, projectName, projectLocation, onClose } = props;
  const state = useProjectReviewState(projectId);
  const codeViewOpen = useCodeReviewStore((s) => s.codeViewOpen);
  const setCodeViewOpen = useCodeReviewStore((s) => s.setCodeViewOpen);
  const boardTakeover = useCodeReviewStore((s) => s.boardTakeover);
  const setBoardTakeover = useCodeReviewStore((s) => s.setBoardTakeover);
  // 项目看板已经并入工作台，这里的入口只负责把主区切到那个标签页。
  const view = useAppStore((s) => s.view);
  const openWorkbench = useAppStore((s) => s.openWorkbench);
  const projectBoardActive = view.kind === "workbench" && view.tab === "projects";
  const createTask = useCodeReviewStore((s) => s.createTask);
  const [collapsed, setCollapsed] = useState(false);
  // 新建审查任务表单（创建即落库，对齐静态分析）。
  const [showCreate, setShowCreate] = useState(false);
  const [createKind, setCreateKind] = useState<ReviewTaskView["kind"]>("function");
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  // 展开的问题卡片下标集合，改为折叠集合：默认空 = 全部展开（问题清单默认展开）。
  const [collapsedSet, setCollapsedSet] = useState<ReadonlySet<number>>(() => new Set());

  const allIssues = state?.issues ?? [];
  const mode = useReviewMode(projectId);
  const selectedFile = useCodeReviewStore((s) => s.selectedReviewFile);
  const selectedFunction = useCodeReviewStore((s) => s.selectedReviewFunction);
  const selectedReviewTaskId = useCodeReviewStore((s) => s.selectedReviewTaskId);
  const selectedReviewFeatureId = useCodeReviewStore((s) => s.selectedReviewFeatureId);
  const selectedReviewFeatureIds = useCodeReviewStore((s) => s.selectedReviewFeatureIds);
  const clearSelectedReviewFunction = useCodeReviewStore((s) => s.clearSelectedReviewFunction);
  // 问题单范围：先按任务（功能模块列表选中的链路 / 功能），再按功能模块，
  // 再按文件（点文件节点），最后按函数（点函数节点 → 只留该函数的问题）。
  const issues = filterIssuesByScope(
    allIssues,
    selectedFile,
    selectedFunction,
    selectedReviewTaskId,
    selectedReviewFeatureIds,
  );
  // 当前选中的功能模块节点（用于第四栏顶部「功能介绍」区块）。
  const selectedFeatureNode = useMemo<ReviewFeatureNode | null>(() => {
    if (!selectedReviewFeatureId || !selectedReviewTaskId) return null;
    const roots = buildFeatureTree(
      (state?.features ?? []).filter((feature) => feature.taskId === selectedReviewTaskId),
    );
    const stack: ReviewFeatureNode[] = [...roots];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      if (node.id === selectedReviewFeatureId) return node;
      stack.push(...node.children);
    }
    return null;
  }, [state?.features, selectedReviewTaskId, selectedReviewFeatureId]);
  const functionOverviews = pickOverviews(
    dedupeFunctionInfos(filterIssuesByTask(state?.functionInfos ?? [], selectedReviewTaskId)),
    issues,
    selectedFile,
    selectedFunction,
  );

  const toggleExpanded = (index: number) => {
    setCollapsedSet((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };
  const statuses = state?.statuses ?? {};
  const markedCount = issues.filter((i) => statuses[i.key] === "marked").length;
  const overviewTitle = REVIEW_MODE_OVERVIEW_TITLE[mode ?? "function"];
  const progress = state?.progress ?? null;
  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : progress?.status === "done"
        ? 100
        : 0;

  const exportRows = () => {
    void exportIssuesToXlsx(issues, statuses, `代码审查-${projectName}`);
  };

  const handleCreateReview = async () => {
    if (creating || !projectLocation) return;
    setCreating(true);
    try {
      const name =
        createName.trim() ||
        `代码审查-${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
      await createTask(projectId, projectLocation, { taskName: name, kind: createKind });
      setCreateName("");
      setShowCreate(false);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--content-background)] text-xs">
      <ThreadDockHeader
        icon={FileCode2}
        iconClassName="text-accent"
        title="问题清单"
        countLabel={
          <span>
            {mode ? `${REVIEW_MODE_LABELS[mode]} · ` : ""}已标记 {markedCount}/{issues.length}
          </span>
        }
        actions={
          <>
            <ThreadDockIconButton
              label={showCreate ? "收起新建" : "新建审查任务"}
              tooltip={showCreate ? "收起新建" : "新建审查任务"}
              onPress={() => setShowCreate(!showCreate)}
            >
              <Plus className={`size-3.5 ${showCreate ? "text-accent" : ""}`} />
            </ThreadDockIconButton>
            <ThreadDockIconButton
              label={boardTakeover ? "返回工作台" : "打开项目看板"}
              tooltip={boardTakeover ? "返回工作台" : "打开项目看板"}
              onPress={() => {
                // 退出「接管」模式，让工作台重新出现在主区，并切到项目看板。
                setBoardTakeover(false);
                openWorkbench("projects");
              }}
            >
              <Info className={`size-3.5 ${projectBoardActive ? "text-accent" : ""}`} />
            </ThreadDockIconButton>
            <ThreadDockIconButton
              label={codeViewOpen ? "隐藏代码视图" : "显示代码视图"}
              tooltip={codeViewOpen ? "隐藏代码视图" : "显示代码视图"}
              onPress={() => setCodeViewOpen(!codeViewOpen)}
            >
              <Code className={`size-3.5 ${codeViewOpen ? "text-accent" : ""}`} />
            </ThreadDockIconButton>
            <ThreadDockIconButton label="导出 Excel" tooltip="导出 Excel" onPress={exportRows}>
              <Download className="size-3.5" />
            </ThreadDockIconButton>
            <ThreadDockIconButton
              label={collapsed ? "展开" : "折叠"}
              tooltip={collapsed ? "展开" : "折叠"}
              onPress={() => setCollapsed(!collapsed)}
            >
              <ChevronDown
                className={`size-3.5 transition-transform ${collapsed ? "-rotate-90" : "rotate-0"}`}
              />
            </ThreadDockIconButton>
            <ThreadDockIconButton label="关闭" tooltip="关闭" onPress={onClose}>
              <X className="size-3.5" />
            </ThreadDockIconButton>
          </>
        }
      />

      {showCreate ? (
        <div className="flex flex-col gap-1.5 border-b border-[color:var(--border)] px-2 py-2">
          <div className="text-[0.85em] font-medium text-muted">新建审查任务（创建即落库）</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              className="h-7 rounded-md border border-[color:var(--border)] bg-transparent px-1.5 text-xs"
              value={createKind}
              onChange={(e) => setCreateKind(e.target.value as ReviewTaskView["kind"])}
            >
              {REVIEW_KIND_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <input
              className="min-w-0 flex-1 rounded border border-[color:var(--border)] bg-transparent px-1.5 py-1 text-xs"
              placeholder="任务名称（可选）"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
            />
            <Button
              size="sm"
              variant="primary"
              isDisabled={creating || !projectLocation}
              onPress={() => void handleCreateReview()}
            >
              {creating ? "创建中…" : "创建"}
            </Button>
          </div>
        </div>
      ) : null}

      {progress ? (
        <div className="flex shrink-0 flex-col gap-1 border-b border-[color:var(--border)] px-2 py-2">
          <div className="flex items-center justify-between text-[0.85em]">
            <span className="text-muted">
              {progress.status === "done" ? "审查完成" : "审查进行中"}
            </span>
            <span className="text-muted">
              {progress.done}/{progress.total}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
            <div
              className={`h-full rounded-full transition-all ${
                progress.status === "done" ? "bg-success" : "bg-accent"
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="truncate text-[0.8em] text-muted">
            {progress.status === "done"
              ? `发现问题 ${progress.accumulatedIssues ?? 0} 条`
              : progress.currentFunction
                ? `正在审查 ${progress.currentFunction}${
                    progress.currentFile ? ` · ${progress.currentFile}` : ""
                  }`
                : "正在初始化…"}
            {progress.mode ? ` · ${MODE_LABELS[progress.mode] ?? progress.mode}` : ""}
          </div>
        </div>
      ) : null}

      {/* 功能介绍（对齐源项目链路 / 功能审查四栏布局第四栏顶部的 feature-info-section）：
          选中第一栏的功能模块时展示它的 description；未选中时不占用空间。 */}
      {!collapsed && selectedFeatureNode ? (
        <div className="flex shrink-0 flex-col gap-1 border-b border-[color:var(--border)] px-2 py-2">
          <div className="flex items-center gap-1.5 text-[0.85em] font-semibold text-accent">
            <FileCode2 className="size-3.5 shrink-0" />
            <span>{FEATURE_DESCRIPTION_TITLE}</span>
            <span className="min-w-0 flex-1 truncate font-normal text-foreground">
              {selectedFeatureNode.section
                ? `${selectedFeatureNode.section} ${selectedFeatureNode.name}`
                : selectedFeatureNode.name}
            </span>
          </div>
          {selectedFeatureNode.description ? (
            <div className="whitespace-pre-wrap break-words text-[0.9em] leading-[1.6] text-foreground/80">
              {selectedFeatureNode.description}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-[color:var(--border)] px-2 py-1.5 text-[0.85em] text-muted">
              该功能模块未提供功能介绍
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.75em] text-muted">
            {selectedFeatureNode.entryFunction ? (
              <span>入口 {selectedFeatureNode.entryFunction}</span>
            ) : null}
            {collectFeatureIds(selectedFeatureNode).length > 1 ? (
              <span>{collectFeatureIds(selectedFeatureNode).length - 1} 个子功能</span>
            ) : null}
            {collectFeatureFiles(selectedFeatureNode).length > 0 ? (
              <span>{collectFeatureFiles(selectedFeatureNode).length} 文件</span>
            ) : null}
            {collectFeatureFunctions(selectedFeatureNode).length > 0 ? (
              <span>{collectFeatureFunctions(selectedFeatureNode).length} 函数</span>
            ) : null}
            {selectedFeatureNode.chainOrder.length > 0 ? (
              <span title={selectedFeatureNode.chainOrder.join(" → ")}>
                链路 {selectedFeatureNode.chainOrder.length} 环
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 功能概述（对齐源项目 requirement_extractor 侧边栏，标题按审查模式切换）：
          **常显**在问题单上方，数据来自报告末端 function_info；字段为空/报告缺失时
          也保留区块并显示空态。 */}
      {!collapsed ? (
        <div className="flex shrink-0 flex-col gap-1.5 border-b border-[color:var(--border)] px-2 py-2">
          <div className="flex items-center gap-1.5 text-[0.85em] font-semibold text-accent">
            <FileCode2 className="size-3.5 shrink-0" />
            <span>{overviewTitle}</span>
            {functionOverviews.length > 0 ? (
              <span className="font-normal text-muted">（{functionOverviews.length}）</span>
            ) : null}
          </div>
          {functionOverviews.length === 0 ? (
            <div className="rounded-md border border-dashed border-[color:var(--border)] px-2 py-1.5 text-[0.85em] text-muted">
              暂无{overviewTitle}
            </div>
          ) : (
            <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto pr-0.5">
              {functionOverviews.map((overview) => (
                <div
                  key={`${overview.taskId}::${overview.fileName}::${overview.functionName}`}
                  className="rounded-md border border-accent/25 bg-accent/5 px-2 py-1.5"
                >
                  <div className="mb-0.5 flex flex-wrap items-baseline gap-1.5">
                    {overview.functionName ? (
                      <span className="break-all font-mono text-[0.85em] font-medium text-accent">
                        {overview.functionName}
                      </span>
                    ) : (
                      <span className="text-[0.8em] text-muted">（未命名函数）</span>
                    )}
                    {overview.fileName ? (
                      <span className="break-all text-[0.72em] text-muted">{overview.fileName}</span>
                    ) : null}
                    {overview.mode ? (
                      <span className="shrink-0 text-[0.72em] text-muted">
                        {MODE_LABELS[overview.mode] ?? overview.mode}
                      </span>
                    ) : null}
                  </div>
                  {overview.functionDescription ? (
                    <div className="whitespace-pre-wrap break-words text-[0.9em] leading-[1.6] text-foreground/80">
                      {overview.functionDescription}
                    </div>
                  ) : (
                    <div className="text-[0.85em] italic text-muted">该函数未返回功能概述</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* 函数筛选条：点击左侧目录树的函数节点后，问题单只显示该函数的问题 —— 这里
          明确提示「当前只看哪个函数」，并提供一键回到该文件全部函数的出口。 */}
      {selectedFunction ? (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-[color:var(--border)] bg-accent/5 px-2 py-1.5 text-[0.85em]">
          <FunctionSquare className="size-3.5 shrink-0 text-accent" />
          <span className="shrink-0 text-muted">只看函数</span>
          <span
            className="min-w-0 flex-1 truncate font-mono font-medium text-accent"
            title={selectedFunction}
          >
            {selectedFunction}
          </span>
          <button
            type="button"
            onClick={clearSelectedReviewFunction}
            className="shrink-0 rounded border border-[color:var(--border)] px-1.5 py-0.5 transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            显示全部函数
          </button>
        </div>
      ) : null}

      <ThreadDockList placement="right" collapsed={collapsed} gap="0.5">
        {issues.length === 0 ? (
          <li className="px-2 py-3 text-[0.85em] text-muted">
            {state?.loading
              ? "正在读取审查结果…"
              : selectedFunction
                ? `函数「${selectedFunction}」暂无审查问题。`
                : selectedFile
                  ? "该文件暂无审查问题。"
                  : "暂无审查问题。运行代码审查场景后，问题清单会自动出现在这里。"}
          </li>
        ) : (
          issues.map((issue, index) => (
            <IssueRow
              key={issue.key}
              issue={issue}
              index={index}
              status={statuses[issue.key] ?? "new"}
              expanded={!collapsedSet.has(index)}
              onToggleExpand={() => toggleExpanded(index)}
              onLocate={() => locateIssue(issue)}
            />
          ))
        )}
      </ThreadDockList>

      {issues.length > 0 ? (
        <div className="flex shrink-0 items-center justify-between border-t border-[color:var(--border)] px-2 py-1">
          <span className="text-[0.85em] text-muted">共 {issues.length} 条</span>
          <span className="flex items-center gap-2 text-[0.8em] text-muted">
            <span className="flex items-center gap-1">
              <span className={`size-2 rounded-full ${DOT_CLASS.new}`} />新发现
            </span>
            <span className="flex items-center gap-1">
              <span className={`size-2 rounded-full ${DOT_CLASS.dimmed}`} />
              已查看/已过滤
            </span>
            <span className="flex items-center gap-1">
              <span className={`size-2 rounded-full ${DOT_CLASS.marked}`} />已标记
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function IssueRow(props: {
  issue: ReviewIssueView;
  index: number;
  status: ReviewIssueStatus;
  expanded: boolean;
  onToggleExpand: () => void;
  onLocate: () => void;
}) {
  const { issue, index, status, expanded, onToggleExpand, onLocate } = props;
  const setIssueStatus = useCodeReviewStore((s) => s.setIssueStatus);
  const marked = status === "marked";

  const mark = (next: ReviewIssueStatus) => {
    const entries = useCodeReviewStore.getState().byProjectId;
    for (const [pid, entry] of Object.entries(entries)) {
      if (entry.issues.some((i) => i.key === issue.key)) {
        setIssueStatus(pid, issue.key, next);
        return;
      }
    }
  };

  const tone = STATUS_TONE[status];
  const severity = severityTone(issue.severity);

  return (
    <li
      className={`cursor-pointer rounded-lg border border-l-[3px] p-3 transition-all ${CARD_CLASS[tone]}`}
    >
      {/* header 行：状态圆点 + 问题编号 + 状态 chip + 严重度标签；右侧定位/标记/折叠 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`size-2 shrink-0 rounded-full ${DOT_CLASS[tone]}`} aria-hidden="true" />
          <TriangleAlert className={`size-4 shrink-0 ${CARD_TITLE_CLASS[tone]}`} />
          <span className={`shrink-0 font-medium ${CARD_TITLE_CLASS[tone]}`}>问题 {index + 1}</span>
          <span
            className={`shrink-0 rounded-full border px-1.5 py-px text-[0.78em] ${STATUS_CHIP_CLASS[tone]}`}
          >
            {statusLabel(status)}
          </span>
          {issue.severity ? (
            <span
              className={`shrink-0 rounded border px-1.5 py-px text-[0.8em] ${SEVERITY_TAG_CLASS[severity]}`}
            >
              {severityLabel(issue.severity)}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onLocate}
            aria-label="定位到代码"
            title="定位到代码（跳转并高亮该问题行）"
            className="flex items-center gap-0.5 rounded border border-accent/45 bg-accent/10 px-1.5 py-0.5 text-[0.8em] font-medium text-accent transition-colors hover:bg-accent/20"
          >
            <Crosshair className="size-3" />
            定位
          </button>
          <button
            type="button"
            onClick={() => mark(marked ? "new" : "marked")}
            className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-[0.8em] transition-colors ${
              marked
                ? "bg-accent/15 text-accent"
                : "text-muted hover:bg-foreground/10 hover:text-foreground"
            }`}
          >
            <Check className="size-3" />
            {marked ? "已标记" : "标记"}
          </button>
          <button
            type="button"
            onClick={onToggleExpand}
            aria-label={expanded ? "收起" : "展开"}
            title={expanded ? "收起" : "展开"}
            className="rounded px-1 py-0.5 text-muted transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <ChevronDown
              className={`size-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`}
            />
          </button>
        </div>
      </div>

      {/* 展开内容区：字段竖排，空值整块不渲染；末尾保留 4 态切换按钮 */}
      {expanded ? (
        <div className="mt-3 border-t border-dashed border-[color:var(--border)] pt-3">
          <IssueField label="问题原因" value={issue.problemReason} />
          <IssueField label="问题名称" value={issue.summary} />
          <IssueField label="问题位置" value={issue.issueLocation} />
          <IssueField label="需求描述" value={issue.suggestion} />
          <IssueField label="问题描述" value={issue.descriptionIssue} />
          <IssueLocationField label="位置描述" value={issue.descriptionLocation} />
          <IssueField label="影响描述" value={issue.impact} />
          <IssueField label="涉及函数" value={issue.affectedFunctions} />
          <div className="mt-3 flex flex-wrap gap-1">
            {STATUS_OPTIONS.map((option) => {
              const optionTone = STATUS_TONE[option.value];
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={status === option.value}
                  onClick={() => mark(option.value)}
                  className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[0.78em] transition-colors ${
                    status === option.value ? STATUS_CHIP_CLASS[optionTone] : STATUS_IDLE_CLASS
                  }`}
                >
                  <span className={`size-1.5 rounded-full ${DOT_CLASS[optionTone]}`} />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function IssueField(props: { label: string; value: string }) {
  const { label, value } = props;
  if (!value) return null;
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 text-xs font-medium tracking-wide text-muted">{label}</div>
      <div className="break-words text-[13px] leading-[1.6] text-foreground/80">{value}</div>
    </div>
  );
}

/**
 * 位置描述字段：`description_location` 同时含定位说明与引用的源程序（`…源程序为：<代码>`）。
 * 前者按普通文字展示，后者抽出来用**代码格式**（深色等宽 `pre`）渲染，对齐源项目
 * requirement_extractor 函数审查侧边栏的「位置描述 / 源程序为」版式。
 */
function IssueLocationField(props: { label: string; value: string }) {
  const { label, value } = props;
  const { summary, source } = splitDescriptionLocation(value);
  if (!summary && !source) return null;
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 text-xs font-medium tracking-wide text-muted">{label}</div>
      {summary ? (
        <div className="break-words text-[13px] leading-[1.6] text-foreground/80">{summary}</div>
      ) : null}
      {source ? (
        <div className="mt-1.5 overflow-hidden rounded-md border border-[#3c3c3c] bg-[#1f2937]">
          <div className="border-b border-[#4b5563] bg-[#374151] px-2.5 py-1 text-[0.8em] font-medium text-[#e5e7eb]">
            源程序
          </div>
          <pre className="m-0 max-h-80 overflow-auto whitespace-pre bg-[#111827] p-3 font-mono text-[12px] leading-[1.6] text-[#e5e7eb]">
            {source}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
