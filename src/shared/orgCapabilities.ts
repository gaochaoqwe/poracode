/**
 * P2-12 — system capability registry.
 *
 * The single source of truth for what the system can actually do. Role
 * capability configuration (settings panel checkboxes) and the orgflow graph
 * both read this list. `implemented` flags whether the capability is live in
 * code today — unimplemented ids stay in the catalog so a role config can show
 * "not available" honestly instead of failing silently.
 *
 * Provider-agnostic: these are capability names, never provider names or kind
 * branches. No i18n here (shared module) — renderer display mapping is handled
 * by the i18n pass.
 */

export interface OrgCapability {
  id: string;
  label: string;
  implemented: boolean;
  description?: string;
}

function capability(
  id: string,
  label: string,
  implemented: boolean,
  description?: string,
): OrgCapability {
  return { id, label, implemented, ...(description ? { description } : {}) };
}

export const ORG_CAPABILITIES: readonly OrgCapability[] = [
  // ── Implemented (live in code today) ──────────────────────────────────────
  capability(
    "doc-generation",
    "Document generation (Word/Excel/PPT/zip)",
    true,
    "officecli: build .docx/.xlsx/.pptx/.zip through the agent thread",
  ),
  capability(
    "pipeline-control",
    "Test pipeline control",
    true,
    "Drive the evaluation-center intranet pipeline, flow only",
  ),
  capability("code-review", "Code review (C/C++)", true),
  capability("static-analysis", "Static analysis (web-tree-sitter)", true),
  capability(
    "chrome-signed-in",
    "Chrome signed-in session",
    true,
    "chrome-tools: reuse the user's logged-in Chrome tabs",
  ),
  capability(
    "browser-isolated",
    "Isolated browser",
    true,
    "browser-tools: AgentEmployee's own browser",
  ),
  capability(
    "desktop-control",
    "Desktop control",
    true,
    "computer-use: operate Windows desktop apps",
  ),
  capability("outlook-email", "Outlook email", true),
  capability(
    "test-workbook",
    "Test workbook (multi-sheet Excel model)",
    true,
    "build_test_workbook: 项目信息表×2/策划表/需求分析表/用例表/问题报告单",
  ),
  capability("test-case-gen", "Test case generation", true, "generate_test_cases"),
  capability("test-result-collect", "Test result aggregation", true, "collect_test_results"),
  capability("doc-form-review", "Document form review", true, "review_document_form"),
  capability("report-draft", "Report draft outline", true, "build_report_draft"),
  capability("pipeline-phase", "Pipeline phase state machine", true, "test_phase_advance"),
  capability("oa-submission", "OA submission package", true, "oa_submission_package"),
  capability("oa-material-skeleton", "OA material skeleton", true, "oa_material_skeleton"),
  capability("task-inbox", "Task inbox delivery", true, "InboxWatcher投递目录"),
  capability("task-poll", "Scheduled task polling", true, "taskPollScheduler: 24h 巡检"),
  capability("inbox-routing", "Inbox task routing", true, "route_inbox_task 分流建议"),
  capability(
    "oa-jprjcp-collect",
    "OA/jprjcp collection",
    true,
    "Read OA and jprjcp intranet pages",
  ),
  capability("mxt-collect", "mxt collection", true, "Read new mxt desktop messages"),
  capability("file-operations", "General file operations", true, "Project-scoped file read/write"),
  capability(
    "approval-gate",
    "Approval gate",
    true,
    "needs_approval human review before risky actions",
  ),

  // ── Unimplemented (in the catalog, shown as "not available") ──────────────
  capability(
    "report-engine-link",
    "Report engine integration",
    false,
    "后台报告生成系统对接（未接，agent 手工触发）",
  ),
  capability(
    "dynamic-test-env",
    "Dynamic test execution environment",
    false,
    "动态测试执行环境（未接）",
  ),
  capability(
    "doc-template-lib",
    "Document template library",
    false,
    "公文模板库 / documentFill 模板资产（未配）",
  ),
  capability(
    "enterprise-knowledge",
    "Enterprise knowledge retrieval",
    false,
    "企业知识检索（未接）",
  ),
  capability("cross-role-handoff", "Cross-role handoff", false, "跨岗位交接流程（未实现）"),
  capability("site-replay-skill", "Site replay skill", false, "现场录制可回放 skill（未实现）"),
];

export const ORG_CAPABILITY_BY_ID: ReadonlyMap<string, OrgCapability> = new Map(
  ORG_CAPABILITIES.map((entry) => [entry.id, entry]),
);

export const KNOWN_CAPABILITY_IDS: readonly string[] = ORG_CAPABILITIES.map((entry) => entry.id);

export const IMPLEMENTED_CAPABILITY_IDS: readonly string[] = ORG_CAPABILITIES.filter(
  (entry) => entry.implemented,
).map((entry) => entry.id);

export const UNIMPLEMENTED_CAPABILITY_IDS: readonly string[] = ORG_CAPABILITIES.filter(
  (entry) => !entry.implemented,
).map((entry) => entry.id);

export function isImplementedCapability(id: string): boolean {
  return ORG_CAPABILITY_BY_ID.get(id)?.implemented === true;
}
