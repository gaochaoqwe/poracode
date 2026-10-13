import { Trans, useLingui } from "@lingui/react/macro";
import { Building2 } from "lucide-react";
import type { Project, Thread, ThreadContextUsage, ThreadStatus } from "@/shared/contracts";
import { HOME_PROJECT_ID, isHomeProjectId } from "@/shared/homeScope";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import { WorkspaceIcon } from "@/renderer/components/workspace/WorkspaceIcon";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useActiveWorkspaceId, useWorkspaceStore } from "@/renderer/state/workspaceStore";
import { assignableWorkspaces, roleRankLabel } from "@/renderer/state/workspaceHierarchy";

/** Higher = more attention-worthy; drives the dock badge color. */
const STATUS_PRIORITY: Record<ThreadStatus, number> = {
  error: 6,
  needs_approval: 5,
  working: 4,
  launching: 3,
  needs_reply: 2,
  finished: 1,
  idle: 0,
  inactive: -1,
};

/**
 * The workspace a thread belongs to: Home threads carry their own
 * `workspaceId`; threads in real projects resolve through their project. A
 * thread with no resolvable tag belongs to no role card (its unfiled rule keeps
 * it visible in the sidebar, but it has no employee badge to attach to).
 */
export function threadWorkspaceId(
  thread: { projectId: string; workspaceId?: string | undefined },
  projectById: ReadonlyMap<string, Project>,
): string | undefined {
  if (isHomeProjectId(thread.projectId)) return thread.workspaceId;
  return projectById.get(thread.projectId)?.workspaceId;
}

/** Which threads belong to a role (岗位). */
function roleThreads(
  threads: readonly Thread[],
  projectById: ReadonlyMap<string, Project>,
  workspaceId: string,
): Thread[] {
  return threads.filter((thread) => threadWorkspaceId(thread, projectById) === workspaceId);
}

interface RoleAggregate {
  status: ThreadStatus;
  active: Thread | null;
  context: ThreadContextUsage | undefined;
}

/** Fold a role's threads into the single highest-priority live state. */
export function aggregateRole(
  threads: readonly Thread[],
  projects: readonly Project[],
  workspaceId: string,
  contextByThread: Record<string, ThreadContextUsage>,
): RoleAggregate {
  const projectById = new Map(projects.map((project) => [project.id, project] as const));
  let best: RoleAggregate = {
    status: "inactive",
    active: null,
    context: undefined,
  };
  for (const thread of roleThreads(threads, projectById, workspaceId)) {
    if (STATUS_PRIORITY[thread.status] > STATUS_PRIORITY[best.status]) {
      best = { status: thread.status, active: thread, context: contextByThread[thread.id] };
    }
  }
  return best;
}

/** Resolve the provider kind a role displays (its bound agent, if any). */
function roleKind(workspace: { agentKind?: string | undefined }): string | undefined {
  return workspace.agentKind;
}

/** Clicking a role card: open its live thread, or start a new Home draft. */
export function resolveRoleNavigation(
  agg: RoleAggregate,
): { type: "thread"; threadId: string } | { type: "new-draft" } {
  const isLive =
    agg.status === "working" ||
    agg.status === "launching" ||
    agg.status === "needs_approval" ||
    agg.status === "needs_reply" ||
    agg.status === "error";
  if (isLive && agg.active) return { type: "thread", threadId: agg.active.id };
  return { type: "new-draft" };
}

/**
 * Bottom-of-app employee (岗位) dock. One card per workspace shows its avatar,
 * name, a status badge derived from its threads, its bound model, and a context
 * gauge for the active thread. Clicking a card jumps to that role's active
 * thread (P1-05) — the dock itself only renders; navigation is wired by the
 * host.
 */
