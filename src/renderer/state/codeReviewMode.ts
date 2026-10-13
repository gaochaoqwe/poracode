import { useAppStore } from "@/renderer/state/appStore";
import { useScenarioInputsStore } from "@/renderer/state/scenarioInputsStore";
import { scenarioById } from "@/renderer/scenarios/catalog";
import {
  hasReferenceCodeSelection,
  resolveScenarioOutputMode,
} from "@/renderer/scenarios/scenarioOutputModes";
import type { ReviewMode } from "./codeReviewReport";

/**
 * 代码审查的三种「审查模式」，与场景 `outputModes` 的 id 同集合
 * （function / chain / feature）。左侧栏的标题、问题单概述区块的标题、以及
 * 是否启用「四栏」布局都以它为准。
 */
export const REVIEW_MODE_LABELS: Record<ReviewMode, string> = {
  function: "函数审查",
  chain: "链路审查",
  feature: "功能审查",
};

/**
 * 四栏布局的左侧栏标题（对齐源项目 requirement_extractor）：
 * 链路审查是「功能模块列表」，功能审查是「功能列表」，函数审查保持三栏、无此栏。
 */
export const REVIEW_MODE_MODULE_TITLE: Record<ReviewMode, string> = {
  function: "",
  chain: "功能模块列表",
  feature: "功能列表",
};

/** 代码结构树（第二栏）的标题，按模式对齐源项目。 */
export const REVIEW_MODE_TREE_TITLE: Record<ReviewMode, string> = {
  function: "代码结构",
  chain: "代码目录树",
  feature: "目录结构树",
};

/** 问题单上方概述区块的标题，按模式切换（源项目链路审查即「功能介绍」）。 */
export const REVIEW_MODE_OVERVIEW_TITLE: Record<ReviewMode, string> = {
  function: "函数功能概述",
  chain: "链路功能概述",
  feature: "功能概述",
};

/**
 * 第四栏顶部「功能介绍」区块的标题（对齐源项目链路审查四栏布局的
 * `feature-info-section`）。选中某个功能模块时展示该模块 `description`。
 */
export const FEATURE_DESCRIPTION_TITLE = "功能介绍";

/** 第二栏目录树的两个标签页（对齐源项目链路审查的「目录 / 调用关系」）。 */
export const REVIEW_TREE_TABS = ["目录", "调用关系"] as const;
export type ReviewTreeTab = (typeof REVIEW_TREE_TABS)[number];

/**
 * 功能模块状态 → 文案 + 配色（对齐源项目功能列表的状态标签：
 * 待审查 / 审查中 / 已完成 / 失败）。
 */
export function featureStatusMeta(status: string): {
  label: string;
  className: string;
} {
  if (status === "done" || status === "completed") return { label: "已完成", className: "text-success" };
  if (status === "running" || status === "reviewing") return { label: "审查中", className: "text-accent" };
  if (status === "failed" || status === "error") return { label: "失败", className: "text-danger" };
  if (status === "paused") return { label: "已暂停", className: "text-warning" };
  return { label: "待审查", className: "text-muted" };
}

/** 场景 output-mode id → 审查模式；非三者之一（含回归 / 未设置）返回 null。 */
export function asReviewMode(modeId: string | null | undefined): ReviewMode | null {
  return modeId === "function" || modeId === "chain" || modeId === "feature" ? modeId : null;
}

/**
 * 当前项目的审查模式 —— 取「场景里选定的审查模式」（代码审查场景的 output mode）。
 *
 * 与起草区那个模式选择器**同源同解析**（`resolveScenarioOutputMode`），所以审查面板
 * 里显示出来的模式永远和用户在起草区看到的一致。非代码审查场景（或解析不出）返回 null。
 */
export function resolveReviewMode(input: {
  scenarioId: string | null | undefined;
  storedOutputMode: string | null | undefined;
  codeSelections: Readonly<Record<string, { dir: string } | undefined>> | undefined;
}): ReviewMode | null {
  const scenario = input.scenarioId ? scenarioById(input.scenarioId) : undefined;
  if (!scenario) return null;
  const hasReferenceCode = hasReferenceCodeSelection(scenario, input.codeSelections);
  return asReviewMode(
    resolveScenarioOutputMode(scenario, input.storedOutputMode ?? undefined, hasReferenceCode),
  );
}

/** React hook：订阅「场景 + 选定模式」，派生当前审查模式。 */
export function useReviewMode(projectId: string | null | undefined): ReviewMode | null {
  const scenarioId = useAppStore((s) =>
    projectId ? s.activeScenarioByProject[projectId] : undefined,
  );
  const storedOutputMode = useScenarioInputsStore((s) =>
    projectId ? s.outputModeByProject[projectId] : undefined,
  );
  const codeSelections = useScenarioInputsStore((s) =>
    projectId ? s.byProject[projectId] : undefined,
  );
  return resolveReviewMode({ scenarioId, storedOutputMode, codeSelections });
}
