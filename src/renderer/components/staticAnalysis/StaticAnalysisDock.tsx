import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Code,
  Download,
  FileCode2,
  FolderOpen,
  Lock,
  Plus,
  ShieldCheck,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@heroui/react";
import type { StaticAnalysisMode, StaticAnalysisProblem } from "@/shared/staticAnalysisReport";
import {
  staticAnalysisModeLabel,
} from "@/shared/staticAnalysisReport";
import {
  ThreadDockHeader,
  ThreadDockIconButton,
} from "@/renderer/components/thread/ThreadDockUI";
import {
  staticAnalysisStatusLabel,
  useActiveStaticAnalysisTask,
  useActiveTaskFiles,
  useActiveTaskProblems,
  useProjectStaticAnalysis,
  useStaticAnalysisStore,
} from "@/renderer/state/staticAnalysisStore";
import { highlightCodeForPath } from "@/renderer/components/codeReview/codeHighlight";
import { collapseSidebar } from "@/renderer/state/sidebarOverlayStore";
import { useProject } from "@/renderer/state/useThread";
import { exportProblemsToXlsx } from "@/renderer/utils/staticAnalysisExport";
import { readBridge } from "@/renderer/bridge";

const MODES: readonly { mode: StaticAnalysisMode; kind: "normal" | "filter"; lang: "c" | "fpga" }[] = [
  { mode: "normal_c", kind: "normal", lang: "c" },
  { mode: "normal_fpga", kind: "normal", lang: "fpga" },
  { mode: "filter_c", kind: "filter", lang: "c" },
  { mode: "filter_fpga", kind: "filter", lang: "fpga" },
];

const SEVERITY_TAG_CLASS: Record<string, string> = {
  "重要问题": "border-[#fbc4c4] bg-[#fef0f0] text-[#f56c6c]",
  "一般问题": "border-[#faecd8] bg-[#fdf6ec] text-[#e6a23c]",
  "建议改进": "border-[#e9e9eb] bg-[#f4f4f5] text-[#909399]",
};
const SEVERITY_TAG_FALLBACK = "border-[#e9e9eb] bg-[#f4f4f5] text-[#909399]";

const RULE_TYPE_TAG_CLASS: Record<string, string> = {
  gjb: "border-[#d1ecf1] bg-[#d9f4f7] text-[#16a2b8]",
  cwe: "border-[#f0e4ff] bg-[#f5edff] text-[#8b5cf6]",
  fpga: "border-[#d1e7ff] bg-[#e6f0ff] text-[#3b82f6]",
};
const RULE_TYPE_TAG_FALLBACK = "border-[#e9e9eb] bg-[#f4f4f5] text-[#909399]";

const PROBLEM_STATUS_LABELS = ["新发现", "已查看", "已过滤", "已标记"] as const;

