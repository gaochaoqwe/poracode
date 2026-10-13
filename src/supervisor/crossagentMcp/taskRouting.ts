/**
 * P2-10 — task-source routing for the chief steward inbox.
 *
 * Three incoming task sources land on the steward's desk:
 *   - OA / jprjcp intranet pages (read through the user's signed-in Chrome)
 *   - mxt desktop chat (read through computer-use)
 *   - the boss talking directly
 *
 * This module only proposes a routing SUGGESTION. The steward stays the single
 * decision point: it reads the suggestion, then dispatches through the existing
 * dispatch_team_task when it chooses.
 *
 * Workspace ids below are the team's org conventions (org-test-lead / org-oa);
 * the returned value is advisory — the caller maps it onto whichever workspace
 * actually exists in shared settings.
 */

export type RoutedWorkspaceId = "org-test-lead" | "org-oa";

export interface TaskRouteSuggestion {
  targetWorkspaceId: RoutedWorkspaceId | null;
  matchedKeywords: string[];
  /** Set when targetWorkspaceId is null — the steward should ask for clarification. */
  needsClarification: boolean;
}

/** Test-line vocabulary: projects, pipelines, the Excel workbook lifecycle. */
export const TEST_KEYWORDS = [
  "测试",
  "项目",
  "流水线",
  "用例",
  "需求分析",
  "策划",
  "报告",
  "测评",
] as const;

/** OA-line vocabulary: 机关材料 + units. */
export const OA_KEYWORDS = [
  "OA",
  "上报",
  "材料",
  "部办",
  "中心",
  "质量部",
  "公会",
  "团委",
  "创新部",
  "汇报",
  "公文",
  "jprjcp",
] as const;

/**
 * Route by source semantics. Priority:
 *   - empty / whitespace text → null (ask the steward to clarify)
 *   - an explicit source prefix ("OA:", "上报:", "jprjcp:") wins outright
 *   - otherwise the test line is judged first (its vocabulary is narrower and
 *     more specific — a "项目报告" lands on the test lead; an "OA 报告" would
 *     carry an explicit OA prefix above)
 *   - nothing matched → null (ask)
 */
export function routeTaskBySource(text: string): TaskRouteSuggestion {
  if (!text || !text.trim()) {
    return { targetWorkspaceId: null, matchedKeywords: [], needsClarification: true };
  }

  const normalized = text.trim();

  const oaPrefix = /^(OA|上报|jprjcp|OA\s*[:：])/i.test(normalized) ? "OA" : null;
  const testPrefixMatch = normalized.match(/^(测试|流水线)/);
  const testPrefix = testPrefixMatch ? testPrefixMatch[0] : null;
  if (oaPrefix && !testPrefix) {
    return {
      targetWorkspaceId: "org-oa",
      matchedKeywords: [oaPrefix],
      needsClarification: false,
    };
  }
  if (testPrefix && !oaPrefix) {
    return {
      targetWorkspaceId: "org-test-lead",
      matchedKeywords: [testPrefix],
      needsClarification: false,
    };
  }

  const testHits = TEST_KEYWORDS.filter((keyword) => normalized.includes(keyword));
  const oaHits = OA_KEYWORDS.filter((keyword) => normalized.includes(keyword));

  // Tie-break: explicit prefix case handled above. Without a prefix, test-line
  // wins when it has at least one hit — its vocabulary is more specific.
  if (testHits.length > 0) {
    return {
      targetWorkspaceId: "org-test-lead",
      matchedKeywords: [...testHits, ...oaHits],
      needsClarification: false,
    };
  }
  if (oaHits.length > 0) {
    return {
      targetWorkspaceId: "org-oa",
      matchedKeywords: oaHits,
      needsClarification: false,
    };
  }
  return { targetWorkspaceId: null, matchedKeywords: [], needsClarification: true };
}