export function EmployeeDockBar() {
  const { t } = useLingui();
  const workspaces = useSharedSettings((state) => state.workspaces);
  const threads = useAppStore((state) => state.threads);
  const projects = useAppStore((state) => state.projects);
  const contextByThread = useAppStore((state) => state.runtimeContextByThread);
  const agentStatuses = useAgentStatusesStore((state) => state.agentStatuses);
  const activeWorkspaceId = useActiveWorkspaceId();
  const view = useAppStore((state) => state.view);

  if (workspaces.length === 0) return null;

  // Two-tier hierarchy: only secondary employees (org-*, rank 1/2/3) are
  // assignable cards; primary containers are nav buckets, not roles to dispatch.
  // The selector falls back to the flat list before the seed exists.
  const dockWorkspaces = assignableWorkspaces(workspaces);

  const statusLabel = (status: ThreadStatus): string =>
    status === "working"
      ? t`Working`
      : status === "needs_approval"
        ? t`Needs approval`
        : status === "error"
          ? t`Error`
          : status === "launching"
            ? t`Launching`
            : status === "needs_reply"
              ? t`Needs reply`
              : status === "finished"
                ? t`Finished`
                : t`Idle`;

  return (
    <div
      aria-label="Employee dock"
      className="flex items-center gap-2 border-t border-[var(--hairline)] bg-[var(--surface-secondary)] px-3 py-1.5"
    >
      <button
        type="button"
        aria-label={t`Open office view`}
        title={t`Office`}
        onClick={() => {
          const store = useAppStore.getState();
          const onOfficeTab = store.view.kind === "workbench" && store.view.tab === "office";
          if (onOfficeTab) store.openHome();
          else store.openWorkbench("office");
        }}
        className={`flex shrink-0 items-center rounded border px-2 py-1 transition-colors hover:bg-[var(--surface-hover)] ${
          view.kind === "workbench" && view.tab === "office"
            ? "border-[var(--accent)]/50 bg-[var(--accent)]/5"
            : "border-transparent"
        }`}
      >
        <Building2 className="size-4" />
      </button>
      {dockWorkspaces.map((workspace) => {
        const agg = aggregateRole(threads, projects, workspace.id, contextByThread);
        const kind = roleKind(workspace);
        const statusClass =
          agg.status === "error"
            ? "bg-[var(--danger)]"
            : agg.status === "needs_approval"
              ? "bg-amber-500"
              : agg.status === "working" || agg.status === "launching"
                ? "bg-[var(--accent)]"
                : agg.status === "finished"
                  ? "bg-emerald-500"
                  : "bg-muted";
        const active =
          agg.status === "working" || agg.status === "launching" || agg.status === "needs_approval";
        const isActiveRole = workspace.id === activeWorkspaceId;
        return (
          <button
            key={workspace.id}
            type="button"
            data-role-id={workspace.id}
            onClick={() => {
              const nav = resolveRoleNavigation(agg);
              if (nav.type === "thread") {
                useAppStore.getState().openThread(nav.threadId);
              } else {
                useWorkspaceStore.getState().setActiveWorkspaceId(workspace.id);
                useAppStore.getState().openDraft(HOME_PROJECT_ID);
              }
            }}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2 py-1 text-left transition-colors hover:bg-[var(--surface-hover)] ${
              isActiveRole ? "border-[var(--accent)]/50 bg-[var(--accent)]/5" : "border-transparent"
            }`}
            title={workspace.name}
          >
            <span className="relative shrink-0">
              {kind ? (
                <ProviderIcon kind={kind} className="size-4" />
              ) : (
                <WorkspaceIcon icon={workspace.icon} className="size-4 text-muted" />
              )}
              <span
                aria-hidden="true"
                className={`absolute -right-0.5 -top-0.5 size-1.5 rounded-full ${statusClass} ${
                  active ? "animate-pulse" : ""
                }`}
              />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate text-xs font-medium text-foreground">
                  {workspace.name}
                </span>
                {workspace.roleRank !== undefined ? (
                  <span className="shrink-0 rounded-sm bg-[var(--hairline)] px-1 text-[9px] leading-3 text-muted">
                    {t(roleRankLabel(workspace.roleRank))}
                  </span>
                ) : null}
              </span>
              <RoleModelLine workspace={workspace} agentStatuses={agentStatuses} />
            </span>
            {agg.context?.usedTokens && agg.context.maxTokens ? (
              <span
                aria-hidden="true"
                className="ml-auto h-1 w-10 shrink-0 overflow-hidden rounded-full bg-[var(--hairline)]"
              >
                <span
                  className="block h-full rounded-full bg-[var(--accent)]"
                  style={{
                    width: `${Math.min(100, (agg.context.usedTokens / agg.context.maxTokens) * 100)}%`,
                  }}
                />
              </span>
            ) : null}
            <span className="sr-only">{statusLabel(agg.status)}</span>
          </button>
        );
      })}
      <span className="sr-only">
        <Trans>Employee dock</Trans>
      </span>
    </div>
  );
}

function RoleModelLine(props: {
  workspace: {
    agentKind?: string | undefined;
    defaultThreadConfig?: { model?: string | undefined } | undefined;
  };
  agentStatuses: readonly {
    kind: string;
    label: string;
    capabilities: { models: readonly { id: string; label: string }[] };
  }[];
}) {
  const { workspace, agentStatuses } = props;
  const kind = workspace.agentKind;
  const modelId = workspace.defaultThreadConfig?.model;
  if (!kind) return <span className="truncate text-[10px] text-muted">—</span>;
  const status = agentStatuses.find((agent) => agent.kind === kind);
  const modelLabel = modelId
    ? (status?.capabilities.models.find((model) => model.id === modelId)?.label ?? modelId)
    : undefined;
  return (
    <span className="truncate text-[10px] text-muted">
      {status?.label ?? kind}
      {modelLabel ? ` · ${modelLabel}` : ""}
    </span>
  );
}
