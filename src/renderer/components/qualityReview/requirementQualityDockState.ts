import { assistantDisplayText } from "@/shared/assistantMessageText";
import {
  issueFingerprint,
  parseRequirementQualityReport,
  type RequirementQualityDecision,
  type RequirementQualityIssue,
  type RequirementQualityIssueType,
  type RequirementQualityReport,
  type RequirementQualitySeverity,
  type RequirementQualityStatus,
} from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import type { AppStoreState } from "@/renderer/state/slices/shared";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { currentProviderItemStart } from "@/renderer/components/thread/threadProviderEra";
import { SEVERITY_RANK } from "./issueCatalog";

export interface RequirementQualityDockState {
  /** Assistant item the report was parsed from (identity for re-derivation). */
  sourceItemId: string;
  report: RequirementQualityReport;
}

export type DecisionsByFingerprint = Record<string, RequirementQualityDecision>;

const dockStateCache = new Map<
  string,
  {
    itemIds: readonly string[] | undefined;
    lastAssistantItem: RuntimeChatItem | undefined;
    result: RequirementQualityDockState | null;
  }
>();

/**
 * The live requirement-quality report for a thread: the newest provider-era
 * assistant message whose displayed text ends with a valid report fence.
 *
 * Cached on the thread's item-id list plus the last assistant item's identity,
 * so per-token streaming deltas re-parse cheaply and unchanged threads hit the
 * cache — the same shape as `selectThreadTodoDockState`.
 */
export function selectRequirementQualityDockState(
  state: AppStoreState,
  threadId: string,
): RequirementQualityDockState | null {
  const itemIds = state.runtimeItemIdsByThread[threadId];
  const itemsById = state.runtimeItemsByIdByThread[threadId];
  const lastAssistantItem = selectLastAssistantItem(itemIds, itemsById);
  const cached = dockStateCache.get(threadId);
  if (cached && cached.itemIds === itemIds && cached.lastAssistantItem === lastAssistantItem) {
    return cached.result;
  }
  const result = deriveRequirementQualityDockState(itemIds, itemsById);
  if (dockStateCache.size > 200) dockStateCache.clear();
  dockStateCache.set(threadId, { itemIds, lastAssistantItem, result });
  return result;
}

export function useRequirementQualityDockState(threadId: string): RequirementQualityDockState | null {
  return useAppStore((state) => selectRequirementQualityDockState(state, threadId));
}

function selectLastAssistantItem(
  itemIds: readonly string[] | undefined,
  itemsById: AppStoreState["runtimeItemsByIdByThread"][string] | undefined,
): RuntimeChatItem | undefined {
  if (!itemIds?.length) return undefined;
  const start = currentProviderItemStart(itemIds, itemsById);
  for (let index = itemIds.length - 1; index >= start; index -= 1) {
    const item = itemsById?.[itemIds[index]!];
    if (item?.type === "assistant_message") return item;
  }
  return undefined;
}

function deriveRequirementQualityDockState(
  itemIds: readonly string[] | undefined,
  itemsById: AppStoreState["runtimeItemsByIdByThread"][string] | undefined,
): RequirementQualityDockState | null {
  if (!itemIds?.length) return null;
  const start = currentProviderItemStart(itemIds, itemsById);
  for (let index = itemIds.length - 1; index >= start; index -= 1) {
    const item = itemsById?.[itemIds[index]!];
    if (!item || item.type !== "assistant_message") continue;
    const report = parseRequirementQualityReport(assistantDisplayText(item));
    if (report) return { sourceItemId: item.id, report };
  }
  return null;
}

export interface RequirementQualityFilters {
  severity: RequirementQualitySeverity | "all";
  type: RequirementQualityIssueType | "all";
  status: RequirementQualityStatus | "all";
  section: string | "all";
}

export const DEFAULT_REQUIREMENT_QUALITY_FILTERS: RequirementQualityFilters = {
  severity: "all",
  type: "all",
  status: "all",
  section: "all",
};

/** The disposition of an issue: the recorded decision, else `open`. */
export function statusOfIssue(
  decisions: DecisionsByFingerprint | undefined,
  issue: RequirementQualityIssue,
): RequirementQualityStatus {
  return decisions?.[issueFingerprint(issue)]?.status ?? "open";
}

/** Distinct sections present, in first-seen order (empty string groups the rest). */
export function requirementQualitySections(issues: readonly RequirementQualityIssue[]): string[] {
  const seen = new Set<string>();
  for (const issue of issues) {
    const section = issue.source.section ?? "";
    if (section) seen.add(section);
  }
  return [...seen];
}

/** Stable order: severity (high first), then file, section, id. */
export function sortRequirementQualityIssues(
  issues: readonly RequirementQualityIssue[],
): RequirementQualityIssue[] {
  return [...issues].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    const byFile = a.source.file.localeCompare(b.source.file);
    if (byFile !== 0) return byFile;
    const bySection = (a.source.section ?? "").localeCompare(b.source.section ?? "");
    if (bySection !== 0) return bySection;
    return a.id.localeCompare(b.id);
  });
}

export function filterRequirementQualityIssues(
  issues: readonly RequirementQualityIssue[],
  filters: RequirementQualityFilters,
  decisions: DecisionsByFingerprint | undefined,
): RequirementQualityIssue[] {
  return issues.filter((issue) => {
    if (filters.severity !== "all" && issue.severity !== filters.severity) return false;
    if (filters.type !== "all" && issue.type !== filters.type) return false;
    if (filters.section !== "all" && (issue.source.section ?? "") !== filters.section) return false;
    if (filters.status !== "all" && statusOfIssue(decisions, issue) !== filters.status) return false;
    return true;
  });
}
