import { Trans } from "@lingui/react/macro";
import type { Project, Thread } from "@/shared/contracts";
import type { OpenRuntimeRequest } from "@/renderer/state/slices/runtimeEventSlice";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { threadWorkspaceId } from "@/renderer/views/MainView/parts/EmployeeDockBar";
import { PixelButton, PixelPanel } from "./pixel";

export interface ApprovalRow {
  threadId: string;
  employeeName: string | undefined;
  threadTitle: string;
  requestCount: number;
  requestTypes: string[];
}

/**
 * Collapse every thread's open approval/user-input requests into one row per
 * thread. Pure over the inputs so it is unit-testable without a renderer.
 */
export function buildApprovalRows(
  threads: readonly Thread[],
  projects: readonly Project[],
  workspaces: readonly { id: string; name: string }[],
  requestsByThread: Readonly<Record<string, OpenRuntimeRequest[]>>,
): ApprovalRow[] {
  const projectById = new Map(projects.map((p) => [p.id, p] as const));
  const workspaceById = new Map(workspaces.map((w) => [w.id, w] as const));
  const rows: ApprovalRow[] = [];

  for (const [threadId, requests] of Object.entries(requestsByThread)) {
    if (!requests || requests.length === 0) continue;
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) continue;
    const ownerId = threadWorkspaceId(thread, projectById);
    rows.push({
      threadId,
      employeeName: ownerId ? workspaceById.get(ownerId)?.name : undefined,
      threadTitle: thread.title || threadId,
      requestCount: requests.length,
      requestTypes: [...new Set(requests.map((r) => r.requestType))],
    });
  }
  // Neediest first: threads with more open requests surface above the fold.
  return rows.sort((a, b) => b.requestCount - a.requestCount);
}

/**
 * Central approval center: every thread that is blocked on a human decision
 * (dangerous-tool permissions, user input, auth refresh). Opening a thread jumps
 * to the existing composer → ThreadRuntimeRequestPanel — no new approval state.
 */
export function ApprovalsPanel() {
  const threads = useAppStore((s) => s.threads);
  const projects = useAppStore((s) => s.projects);
  const workspaces = useSharedSettings((s) => s.workspaces);
  const requestsByThread = useAppStore((s) => s.runtimeRequestsByThread);
  const rows = buildApprovalRows(threads, projects, workspaces, requestsByThread);

  return (
    <PixelPanel title="approvals">
      {rows.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted">
          <Trans>No pending approvals</Trans>
        </div>
      ) : (
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {rows.map((row) => (
            <div
              key={row.threadId}
              className="flex items-center gap-2 border border-[var(--hairline)] p-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-foreground">
                  {row.employeeName ?? <Trans>Unassigned</Trans>}
                </div>
                <div className="truncate text-[11px] text-muted" title={row.threadTitle}>
                  {row.threadTitle}
                </div>
                <div className="text-[10px] text-muted/70">
                  {row.requestCount} · {row.requestTypes.join(", ")}
                </div>
              </div>
              <PixelButton
                variant="destructive"
                onClick={() => useAppStore.getState().openThread(row.threadId)}
              >
                <Trans>Open thread</Trans>
              </PixelButton>
            </div>
          ))}
        </div>
      )}
    </PixelPanel>
  );
}
