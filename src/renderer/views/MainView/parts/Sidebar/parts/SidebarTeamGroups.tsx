import { useShallow } from "zustand/shallow";
import { Trans } from "@lingui/react/macro";
import { ChevronRight } from "lucide-react";
import { isThreadTurnActive, type Project, type Team, type Thread } from "@/shared/contracts";
import { isHomeProjectId } from "@/shared/homeScope";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useIsWorktreeCollapsed, useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import { SidebarThreadRow } from "./SidebarThreadRow";

/**
 * The employee (workspace / 岗位) a thread belongs to: Home threads carry their
 * own `workspaceId`; threads in real projects resolve through their project.
 * Mirrors the rule used elsewhere for role-attributing threads — a thread with
 * no resolvable tag belongs to no team member.
 */
function resolveThreadWorkspaceId(
  thread: { projectId: string; workspaceId?: string | undefined },
  projectById: ReadonlyMap<string, Project>,
): string | undefined {
  if (isHomeProjectId(thread.projectId)) return thread.workspaceId;
  return projectById.get(thread.projectId)?.workspaceId;
}

/** Collapse key shares the manual-thread-group namespace (`group:<id>`), which
 *  defaults to expanded — same as user-created thread groups. */
function teamCollapseKey(teamId: string): string {
  return `group:${teamId}`;
}

/** Only live, unsettled turns surface here; done/archived/idle threads sink to
 *  their project's Done section and out of the team rollup. */
function isTeamActiveThread(thread: Thread): boolean {
  return !thread.done && !thread.archived && isThreadTurnActive(thread.status);
}

function SidebarTeamGroup(props: {
  team: Team;
  threads: readonly Thread[];
  projectById: ReadonlyMap<string, Project>;
  editingThreadId: string | null;
  setEditingThreadId: (id: string | null) => void;
}) {
  const { team, threads, projectById, editingThreadId, setEditingThreadId } = props;
  const collapseKey = teamCollapseKey(team.id);
  const isCollapsed = useIsWorktreeCollapsed(collapseKey);
  const toggleWorktreeCollapsed = useSidebarUiStore((s) => s.toggleWorktreeCollapsed);

  const memberIds = new Set(team.memberEmployeeIds);
  const memberThreads: { thread: Thread; project: Project }[] = [];
  for (const thread of threads) {
    if (!isTeamActiveThread(thread)) continue;
    if (!memberIds.has(resolveThreadWorkspaceId(thread, projectById) ?? "")) continue;
    const project = projectById.get(thread.projectId);
    // ThreadContextMenu / the row need a project; a thread whose project has
    // unloaded simply stays out of the rollup rather than crashing the row.
    if (!project) continue;
    memberThreads.push({ thread, project });
  }

  const emptyMessage =
    team.memberEmployeeIds.length === 0 ? (
      <Trans>This team has no member roles</Trans>
    ) : (
      <Trans>No active threads</Trans>
    );

  return (
    <div>
      <div className="group flex w-full items-center gap-1 rounded px-2 py-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium text-muted transition-colors hover:text-foreground"
          onClick={() => toggleWorktreeCollapsed(collapseKey)}
        >
          <ChevronRight
            className={`size-3 shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
          />
          <span className="truncate">{team.name}</span>
          <span className="shrink-0 text-muted/60">{memberThreads.length}</span>
        </button>
      </div>
      {!isCollapsed ? (
        memberThreads.length === 0 ? (
          <p className="pl-7 pr-2 text-xs text-muted">{emptyMessage}</p>
        ) : (
          memberThreads.map(({ thread, project }, threadIndex) => (
            <div key={`team:${team.id}:thread:${thread.id}`} className="ml-3.5 pl-1">
              <SidebarThreadRow
                row={{
                  kind: "thread",
                  key: `team:${team.id}:thread:${thread.id}`,
                  thread,
                  threadIndex,
                  group: `team:${team.id}`,
                  showWorktreeBadge: false,
                  showWorktreeFilesButton: false,
                  inGroup: true,
                }}
                project={project}
                editingThreadId={editingThreadId}
                setEditingThreadId={setEditingThreadId}
              />
            </div>
          ))
        )
      ) : null}
    </div>
  );
}

/**
 * Cross-project rollup of which employee roles (workspaces) inside each team
 * are currently running threads. Pinned above the project list; renders nothing
 * when no teams are defined so existing sidebars are unchanged.
 */
export function SidebarTeamGroups() {
  const teams = useSharedSettings((s) => s.teams);
  const projects = useAppStore((s) => s.projects);
  const threads = useAppStore(useShallow((state) => state.threads));
  const editingThreadId = useSidebarUiStore((s) => s.editingThreadId);
  const setEditingThreadId = useSidebarUiStore((s) => s.setEditingThreadId);

  if (teams.length === 0) return null;

  const projectById = new Map(projects.map((project) => [project.id, project] as const));

  return (
    <div className="shrink-0 pb-2">
      <div className="px-1.5 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted">
        <Trans>Teams</Trans>
      </div>
      {teams.map((team) => (
        <SidebarTeamGroup
          key={team.id}
          team={team}
          threads={threads}
          projectById={projectById}
          editingThreadId={editingThreadId}
          setEditingThreadId={setEditingThreadId}
        />
      ))}
    </div>
  );
}
