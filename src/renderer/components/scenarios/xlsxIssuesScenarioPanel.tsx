import type { ReactNode } from "react";
import { ListChecks } from "lucide-react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ProjectLocation } from "@/shared/contracts";
import { AnimatedFraction } from "@/renderer/components/common/AnimatedNumber";
import { ThreadDockHeader, ThreadDockRow } from "@/renderer/components/thread/ThreadDockUI";
import type { TranslateFn } from "@/renderer/i18n/i18n";
import type {
  ScenarioPanelDefinition,
  ScenarioPanelProps,
} from "@/renderer/scenarios/scenarioPanelTypes";
import type { XlsxIssuesAttentionStatus } from "@/renderer/state/xlsxIssuesSummary";
import {
  useXlsxIssuesSummary,
  useXlsxIssuesSummaryPoll,
} from "@/renderer/state/xlsxIssuesSummaryStore";

/**
 * Availability for the issue-fix scenario panel: the project has a summary the
 * skill wrote. The hook also owns the polling subscription so the panel is live
 * even before the user opens the tab. Named `use*` so the registry can call it
 * as a hook.
 */
export function useXlsxIssuesScenarioPanelAvailable(
  projectId: string | undefined,
  projectLocation: ProjectLocation | undefined,
): boolean {
  useXlsxIssuesSummaryPoll(projectId, projectLocation);
  return useXlsxIssuesSummary(projectId) !== null;
}

function attentionLabel(status: XlsxIssuesAttentionStatus, t: TranslateFn): string {
  switch (status) {
    case "needs-review":
      return t(msg`Needs review`);
    case "failed":
      return t(msg`Failed`);
    case "skipped":
      return t(msg`Skipped`);
  }
}

function attentionColor(status: XlsxIssuesAttentionStatus): string {
  switch (status) {
    case "needs-review":
      return "text-warning";
    case "failed":
      return "text-danger-500";
    case "skipped":
      return "text-muted";
  }
}

/**
 * Right-panel body for the `fix-coding-rule-issues` scenario: overall progress,
 * per-rule done/total, and the rows flagged for a human. Data comes from the
 * skill's `summary.json` (see `xlsxIssuesSummaryStore`); nothing renders until
 * that file exists with at least one issue.
 */
export function XlsxIssuesScenarioPanel({ projectId }: ScenarioPanelProps) {
  const { t } = useLingui();
  const summary = useXlsxIssuesSummary(projectId);
  if (!summary || summary.total <= 0) return null;

  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      <ThreadDockHeader
        icon={ListChecks}
        title={t`Issue fixes`}
        countLabel={<AnimatedFraction value={summary.done} total={summary.total} />}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2 [scrollbar-gutter:stable]">
        {summary.sheet ? (
          <div className="truncate px-2 pb-1 text-muted">{summary.sheet}</div>
        ) : null}
        <SectionTitle>{t`Progress`}</SectionTitle>
        <ul className="space-y-px">
          {summary.byRule.map((entry) => (
            <ThreadDockRow key={entry.rule} isDone={entry.done >= entry.total} title={entry.rule}>
              <span className="min-w-0 flex-1 truncate leading-5 text-foreground">
                {entry.rule}
              </span>
              <span className="shrink-0 text-foreground-muted [font-variant-numeric:tabular-nums]">
                {entry.done}/{entry.total}
              </span>
            </ThreadDockRow>
          ))}
        </ul>
        {summary.attention.length > 0 ? (
          <>
            <SectionTitle>{t`Needs review`}</SectionTitle>
            <ul className="space-y-px">
              {summary.attention.map((item) => (
                <ThreadDockRow
                  key={`${item.status}:${item.row}`}
                  {...(item.note ? { title: item.note } : {})}
                >
                  <span className={`shrink-0 font-medium ${attentionColor(item.status)}`}>
                    {attentionLabel(item.status, t)}
                  </span>
                  <span className="min-w-0 flex-1 truncate leading-5 text-foreground">
                    {item.rule} <span className="text-muted">#{item.row}</span>
                  </span>
                  {item.file ? (
                    <span className="shrink-0 max-w-[45%] truncate text-foreground-muted">
                      {item.file}
                    </span>
                  ) : null}
                </ThreadDockRow>
              ))}
            </ul>
            {summary.attentionTotal > summary.attention.length ? (
              <div className="px-2 pt-1 text-muted">
                <Trans>
                  Showing first {summary.attention.length} of {summary.attentionTotal}
                </Trans>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pt-2 pb-1 font-semibold uppercase tracking-wide text-muted">
      {children}
    </div>
  );
}

export const XLSX_ISSUES_SCENARIO_PANEL: ScenarioPanelDefinition = {
  id: "xlsx-issues",
  label: msg`Issue fixes`,
  icon: ListChecks,
  Component: XlsxIssuesScenarioPanel,
};
