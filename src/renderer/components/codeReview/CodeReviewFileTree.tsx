import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FileCode2, FolderTree, FunctionSquare, ListTree } from "lucide-react";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import {
  useCodeReviewStore,
  useProjectReviewState,
} from "@/renderer/state/codeReviewStore";
import { buildFeatureTree, buildReviewTree, chainOrderIndex, chainOrderLabel, collectFeatureFiles, collectFeatureFunctions, collectFeatureIds, filterIssuesByTask, filterIssuesToFeature, sameReviewFileExact, type ReviewFeatureNode } from "@/renderer/state/codeReviewReport";
import { REVIEW_MODE_TREE_TITLE, REVIEW_TREE_TABS, useReviewMode, type ReviewTreeTab } from "@/renderer/state/codeReviewMode";
import { CodeReviewCallGraph } from "./CodeReviewCallGraph";

const WIDTH_KEY = "agentemployee-code-review-filetree-width";
const MIN_WIDTH = 200;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 300;
/** 展开状态持久化（跨会话记住哪些文件节点是展开的）。 */
const EXPANDED_KEY = "agentemployee-code-review-filetree-expanded";

function loadWidth(): number {
  try {
    const raw = Number.parseInt(localStorage.getItem(WIDTH_KEY) ?? "", 10);
    if (Number.isFinite(raw)) return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, raw));
  } catch {
    /* ignore */
  }
  return DEFAULT_WIDTH;
}

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function persistExpanded(next: ReadonlySet<string>): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
  } catch {
    /* ignore */
  }
}

const STATUS_BADGE: Record<string, string> = {
  added: "bg-success/15 text-success",
  deleted: "bg-danger/15 text-danger",
  modified: "bg-warning/15 text-warning",
};
const STATUS_LABEL: Record<string, string> = {
  added: "新增",
  deleted: "删除",
  modified: "修改",
};

/** 回归场景：最新 diff 报告（updatedAt 降序）。 */
function pickLatestReport<T extends { updatedAt: string | null }>(
  reports: readonly T[],
): T | null {
  if (reports.length === 0) return null;
  let best = reports[reports.length - 1] ?? null;
  let bestScore = -1;
  for (const report of reports) {
    const time = report.updatedAt ? new Date(report.updatedAt).getTime() : 0;
    const score = Number.isFinite(time) ? time : 0;
    if (score >= bestScore) {
      bestScore = score;
      best = report;
    }
  }
  return best;
}

