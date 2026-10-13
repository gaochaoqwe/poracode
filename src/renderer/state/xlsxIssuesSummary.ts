/**
 * Progress projection written by the `xlsx-issues` skill's `manifest.py` to
 * `<project>/.agentemployee/xlsx-issues/summary.json`, read by the issue-progress
 * scenario panel. The app only reads it; the skill scripts own the format.
 *
 * Parsing is intentionally tolerant: the file is produced by an external
 * script and may gain fields, so unknown/extra fields are ignored and a bad or
 * missing document yields `null` (the panel simply hides) rather than throwing.
 */

export const XLSX_ISSUES_SUMMARY_PATH = ".agentemployee/xlsx-issues/summary.json";

/** Current schema the app understands; the reader tolerates other values. */
export const XLSX_ISSUES_SUMMARY_SCHEMA_VERSION = 1;

export interface XlsxIssuesRuleProgress {
  rule: string;
  total: number;
  done: number;
  pending: number;
}

/** A row the run could not resolve on its own and a human should look at. */
export type XlsxIssuesAttentionStatus = "needs-review" | "failed" | "skipped";

export interface XlsxIssuesAttentionItem {
  row: number;
  rule: string;
  file: string | null;
  status: XlsxIssuesAttentionStatus;
  note: string | null;
}

export interface XlsxIssuesSummary {
  schemaVersion: number;
  sheet: string | null;
  total: number;
  done: number;
  byStatus: Readonly<Record<string, number>>;
  byRule: readonly XlsxIssuesRuleProgress[];
  /** Capped list of rows needing attention; `attentionTotal` is the full count. */
  attention: readonly XlsxIssuesAttentionItem[];
  attentionTotal: number;
}

const ATTENTION_STATUSES: ReadonlySet<string> = new Set(["needs-review", "failed", "skipped"]);
/** Read-side cap so a corrupt summary can't blow up the panel. */
const ATTENTION_READ_LIMIT = 200;

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseRuleProgress(value: unknown): XlsxIssuesRuleProgress | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const total = asNumber(record.total);
  if (total <= 0) return null;
  const rule =
    typeof record.rule === "string" && record.rule.trim().length > 0 ? record.rule : "(unknown)";
  return { rule, total, done: asNumber(record.done), pending: asNumber(record.pending) };
}

function parseAttentionItem(value: unknown): XlsxIssuesAttentionItem | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const status = typeof record.status === "string" ? record.status : "";
  if (!ATTENTION_STATUSES.has(status)) return null;
  if (typeof record.row !== "number" || !Number.isFinite(record.row)) return null;
  const rule =
    typeof record.rule === "string" && record.rule.trim().length > 0 ? record.rule : "(unknown)";
  return {
    row: record.row,
    rule,
    file: typeof record.file === "string" ? record.file : null,
    status: status as XlsxIssuesAttentionStatus,
    note: typeof record.note === "string" ? record.note : null,
  };
}

export function parseXlsxIssuesSummary(text: string | null | undefined): XlsxIssuesSummary | null {
  if (typeof text !== "string" || text.trim().length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const byRule = Array.isArray(record.byRule)
    ? record.byRule
        .map(parseRuleProgress)
        .filter((entry): entry is XlsxIssuesRuleProgress => entry !== null)
    : [];

  const total = asNumber(record.total) || byRule.reduce((sum, entry) => sum + entry.total, 0);
  // No rows at all means there is nothing to show; treat as absent.
  if (total <= 0 && byRule.length === 0) return null;

  const byStatus: Record<string, number> = {};
  if (record.byStatus && typeof record.byStatus === "object") {
    for (const [key, value] of Object.entries(record.byStatus as Record<string, unknown>)) {
      byStatus[key] = asNumber(value);
    }
  }

  const attention = Array.isArray(record.attention)
    ? record.attention
        .map(parseAttentionItem)
        .filter((entry): entry is XlsxIssuesAttentionItem => entry !== null)
        .slice(0, ATTENTION_READ_LIMIT)
    : [];
  const attentionTotal = Math.max(asNumber(record.attentionTotal), attention.length);

  return {
    schemaVersion: asNumber(record.schemaVersion) || XLSX_ISSUES_SUMMARY_SCHEMA_VERSION,
    sheet: typeof record.sheet === "string" ? record.sheet : null,
    total,
    done: asNumber(record.done),
    byStatus,
    byRule,
    attention,
    attentionTotal,
  };
}
