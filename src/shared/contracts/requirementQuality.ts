import { z } from "zod";

/**
 * The fixed catalog of requirement-quality checks (REQ-AGENT-QA-001). The set is
 * deliberately closed: the review skill and the review panel both read these
 * ids, and a sync test pins the skill's `references/check-catalog.json` to this
 * list, so the agent can never drift into inventing its own problem types.
 *
 * Ids only — the localized labels/descriptions live in the renderer, mirroring
 * the {@link ScenarioDefinition} split (shared holds ids, Lingui holds copy).
 */
export const REQUIREMENT_QUALITY_ISSUE_TYPES = [
  // Item-level expression completeness.
  "ambiguity",
  "incompleteness",
  // Item-level metric verifiability.
  "unverifiable",
  "missing-metric",
  // Item-level source reference.
  "missing-source",
  // Cross-item consistency.
  "duplication",
  "conflict",
  "metric-value-conflict",
  "term-inconsistency",
  "interface-field-inconsistency",
] as const;
export const requirementQualityIssueTypeSchema = z.enum(REQUIREMENT_QUALITY_ISSUE_TYPES);
export type RequirementQualityIssueType = z.infer<typeof requirementQualityIssueTypeSchema>;

/** Whether a check looks at a single item or across items. */
export const REQUIREMENT_QUALITY_SCOPES = ["item", "cross"] as const;
export const requirementQualityScopeSchema = z.enum(REQUIREMENT_QUALITY_SCOPES);
export type RequirementQualityScope = z.infer<typeof requirementQualityScopeSchema>;

export const REQUIREMENT_QUALITY_SEVERITIES = ["high", "medium", "low"] as const;
export const requirementQualitySeveritySchema = z.enum(REQUIREMENT_QUALITY_SEVERITIES);
export type RequirementQualitySeverity = z.infer<typeof requirementQualitySeveritySchema>;

/**
 * A user's disposition of one issue. `open` is the implicit state for an issue
 * with no recorded decision; the store only ever persists the other three, so a
 * re-run never resurrects a decided issue as open.
 */
export const REQUIREMENT_QUALITY_STATUSES = ["open", "confirmed", "revised", "rejected"] as const;
export const requirementQualityStatusSchema = z.enum(REQUIREMENT_QUALITY_STATUSES);
export type RequirementQualityStatus = z.infer<typeof requirementQualityStatusSchema>;

/** Marks a report so the parser never mistakes an unrelated fence for one. */
export const REQUIREMENT_QUALITY_REPORT_KIND = "requirement-quality-report";
/**
 * Bump when the report shape changes incompatibly. Mirrored by the skill's
 * `references/issue-schema.json`; an unknown version fails validation and the
 * report is ignored rather than mis-read.
 */
export const REQUIREMENT_QUALITY_REPORT_VERSION = 1;

/** Where an issue was found: a stable-enough anchor for the user to jump to. */
export const requirementQualityIssueSourceSchema = z.object({
  /** Project-relative path of the requirement document. */
  file: z.string().min(1),
  /** Section or heading the item sits under. */
  section: z.string().min(1).optional(),
  /** Quoted fragment or line hint within the section. */
  anchor: z.string().min(1).optional(),
  /** The structured requirement item id, when the source carries one. */
  itemId: z.string().min(1).optional(),
});
export type RequirementQualityIssueSource = z.infer<typeof requirementQualityIssueSourceSchema>;

export const requirementQualityIssueSchema = z.object({
  /**
   * Agent-supplied handle, display-only. Deliberately NOT part of
   * {@link issueFingerprint}: a re-run assigns a fresh id, and keying decisions
   * on it would orphan every confirmed issue.
   */
  id: z.string().min(1),
  source: requirementQualityIssueSourceSchema,
  type: requirementQualityIssueTypeSchema,
  scope: requirementQualityScopeSchema,
  severity: requirementQualitySeveritySchema,
  /** Other requirement items this issue relates to (duplication/conflict/etc.). */
  relatedItemIds: z.array(z.string()).default([]),
  summary: z.string().min(1),
  /** Suggested direction of handling — never a verdict. */
  suggestion: z.string().min(1),
});
export type RequirementQualityIssue = z.infer<typeof requirementQualityIssueSchema>;

