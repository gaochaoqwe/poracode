import { useState } from "react";
import { ChevronDown, ClipboardCheck } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import {
  issueFingerprint,
  type RequirementQualityIssue,
  type RequirementQualityStatus,
} from "@/shared/contracts";
import { Button } from "@/renderer/components/common";
import {
  ThreadDockHeader,
  ThreadDockIconButton,
  ThreadDockList,
  ThreadDockSection,
} from "@/renderer/components/thread/ThreadDockUI";
import { useRequirementQualityStore } from "@/renderer/state/requirementQualityStore";
import {
  ISSUE_TYPE_LABELS,
  ISSUE_TYPE_VALUES,
  SEVERITY_LABELS,
  SEVERITY_VALUES,
  STATUS_LABELS,
  STATUS_VALUES,
} from "./issueCatalog";
import {
  DEFAULT_REQUIREMENT_QUALITY_FILTERS,
  filterRequirementQualityIssues,
  requirementQualitySections,
  sortRequirementQualityIssues,
  statusOfIssue,
  type RequirementQualityDockState,
  type RequirementQualityFilters,
} from "./requirementQualityDockState";

/**
 * The requirement-quality review panel: a thread dock listing every issue the
 * agent reported, sortable by severity and filterable by section/type/status,
 * with per-issue Confirm / Revise / Reject. Decisions are recorded in
 * `requirementQualityStore` and only ever change on an explicit press here — a
 * re-run of the review never overwrites them.
 */
export function RequirementQualityDock(props: {
  threadId: string;
  state: RequirementQualityDockState;
}) {
  const { i18n, t } = useLingui();
  const { threadId, state } = props;
  const decisions = useRequirementQualityStore((store) => store.decisionsByThread[threadId]);
  const setDecision = useRequirementQualityStore((store) => store.setDecision);
  const [collapsed, setCollapsed] = useState(false);
  const [filters, setFilters] = useState<RequirementQualityFilters>(DEFAULT_REQUIREMENT_QUALITY_FILTERS);

  const issues = state.report.issues;
  const sections = requirementQualitySections(issues);
  const visible = sortRequirementQualityIssues(
    filterRequirementQualityIssues(issues, filters, decisions),
  );
  const openCount = issues.filter((issue) => statusOfIssue(decisions, issue) === "open").length;

  const decide = (issue: RequirementQualityIssue, status: RequirementQualityStatus | null) => {
    setDecision(
      threadId,
      issueFingerprint(issue),
      status === null ? null : { status, updatedAt: new Date().toISOString() },
    );
  };

  return (
    <ThreadDockSection
      ariaLabel={t`Requirement review dock`}
      placement="composer"
      collapsed={collapsed}
    >
      <ThreadDockHeader
        icon={ClipboardCheck}
        title={t`Requirement review`}
        countLabel={
          <span>
            {openCount}/{issues.length}
          </span>
        }
        actions={
          <ThreadDockIconButton
            label={collapsed ? t`Expand review dock` : t`Collapse review dock`}
            tooltip={collapsed ? t`Expand` : t`Collapse`}
            onPress={() => setCollapsed(!collapsed)}
          >
            <ChevronDown
              className={`size-3.5 transition-transform ${collapsed ? "-rotate-90" : "rotate-0"}`}
            />
          </ThreadDockIconButton>
        }
      />
      {!collapsed ? (
        <div className="flex flex-col gap-0.5 px-2 pb-1">
          <FilterRow
            label={t`Severity`}
            value={filters.severity}
            onChange={(value) => setFilters({ ...filters, severity: value as RequirementQualityFilters["severity"] })}
            options={[
              { value: "all", label: t`All` },
              ...SEVERITY_VALUES.map((value) => ({ value, label: i18n._(SEVERITY_LABELS[value]) })),
            ]}
          />
          <FilterRow
            label={t`Type`}
            value={filters.type}
            onChange={(value) => setFilters({ ...filters, type: value as RequirementQualityFilters["type"] })}
            options={[
              { value: "all", label: t`All` },
              ...ISSUE_TYPE_VALUES.map((value) => ({ value, label: i18n._(ISSUE_TYPE_LABELS[value]) })),
            ]}
          />
          <FilterRow
            label={t`Status`}
            value={filters.status}
            onChange={(value) => setFilters({ ...filters, status: value as RequirementQualityFilters["status"] })}
            options={[
              { value: "all", label: t`All` },
              ...STATUS_VALUES.map((value) => ({ value, label: i18n._(STATUS_LABELS[value]) })),
            ]}
          />
          {sections.length > 0 ? (
            <FilterRow
              label={t`Section`}
              value={filters.section}
              onChange={(value) => setFilters({ ...filters, section: value })}
              options={[{ value: "all", label: t`All` }, ...sections.map((section) => ({ value: section, label: section }))]}
            />
          ) : null}
        </div>
      ) : null}
      <ThreadDockList placement="composer" collapsed={collapsed} gap="0.5">
        {visible.map((issue) => (
          <IssueRow
            key={issueFingerprint(issue)}
            issue={issue}
            status={statusOfIssue(decisions, issue)}
            onDecide={decide}
          />
        ))}
      </ThreadDockList>
    </ThreadDockSection>
  );
}

function FilterRow(props: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const { label, value, options, onChange } = props;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[0.85em] text-muted">{label}</span>
      {options.map((option) => (
        <Button
          key={option.value}
          size="sm"
          variant={option.value === value ? "secondary" : "ghost"}
          className="h-5 min-w-0 px-1.5 text-[0.85em]"
          onPress={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function IssueRow(props: {
  issue: RequirementQualityIssue;
  status: RequirementQualityStatus;
  onDecide: (issue: RequirementQualityIssue, status: RequirementQualityStatus | null) => void;
}) {
  const { i18n, t } = useLingui();
  const { issue, status, onDecide } = props;
  const locator = [issue.source.file, issue.source.section].filter(Boolean).join(" · ");
  return (
    <li className="rounded px-2 py-1.5 leading-5 hover:bg-foreground/5">
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 shrink-0 rounded px-1 text-[0.8em] ${
            issue.severity === "high" ? "bg-danger-500/15 text-danger-500" : "text-muted"
          }`}
        >
          {i18n._(SEVERITY_LABELS[issue.severity])}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-foreground">{issue.summary}</div>
          <div className="text-[0.85em] text-muted">
            {i18n._(ISSUE_TYPE_LABELS[issue.type])} — {locator}
          </div>
          <div className="text-[0.85em] text-muted">{issue.suggestion}</div>
          {issue.relatedItemIds.length > 0 ? (
            <div className="text-[0.85em] text-muted">
              {t`Related`}: {issue.relatedItemIds.join(", ")}
            </div>
          ) : null}
        </div>
        <span className="shrink-0 text-[0.85em] text-muted">{i18n._(STATUS_LABELS[status])}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[0.85em]" onPress={() => onDecide(issue, "confirmed")}>
          {t`Confirm`}
        </Button>
        <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[0.85em]" onPress={() => onDecide(issue, "revised")}>
          {t`Revise`}
        </Button>
        <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[0.85em]" onPress={() => onDecide(issue, "rejected")}>
          {t`Reject`}
        </Button>
        {status !== "open" ? (
          <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[0.85em]" onPress={() => onDecide(issue, null)}>
            {t`Reset`}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