function sameFile(a: string, b: string): boolean {
  const na = a.replace(/^\.\//, "").replace(/\\/g, "/");
  const nb = b.replace(/^\.\//, "").replace(/\\/g, "/");
  return na === nb || na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`);
}

function locateProblem(projectId: string, problem: StaticAnalysisProblem): void {
  collapseSidebar();
  const store = useStaticAnalysisStore.getState();
  const taskId = store.activeTaskId[projectId] ?? "";
  store.setStaticAnalysisOpen(true);
  store.setCodeViewOpen(true);
  store.setFocusProblemKey(`${taskId}::${problem.problemId}`);
  if (problem.issue_file) store.setSelectedFile(projectId, problem.issue_file);
}

/** 高亮后的代码行；问题行高亮显示。 */
function CodeLines(props: {
  text: string;
  filePath: string;
  problemLines: ReadonlySet<number>;
}) {
  const { text, filePath, problemLines } = props;
  const lines = useMemo(() => highlightCodeForPath(text, filePath), [text, filePath]);
  return (
    <div className="cr-sa-line font-mono text-[12px] leading-[1.55]">
      {lines.map((segs, idx) => {
        const lineNo = idx + 1;
        const isProblem = problemLines.has(lineNo);
        return (
          <div
            key={idx}
            className={
              isProblem
                ? "bg-[#3a2b0f] px-2"
                : lineNo % 2 === 0
                  ? "bg-foreground/[0.03] px-2"
                  : "px-2"
            }
          >
            <span className="mr-3 inline-block w-8 select-none text-right text-muted/50">
              {lineNo}
            </span>
            {segs.length === 0 ? (
              "\u00a0"
            ) : (
              segs.map((seg, i) => (
                <span key={i} className={`${seg.cls} ${isProblem ? "font-bold" : ""}`}>
                  {seg.text}
                </span>
              ))
            )}
            {isProblem ? (
              <span className="ml-3 rounded bg-[#e6a23c]/20 px-1.5 py-px text-[10px] font-semibold text-[#e6a23c]">
                问题
              </span>
            ) : null}
          </div>
        );
      })}
      <style>{`
        .cr-sa-line .keyword{color:#c586c0;font-weight:bold}
        .cr-sa-line .type{color:#4ec9b0}
        .cr-sa-line .string{color:#ce9178}
        .cr-sa-line .comment{color:#6a9955;font-style:italic}
        .cr-sa-line .number{color:#b5cea8}
        .cr-sa-line .function{color:#dcdcaa}
        .cr-sa-line .preprocessor{color:#9cdcfe}
        .cr-sa-line .plain{color:inherit}
      `}</style>
    </div>
  );
}

export function StaticAnalysisDock(props: { projectId: string; onClose: () => void }) {
  const { projectId, onClose } = props;
  const project = useProject(projectId);
  const data = useProjectStaticAnalysis(projectId);
  const task = useActiveStaticAnalysisTask(projectId);
  const files = useActiveTaskFiles(projectId);
  const problems = useActiveTaskProblems(projectId);
  const rules = data?.rules ?? [];
  const query = useStaticAnalysisStore((s) => s.query);
  const setQuery = useStaticAnalysisStore((s) => s.setQuery);
  const ruleTypeFilter = useStaticAnalysisStore((s) => s.ruleTypeFilter);
  const setRuleTypeFilter = useStaticAnalysisStore((s) => s.setRuleTypeFilter);
  const includeFiltered = useStaticAnalysisStore((s) => s.includeFiltered);
  const setIncludeFiltered = useStaticAnalysisStore((s) => s.setIncludeFiltered);
  const selectedFile = useStaticAnalysisStore((s) => s.selectedFile[projectId]);
  const setSelectedFile = useStaticAnalysisStore((s) => s.setSelectedFile);
  const codeViewOpen = useStaticAnalysisStore((s) => s.codeViewOpen);
  const setCodeViewOpen = useStaticAnalysisStore((s) => s.setCodeViewOpen);
  const focusProblemKey = useStaticAnalysisStore((s) => s.focusProblemKey);
  const setActiveTask = useStaticAnalysisStore((s) => s.setActiveTask);
  const createTask = useStaticAnalysisStore((s) => s.createTask);
  const clearProject = useStaticAnalysisStore((s) => s.clearProject);
  const draftSelectedRules = useStaticAnalysisStore((s) => s.draftSelectedRules);
  const setDraftSelectedRules = useStaticAnalysisStore((s) => s.setDraftSelectedRules);
  const draftExcelFile = useStaticAnalysisStore((s) => s.draftExcelFile);
  const setDraftExcelFile = useStaticAnalysisStore((s) => s.setDraftExcelFile);
  const setFocusProblemKey = useStaticAnalysisStore((s) => s.setFocusProblemKey);

  const [createMode, setCreateMode] = useState<StaticAnalysisMode>("normal_c");
  const [taskName, setTaskName] = useState("");
  const [ruleTab, setRuleTab] = useState<"gjb" | "cwe">("gjb");
  const [creating, setCreating] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedSet, setExpandedSet] = useState<ReadonlySet<string>>(() => new Set());
  const [rulePickerOpen, setRulePickerOpen] = useState(true);

  const activeFile = files.find((f) => sameFile(f.file_path, selectedFile ?? "")) ?? files[0];
  const activeProblems = problems.filter(
    (p) => activeFile && sameFile(p.issue_file ?? p.file_name, activeFile.file_path),
  );
  const problemLines = new Set(activeProblems.map((p) => p.issue_line ?? 0));
  const rulesByType = ruleTab === "gjb" ? rules.filter((r) => r.ruleType === "gjb") : rules.filter((r) => r.ruleType === "cwe");
  const accurateRules = rulesByType.filter((r) => r.accuracyType === "accurate");
  const uncertainRules = rulesByType.filter((r) => r.accuracyType === "uncertain");
  const selectedSet = new Set(draftSelectedRules);
  const selectedCount = draftSelectedRules.length;
  const totalCount = rulesByType.length;

  const isToolMode = createMode.startsWith("filter_");

  // 打开时若未手动勾选规则，用全局默认规则配置预选（"保存为默认规则配置"）。
  useEffect(() => {
    if (draftSelectedRules.length > 0) return;
    let cancelled = false;
    readBridge()
      .staticAnalysisGetDefaultRules()
      .then((defaults) => {
        if (cancelled || defaults.length === 0) return;
        setDraftSelectedRules(defaults);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [draftSelectedRules.length, setDraftSelectedRules]);

  const toggleRule = (code: string) => {
    const next = new Set(selectedSet);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setDraftSelectedRules([...next]);
  };

  const selectRules = (pred: (r: (typeof rulesByType)[number]) => boolean) => {
    const next = new Set(draftSelectedRules);
    for (const rule of rulesByType) if (pred(rule)) next.add(rule.ruleCode);
    setDraftSelectedRules([...next]);
  };
  const deselectAll = () => {
    const keep = draftSelectedRules.filter((code) => !rulesByType.some((r) => r.ruleCode === code));
    setDraftSelectedRules(keep);
  };

  const handleCreate = async () => {
    if (creating) return;
    if (selectedCount === 0) return;
    setCreating(true);
    try {
      const location = project?.location;
      if (!location) return;
      const name = taskName.trim() || `静态分析-${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
      await createTask(projectId, location, {
        taskName: name,
        mode: createMode,
        selectedRules: draftSelectedRules,
        excelFile: draftExcelFile,
      });
      setTaskName("");
    } finally {
      setCreating(false);
    }
  };

  const handleSaveDefaultRules = async () => {
    if (selectedCount === 0) return;
    await readBridge().staticAnalysisSetDefaultRules({ selectedRules: draftSelectedRules });
  };

  const handlePickExcel = async () => {
    const picked = await readBridge().pickFiles({ title: "选择科代静态分析结果 Excel（.xlsx）" });
    if (picked && picked.length > 0) setDraftExcelFile(picked[0] ?? null);
  };

  const handleClearProject = async () => {
    const location = project?.location;
    if (!location) return;
    await clearProject(projectId, location);
  };

  const exportRows = () => {
    void exportProblemsToXlsx(problems, project?.name ?? "静态分析");
  };

  const toggleExpanded = (key: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--content-background)] text-xs">
      <ThreadDockHeader
        icon={ShieldCheck}
        title="静态分析"
        countLabel={
          <span className="text-muted">
            {task ? `${staticAnalysisModeLabel(task.mode)} · ${staticAnalysisStatusLabel(task.status)}` : "未创建任务"}
          </span>
        }
        actions={
          <>
            <ThreadDockIconButton
              label={codeViewOpen ? "隐藏代码视图" : "显示代码视图"}
              tooltip={codeViewOpen ? "隐藏代码视图" : "显示代码视图"}
              onPress={() => setCodeViewOpen(!codeViewOpen)}
            >
              <Code className={`size-3.5 ${codeViewOpen ? "text-primary" : ""}`} />
            </ThreadDockIconButton>
            <ThreadDockIconButton label="导出问题单 Excel" tooltip="导出问题单 Excel" onPress={exportRows}>
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

      {collapsed ? null : (
        <div className="flex min-h-0 flex-1">
          {/* 左栏：任务切换 + 创建任务 + 文件清单 */}
          <div className="flex w-64 shrink-0 flex-col border-r border-[color:var(--border)]">
            <div className="border-b border-[color:var(--border)] p-2">
              {task ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <select
                      className="w-full rounded border border-[color:var(--border)] bg-transparent px-1.5 py-1 text-xs"
                      value={task.taskId}
                      onChange={(e) => setActiveTask(projectId, e.target.value || null)}
                      aria-label="切换任务"
                    >
                      {(data?.tasks ?? []).map((t) => (
                        <option key={t.taskId} value={t.taskId}>
                          {staticAnalysisModeLabel(t.mode)} · {staticAnalysisStatusLabel(t.status)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="truncate text-[0.8em] text-muted" title={task.taskName}>
                    {task.taskName}
                  </div>
                  {task.progress > 0 && task.progress < 100 ? (
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
                        <div
                          className="h-full rounded-full bg-primary-500 transition-all"
                          style={{ width: `${Math.min(100, task.progress)}%` }}
                        />
                      </div>
                      <span className="text-[0.75em] text-muted">{task.progress}%</span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between text-[0.75em] text-muted">
                    <span>
                      问题 {task.totalProblems} · 规则 {task.totalRules}
                    </span>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-muted hover:text-danger"
                      onClick={() => void handleClearProject()}
                      title="清除该项目静态分析记录"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-[0.85em] text-muted">尚无静态分析任务</div>
              )}
            </div>

            {/* 创建任务 */}
            <div className="border-b border-[color:var(--border)] p-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1 font-semibold text-foreground">
                  <Plus className="size-3.5" /> 创建任务
                </span>
                <button
                  type="button"
                  className="text-muted hover:text-foreground"
                  onClick={() => setRulePickerOpen(!rulePickerOpen)}
                  aria-label="展开或收起创建表单"
                >
                  <ChevronDown
                    className={`size-3.5 transition-transform ${rulePickerOpen ? "" : "-rotate-90"}`}
                  />
                </button>
              </div>
              {rulePickerOpen ? (
                <div className="flex flex-col gap-1.5">
                  <div className="grid grid-cols-2 gap-1">
                    {MODES.map((m) => (
                      <button
                        key={m.mode}
                        type="button"
                        onClick={() => setCreateMode(m.mode)}
                        className={`rounded border px-1.5 py-1 text-[0.8em] leading-tight ${
                          createMode === m.mode
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-[color:var(--border)] text-muted hover:text-foreground"
                        }`}
                      >
                        {m.kind === "normal" ? "纯AI" : "工具"}·{m.lang === "c" ? "C语言" : "FPGA"}
                      </button>
                    ))}
                  </div>
                  {isToolMode ? (
                    <div className="flex items-center gap-1.5 rounded border border-[color:var(--border)] px-1.5 py-1">
                      <Table2 className="size-3.5 text-muted" />
                      <button
                        type="button"
                        className="flex-1 truncate text-left text-[0.8em] text-muted hover:text-foreground"
                        onClick={() => void handlePickExcel()}
                      >
                        {draftExcelFile ? draftExcelFile.split(/[\\/]/).pop() : "选择科代结果 Excel（.xlsx）"}
                      </button>
                    </div>
                  ) : null}
                  <input
                    className="w-full rounded border border-[color:var(--border)] bg-transparent px-1.5 py-1 text-xs"
                    placeholder="任务名称（可选）"
                    value={taskName}
                    onChange={(e) => setTaskName(e.target.value)}
                  />
                  <div className="flex items-center gap-1">
                    {(["gjb", "cwe"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setRuleTab(t)}
                        className={`rounded px-2 py-0.5 text-[0.8em] ${
                          ruleTab === t
                            ? "bg-primary text-primary-foreground"
                            : "bg-foreground/5 text-muted"
                        }`}
                      >
                        {t === "gjb" ? "GJB8114" : "CWE"}
                      </button>
                    ))}
                    <span className="ml-auto text-[0.75em] text-muted">
                      已选 {selectedCount}/{totalCount}
                    </span>
                  </div>
                  <div className="max-h-44 overflow-y-auto rounded border border-[color:var(--border)] p-1">
                    <div className="mb-1 flex items-center gap-1">
                      <button type="button" className="text-[0.75em] text-muted hover:text-foreground" onClick={() => selectRules(() => true)}>
                        全选
                      </button>
                      <button type="button" className="text-[0.75em] text-muted hover:text-foreground" onClick={() => selectRules((r) => r.accuracyType === "accurate")}>
                        仅确定
                      </button>
                      <button type="button" className="text-[0.75em] text-muted hover:text-foreground" onClick={() => selectRules((r) => r.accuracyType === "uncertain")}>
                        仅不确定
                      </button>
                      <button type="button" className="ml-auto text-[0.75em] text-muted hover:text-foreground" onClick={deselectAll}>
                        清空
                      </button>
                    </div>
                    {accurateRules.map((rule) => (
                      <label key={rule.ruleCode} aria-label={`${rule.ruleCode} ${rule.ruleName ?? ""}`} className="flex cursor-pointer items-start gap-1 px-1 py-0.5 hover:bg-foreground/5">
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-primary"
                          checked={selectedSet.has(rule.ruleCode)}
                          onChange={() => toggleRule(rule.ruleCode)}
                        />
                        <span className="min-w-0">
                          <span className="block text-[0.8em] text-foreground">
                            {rule.ruleCode}
                            <span className="ml-1 rounded bg-success-500/10 px-1 text-[0.7em] text-success-600">确定</span>
                          </span>
                          <span className="block truncate text-[0.7em] text-muted">{rule.ruleDescription || rule.ruleName}</span>
                        </span>
                      </label>
                    ))}
                    {uncertainRules.map((rule) => (
                      <label key={rule.ruleCode} aria-label={`${rule.ruleCode} ${rule.ruleName ?? ""}`} className="flex cursor-pointer items-start gap-1 px-1 py-0.5 hover:bg-foreground/5">
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-primary"
                          checked={selectedSet.has(rule.ruleCode)}
                          onChange={() => toggleRule(rule.ruleCode)}
                        />
                        <span className="min-w-0">
                          <span className="block text-[0.8em] text-foreground">
                            {rule.ruleCode}
                            <span className="ml-1 rounded bg-warning-500/10 px-1 text-[0.7em] text-warning-600">不确定</span>
                          </span>
                          <span className="block truncate text-[0.7em] text-muted">{rule.ruleDescription || rule.ruleName}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      isDisabled={selectedCount === 0}
                      onPress={() => void handleSaveDefaultRules()}
                      className="flex-1"
                    >
                      <Lock className="size-3" /> 存为默认配置
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      isDisabled={selectedCount === 0 || creating}
                      onPress={() => void handleCreate()}
                      className="flex-1"
                    >
                      {creating ? "创建中…" : `创建并开始（已选 ${selectedCount} 条）`}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            {/* 文件清单 */}
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <div className="mb-1 flex items-center gap-1 text-[0.8em] font-semibold text-muted">
                <FolderOpen className="size-3" /> 文件清单（{files.length}）
              </div>
              {files.map((file) => (
                <button
                  key={file.file_path}
                  type="button"
                  onClick={() => setSelectedFile(projectId, file.file_path)}
                  className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[0.8em] ${
                    activeFile?.file_path === file.file_path
                      ? "bg-primary/10 text-primary"
                      : "text-muted hover:bg-foreground/5 hover:text-foreground"
                  }`}
                  title={file.file_path}
                >
                  <FileCode2 className="mr-1 inline size-3 text-muted" />
                  {file.file_name}
                </button>
              ))}
            </div>
          </div>

          {/* 中栏：问题单 */}
          <div className="flex min-w-0 flex-1 flex-col border-r border-[color:var(--border)]">
            <div className="flex items-center gap-1.5 border-b border-[color:var(--border)] px-2 py-1.5">
              <input
                className="min-w-0 flex-1 rounded border border-[color:var(--border)] bg-transparent px-1.5 py-0.5 text-xs"
                placeholder="搜索问题/文件/规则…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {(["gjb", "cwe"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setRuleTypeFilter(t)}
                  className={`rounded px-1.5 py-0.5 text-[0.8em] ${
                    ruleTypeFilter === t ? "bg-primary text-primary-foreground" : "bg-foreground/5 text-muted"
                  }`}
                >
                  {t === "gjb" ? "GJB" : "CWE"}
                </button>
              ))}
              <label className="flex items-center gap-1 text-[0.8em] text-muted">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={includeFiltered}
                  onChange={(e) => setIncludeFiltered(e.target.checked)}
                />
                含已过滤
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {problems.length === 0 ? (
                <div className="mt-8 text-center text-[0.85em] text-muted">
                  {task ? "暂无问题单，等待智能体分析结果…" : "先在上方创建静态分析任务"}
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {problems.map((problem) => {
                    const key = problem.problemId;
                    const expanded = expandedSet.has(key);
                    const isFocused = focusProblemKey === `${task?.taskId}::${problem.problemId}`;
                    const sheet = problem.problem_sheet;
                    return (
                      <div
                        key={key}
                        className={`rounded border p-1.5 ${
                          isFocused
                            ? "border-primary/60 bg-primary/5"
                            : "border-[color:var(--border)] bg-foreground/[0.02]"
                        }`}
                      >
                        <button
                          type="button"
                          className="flex w-full items-start gap-1.5 text-left"
                          onClick={() => toggleExpanded(key)}
                        >
                          <span className={`shrink-0 rounded px-1 py-px text-[0.7em] font-semibold ${RULE_TYPE_TAG_CLASS[problem.rule_type ?? ""] ?? RULE_TYPE_TAG_FALLBACK}`}>
                            {problem.rule_type?.toUpperCase() ?? "GJB"}
                          </span>
                          <span className={`shrink-0 rounded px-1 py-px text-[0.7em] font-semibold ${SEVERITY_TAG_CLASS[problem.issue_level] ?? SEVERITY_TAG_FALLBACK}`}>
                            {problem.issue_level}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[0.85em] text-foreground">
                            <span className="font-semibold">{problem.issue_name}</span>
                            <span className="ml-1.5 text-muted">
                              {problem.rule_code} · {problem.issue_file}
                              {problem.issue_line ? `:${problem.issue_line}` : ""}
                            </span>
                          </span>
                          <span className={`shrink-0 rounded px-1 py-px text-[0.7em] ${problem.problem_status === 3 ? "bg-success-500/10 text-success-600" : problem.problem_status === 2 ? "bg-danger-500/10 text-danger-500" : "bg-foreground/5 text-muted"}`}>
                            {PROBLEM_STATUS_LABELS[problem.problem_status] ?? "新发现"}
                          </span>
                        </button>
                        {expanded ? (
                          <div className="mt-1 flex flex-col gap-1 border-t border-[color:var(--border)] pt-1">
                            {sheet ? (
                              <div className="whitespace-pre-wrap break-words text-[0.8em] leading-relaxed text-foreground/90">
                                {sheet.four_part_description}
                              </div>
                            ) : (
                              <div className="whitespace-pre-wrap break-words text-[0.8em] leading-relaxed text-foreground/90">
                                {problem.issue_description || problem.description_issue}
                              </div>
                            )}
                            {sheet?.test_unit_opinion ? (
                              <div className="whitespace-pre-wrap break-words rounded bg-warning-500/5 px-1.5 py-1 text-[0.8em] text-warning-600">
                                {sheet.test_unit_opinion}
                              </div>
                            ) : null}
                            <div className="flex flex-wrap items-center gap-1">
                              {PROBLEM_STATUS_LABELS.map((label, idx) => (
                                <button
                                  key={label}
                                  type="button"
                                  onClick={() =>
                                    useStaticAnalysisStore.getState().setProblemStatus(projectId, task?.taskId ?? "", problem.problemId, idx)
                                  }
                                  className={`rounded px-1.5 py-0.5 text-[0.75em] ${
                                    problem.problem_status === idx
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-foreground/5 text-muted hover:text-foreground"
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                              <button
                                type="button"
                                className="ml-auto flex items-center gap-1 rounded bg-foreground/5 px-1.5 py-0.5 text-[0.75em] text-muted hover:text-foreground"
                                onClick={() => locateProblem(projectId, problem)}
                              >
                                <Code className="size-3" /> 定位代码
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 右栏：代码视图 */}
          {codeViewOpen ? (
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-1 border-b border-[color:var(--border)] px-2 py-1.5">
                <FileCode2 className="size-3.5 text-muted" />
                <span className="truncate text-[0.85em] text-foreground">
                  {activeFile?.file_path ?? "未选择文件"}
                </span>
                <span className="ml-auto text-[0.75em] text-muted">
                  问题 {activeProblems.length} 处
                </span>
              </div>
              <div
                role="button"
                tabIndex={-1}
                className="min-h-0 flex-1 overflow-auto bg-[#1e1e1e]"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest(".cr-sa-line")) return;
                  setFocusProblemKey(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setFocusProblemKey(null);
                }}
              >
                {activeFile ? (
                  <CodeLines
                    text={activeFile.source_code || ""}
                    filePath={activeFile.file_path}
                    problemLines={problemLines}
                  />
                ) : (
                  <div className="mt-8 text-center text-[0.85em] text-muted">选择左侧文件查看源码</div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