export const requirementQualityReportSchema = z.object({
  kind: z.literal(REQUIREMENT_QUALITY_REPORT_KIND),
  version: z.literal(REQUIREMENT_QUALITY_REPORT_VERSION),
  scope: z
    .object({
      project: z.string().min(1).optional(),
      /** Documents the review covered, project-relative. */
      documents: z.array(z.string()).optional(),
    })
    .optional(),
  issues: z.array(requirementQualityIssueSchema),
});
export type RequirementQualityReport = z.infer<typeof requirementQualityReportSchema>;

/** A persisted user decision for one issue, addressed by {@link issueFingerprint}. */
export const requirementQualityDecisionSchema = z.object({
  status: requirementQualityStatusSchema,
  /** Free-text note the user attaches when revising or rejecting. */
  note: z.string().optional(),
  /** ISO timestamp of the decision. */
  updatedAt: z.string().min(1),
});
export type RequirementQualityDecision = z.infer<typeof requirementQualityDecisionSchema>;

/**
 * Matches a single closed ```json fence. The `?` after the body is lazy, so the
 * first closing ``` ends the match; a still-streaming unterminated fence has no
 * closer and therefore does not match — the parser returns `null` until the
 * block settles rather than parsing a half-written payload.
 */
const FENCED_JSON_PATTERN = /```[ \t]*json[ \t]*\r?\n([\s\S]*?)```/giu;

/**
 * Parse a raw JSON body (no fences) as a report, or `null` when it is not one.
 * Exported so the markdown `pre` override can decide whether a fenced block is
 * one of our reports — the same validation the message parser uses.
 */
export function parseRequirementQualityReportJson(body: string): RequirementQualityReport | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  // Cheap gate before the full parse: only our own reports pass.
  if ((value as { kind?: unknown }).kind !== REQUIREMENT_QUALITY_REPORT_KIND) return null;
  const result = requirementQualityReportSchema.safeParse(value);
  return result.success ? result.data : null;
}

/**
 * Extract the requirement-quality report from assistant text: the LAST closed
 * ```json fence whose payload carries our `kind` and validates. Scanning every
 * fence (rather than a single anchored match) tolerates other code blocks in
 * the reply; taking the last one means a refined re-emission supersedes an
 * earlier draft. Returns `null` when no valid report is present.
 */
export function parseRequirementQualityReport(text: string): RequirementQualityReport | null {
  let found: RequirementQualityReport | null = null;
  FENCED_JSON_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCED_JSON_PATTERN.exec(text)) !== null) {
    const parsed = parseRequirementQualityReportJson(match[1] ?? "");
    if (parsed) found = parsed;
  }
  return found;
}

/** Trim, collapse internal whitespace, and case-fold a locator segment. */
function normalizeLocatorSegment(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

/** The most specific stable locator an issue carries. */
export function requirementQualityIssueLocator(
  issue: Pick<RequirementQualityIssue, "source">,
): string {
  const { source } = issue;
  if (source.itemId) return normalizeLocatorSegment(source.itemId);
  return [source.file, source.section ?? "", source.anchor ?? ""]
    .map(normalizeLocatorSegment)
    .join("#");
}

/**
 * A stable identity for an issue across re-runs, used to key the decision store
 * so a later review never overwrites a decision the user already made.
 *
 * Built from `type + scope + locator` only. `id`, `summary`, and `suggestion`
 * are excluded because the agent paraphrases them between runs; `severity` is
 * excluded because it wobbles; `relatedItemIds` is excluded for the same
 * reason. (This is a deliberate narrowing of the "related items as tiebreaker"
 * idea — including a volatile field would orphan decisions.) Distinct issues
 * must therefore carry distinct locators; the skill instructs the agent to keep
 * locators stable.
 */
export function issueFingerprint(
  issue: Pick<RequirementQualityIssue, "type" | "scope" | "source">,
): string {
  return [issue.type, issue.scope, requirementQualityIssueLocator(issue)].join("|");
}