/** 问题数徽标：0 不渲染；>0 时按是否有已标记切换蓝/红。 */
function ProblemCount(props: { count: number; marked?: boolean }) {
  const { count, marked = false } = props;
  if (count <= 0) return null;
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 text-[0.72em] font-semibold leading-4 ${
        marked ? "bg-accent/15 text-accent" : "bg-danger/15 text-danger"
      }`}
      title={marked ? `已标记 ${count} 个问题` : `${count} 个问题`}
    >
      {count}
    </span>
  );
}

/**
 * 代码审查（配置项/回归）的**代码结构树**，渲染在最左侧，对齐源项目
 * requirement_extractor 的「文件 → 函数」两级树：
 *
 * - 文件节点：可展开/折叠，带问题数徽标与已标记徽标；点击即切到该文件的代码视图；
 * - 函数节点：文件下每个被审函数一条，带问题数；点击切到该文件、**问题单只显示
 *   该函数的问题**（其它函数的一律不显示），并定位到它的第一个问题（滚动 + 闪烁高亮）；
 * - 「全部」：取消文件与函数过滤，问题单回到全量。
 *
 * 回归场景仍列出最新 diff 报告的变更文件（带增/删/改徽标），点击联动中间 DiffEditor。
 * 与代码视图（中）、问题清单（右）构成三栏一体。宽度与展开状态均可持久化。
 */
export function CodeReviewFileTree() {
  const open = usePanelStore((s) => s.codeReviewPanelOpen);
  const context = usePanelStore((s) => s.codeReviewPanelContext);
  const projectId = context?.projectId;
  const activeScenario = useAppStore((s) =>
    projectId ? s.activeScenarioByProject[projectId] : undefined,
  );
  const state = useProjectReviewState(projectId ?? null);
  const mode = useReviewMode(projectId);
  const selectedReviewFile = useCodeReviewStore((s) => s.selectedReviewFile);
  const selectedReviewFunction = useCodeReviewStore((s) => s.selectedReviewFunction);
  const selectedReviewTaskId = useCodeReviewStore((s) => s.selectedReviewTaskId);
  const selectedReviewFeatureId = useCodeReviewStore((s) => s.selectedReviewFeatureId);
  const focusIssueKey = useCodeReviewStore((s) => s.focusIssueKey);
  const selectReviewTarget = useCodeReviewStore((s) => s.selectReviewTarget);
  const clearSelectedReviewFunction = useCodeReviewStore((s) => s.clearSelectedReviewFunction);
  const selectReviewTask = useCodeReviewStore((s) => s.selectReviewTask);
  const [width, setWidth] = useState(loadWidth);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(loadExpanded);
  const [allExpanded, setAllExpanded] = useState(false);
  // 第二栏的标签页（对齐源项目链路审查的「目录 / 调用关系」；功能审查与函数审查只有目录）。
  const [tab, setTab] = useState<ReviewTreeTab>("目录");
  const draggingRef = useRef<{
    startX: number;
    startWidth: number;
    handle: HTMLDivElement | null;
  } | null>(null);

  // 面板关闭时清除联动选择，避免残留过滤状态污染问题清单。
  // 回归场景没有函数树、也没有功能模块列表，两类筛选都不再适用，一并清掉。
  useEffect(() => {
    if (!open) {
      selectReviewTarget({ file: null, functionName: null });
      selectReviewTask(null);
      return;
    }
    if (activeScenario !== "code-review") {
      clearSelectedReviewFunction();
      selectReviewTask(null);
    }
  }, [open, activeScenario, selectReviewTarget, clearSelectedReviewFunction, selectReviewTask]);

  // 当前选中的功能模块节点（链路 / 功能审查第一栏选中的那一项），用于按功能收敛与链路角标。
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

  // 链路 / 功能审查：先按选中任务收敛；再按选中功能模块收敛（含子树），最后才组织成树。
  const tree = useMemo(() => {
    const taskIssues = filterIssuesByTask(state?.issues ?? [], selectedReviewTaskId);
    const taskInfos = filterIssuesByTask(state?.functionInfos ?? [], selectedReviewTaskId);
    let scopedIssues = taskIssues;
    let scopedInfos = taskInfos;
    if (selectedFeatureNode) {
      const files = collectFeatureFiles(selectedFeatureNode);
      const functions = collectFeatureFunctions(selectedFeatureNode);
      scopedIssues = filterIssuesToFeature(taskIssues, {
        featureIds: collectFeatureIds(selectedFeatureNode),
        files,
        functions,
      });
      scopedInfos = taskInfos.filter((info) => {
        if (info.functionName && functions.includes(info.functionName)) return true;
        return Boolean(info.fileName) && files.some((file) => sameReviewFileExact(info.fileName, file));
      });
    }
    return buildReviewTree(scopedIssues, scopedInfos, state?.statuses ?? {});
  }, [
    state?.issues,
    state?.functionInfos,
    state?.statuses,
    selectedReviewTaskId,
    selectedFeatureNode,
  ]);

  // 链路顺序角标（函数名 → 下标），选中带 chain_order 的功能模块时才有。
  const orderMap = useMemo(
    () => chainOrderIndex(selectedFeatureNode?.chainOrder ?? []),
    [selectedFeatureNode],
  );

  if (
    !open ||
    !projectId ||
    (activeScenario !== "code-review" && activeScenario !== "code-review-regression")
  )
    return null;

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    draggingRef.current = { startX: event.clientX, startWidth: width, handle };
    handle.setPointerCapture(event.pointerId);
  };

  const toggleFile = (key: string) => {
    setAllExpanded(false);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistExpanded(next);
      return next;
    });
  };

  const toggleAll = () => {
    if (allExpanded) {
      setAllExpanded(false);
      const cleared = new Set<string>();
      setExpanded(cleared);
      persistExpanded(cleared);
    } else {
      setAllExpanded(true);
      const all = new Set(tree.map((file) => file.key));
      setExpanded(all);
      persistExpanded(all);
    }
  };

  // 回归场景：变更文件列表来自最新 diff 报告。
  const regressionFiles =
    activeScenario === "code-review-regression"
      ? (pickLatestReport(state?.diffReports ?? [])?.changedFiles ?? [])
      : [];

  const functionCount = tree.reduce((sum, file) => sum + file.functions.length, 0);
  const isFileSelected = (path: string) =>
    selectedReviewFile !== null && sameReviewFileExact(path, selectedReviewFile);

  const rootClass = (active: boolean) =>
    `mb-0.5 flex w-full items-center gap-1.5 rounded border px-2 py-1 text-left text-xs transition-colors ${
      active
        ? "border-accent/50 bg-accent/10 text-accent"
        : "border-transparent text-foreground hover:bg-foreground/5"
    }`;

  const isRegression = activeScenario === "code-review-regression";
  // 只有链路审查的第二栏才有「目录 / 调用关系」两个标签页（对齐源项目）。
  const showTabs = !isRegression && mode === "chain";
  const callGraph = selectedReviewTaskId
    ? (state?.callgraphs?.[selectedReviewTaskId] ?? null)
    : null;
  const chainOrder = selectedFeatureNode?.chainOrder ?? [];

  return (
    <div
      className="relative z-30 flex h-full min-h-0 shrink-0 flex-col border-r border-[color:var(--border)] bg-[var(--content-background)]"
      style={{ width, minWidth: width }}
    >
      <div className="flex shrink-0 items-center justify-between gap-1 border-b border-[color:var(--border)] px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted">
          <FolderTree className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            {isRegression
              ? `变更文件（${regressionFiles.length}）`
              : `${mode ? REVIEW_MODE_TREE_TITLE[mode] : "代码结构"}（${tree.length} 文件 / ${functionCount} 函数）`}
          </span>
        </span>
        {!isRegression && tab === "目录" ? (
          <button
            type="button"
            onClick={toggleAll}
            className="shrink-0 rounded px-1 py-0.5 text-[0.72em] text-muted transition-colors hover:bg-foreground/10 hover:text-foreground"
            title={allExpanded ? "全部折叠" : "全部展开"}
          >
            {allExpanded ? "全部折叠" : "全部展开"}
          </button>
        ) : null}
      </div>

      {showTabs ? (
        <div className="flex shrink-0 items-center gap-1 border-b border-[color:var(--border)] px-2 py-1">
          {REVIEW_TREE_TABS.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={tab === name}
              onClick={() => setTab(name)}
              className={`rounded px-2 py-0.5 text-[0.75em] transition-colors ${
                tab === name
                  ? "bg-accent/15 font-medium text-accent"
                  : "text-muted hover:bg-foreground/10 hover:text-foreground"
              }`}
            >
              {name}
            </button>
          ))}
          {chainOrder.length > 0 ? (
            <span className="ml-1 min-w-0 flex-1 truncate text-[0.7em] text-muted" title={chainOrder.join(" → ")}>
              链路顺序：{chainOrder.map((_, index) => chainOrderLabel(index)).join(" → ")}
            </span>
          ) : null}
        </div>
      ) : null}

      {showTabs && tab === "调用关系" ? (
        <CodeReviewCallGraph graph={callGraph} chainOrder={chainOrder} />
      ) : (
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        <button
          type="button"
          onClick={() => selectReviewTarget({ file: null, functionName: null })}
          className={rootClass(selectedReviewFile === null && selectedReviewFunction === null)}
        >
          <ListTree className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-medium">全部</span>
          {!isRegression && tree.length > 0 ? (
            <span className="shrink-0 text-[0.72em] text-muted">
              {tree.reduce((sum, file) => sum + file.problemCount, 0)}
            </span>
          ) : null}
        </button>

        {isRegression
          ? regressionFiles.map((file) => {
              const active = isFileSelected(file.path);
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => selectReviewTarget({ file: file.path, functionName: null })}
                  className={rootClass(active)}
                >
                  <FileCode2 className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {file.path.split("/").pop() || file.path}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1 text-[0.72em] ${STATUS_BADGE[file.status] ?? ""}`}
                  >
                    {STATUS_LABEL[file.status] ?? file.status}
                  </span>
                </button>
              );
            })
          : tree.map((file) => {
              const fileActive = isFileSelected(file.path);
              const isOpen = expanded.has(file.key);
              return (
                <div key={file.key} className="mb-0.5">
                  {/* 文件节点：左侧展开箭头独立按钮，其余区域点击切换文件 */}
                  <div
                    className={`flex w-full items-center gap-0.5 rounded border transition-colors ${
                      fileActive
                        ? "border-accent/50 bg-accent/10"
                        : "border-transparent hover:bg-foreground/5"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleFile(file.key)}
                      aria-label={isOpen ? "折叠" : "展开"}
                      aria-expanded={isOpen}
                      className="ml-0.5 flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-foreground/10 hover:text-foreground"
                    >
                      {isOpen ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => selectReviewTarget({ file: file.path, functionName: null })}
                      className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-2 text-left text-xs"
                      title={file.path}
                    >
                      <FileCode2
                        className={`size-3.5 shrink-0 ${fileActive ? "text-accent" : "text-muted"}`}
                      />
                      <span
                        className={`min-w-0 flex-1 truncate font-medium ${
                          fileActive ? "text-accent" : "text-foreground"
                        }`}
                      >
                        {file.name}
                      </span>
                      <ProblemCount count={file.problemCount} marked={file.markedCount > 0} />
                    </button>
                  </div>
                  {/* 路径副标题（相对路径，便于区分同名文件） */}
                  <div className="ml-[1.6rem] mr-2 truncate text-[0.72em] text-muted" title={file.path}>
                    {file.path}
                  </div>

                  {isOpen ? (
                    <ul className="mb-1 ml-[1.15rem] mt-0.5 border-l border-[color:var(--border)] pl-1">
                      {file.functions.map((fn) => {
                        // 选中态 = 当前正按这个函数过滤问题单；聚焦态 = 「定位」命中了
                        // 它的首个问题（两者可以是同一个，也可能是别的函数）。
                        const fnSelected = fileActive && selectedReviewFunction === fn.name;
                        const fnFocused =
                          focusIssueKey !== null && focusIssueKey === fn.firstIssueKey;
                        return (
                          <li key={`${fn.taskId}::${fn.name}`}>
                            <button
                              type="button"
                              onClick={() =>
                                selectReviewTarget({
                                  file: file.path,
                                  issueKey: fn.firstIssueKey,
                                  functionName: fn.name,
                                })
                              }
                              className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors ${
                                fnSelected
                                  ? "bg-accent/10 text-accent"
                                  : fnFocused
                                    ? "bg-foreground/10 text-foreground"
                                    : "text-foreground/85 hover:bg-foreground/5"
                              }`}
                              title={
                                fn.problemCount > 0
                                  ? `${fn.name}（${fn.problemCount} 个问题，点击只看该函数）`
                                  : `${fn.name}（无问题）`
                              }
                            >
                              <FunctionSquare
                                className={`size-3.5 shrink-0 ${
                                  fn.problemCount > 0 ? "text-danger/80" : "text-success/80"
                                }`}
                              />
                              <span className="min-w-0 flex-1 truncate font-mono">{fn.name}</span>
                              {orderMap.has(fn.name) ? (
                                <span
                                  className="shrink-0 rounded bg-accent/15 px-1 text-[0.68em] font-semibold leading-4 text-accent"
                                  title={`链路顺序第 ${(orderMap.get(fn.name) ?? 0) + 1} 环`}
                                >
                                  {chainOrderLabel(orderMap.get(fn.name) ?? 0)}
                                </span>
                              ) : null}
                              <ProblemCount count={fn.problemCount} marked={fn.markedCount > 0} />
                            </button>
                          </li>
                        );
                      })}
                      {file.functions.length === 0 ? (
                        <li className="px-2 py-1 text-[0.75em] text-muted">该文件暂无被审函数</li>
                      ) : null}
                    </ul>
                  ) : null}
                </div>
              );
            })}

        {!isRegression && tree.length === 0 ? (
          <div className="px-2 py-3 text-[0.8em] text-muted">
            {state?.loading
              ? "正在读取审查结果…"
              : selectedFeatureNode
                ? "该功能模块暂无审查结果。"
                : "暂无审查结果。"}
          </div>
        ) : null}
      </div>
      )}

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整文件清单宽度"
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
