import { useEffect, useRef } from "react";
import { Trans } from "@lingui/react/macro";
import type { WorkbenchTab } from "@/shared/contracts";
import { HOME_PROJECT_ID } from "@/shared/homeScope";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useWorkspaceStore } from "@/renderer/state/workspaceStore";
import {
  aggregateRole,
  resolveRoleNavigation,
  threadWorkspaceId,
} from "@/renderer/views/MainView/parts/EmployeeDockBar";
import { OFFICE_PALETTES, DESK_ACCENT_CYCLE, parseHexColor } from "./palette";
import { munderStatusForThread } from "./status";
import { latestRunningToolName, toolTokenForToolName } from "./tools";
import { teamColorForWorkspace, TEAM_COLOR_CYCLE } from "./teams";
import {
  employeeWorkspaces,
  hiddenTeamIds,
  rankDotCount,
  regionColorForIndex,
  regionKeyForEmployee,
  UNRANKED_REGION_KEY,
} from "./hierarchy";
import type { DeskModel } from "./floorScene";
import { createOfficeFloorRuntime, type OfficeFloorRuntime } from "./floor";
import { AgentCardStrip, type AgentCardData } from "./AgentCardStrip";
import { PixelButton, PixelPanel } from "./pixel";
import { ApprovalsPanel } from "./ApprovalsPanel";
import { SchedulePanel } from "./SchedulePanel";
import { OrgFlowPanel } from "./OrgFlowPanel";
import { buildOrgFlow, pipelineLanesFromThreadItems } from "@/renderer/state/orgFlow";

const WORKING_LIVE_STATUSES = new Set(["working", "launching"] as const);

function deskAccent(
  agentInstances: { [id: string]: { accentColor?: string | undefined } | undefined },
  workspace: { agentInstanceId?: string | undefined },
  index: number,
): number {
  const fromInstance = workspace.agentInstanceId
    ? parseHexColor(agentInstances[workspace.agentInstanceId]?.accentColor)
    : undefined;
  return fromInstance ?? DESK_ACCENT_CYCLE[index % DESK_ACCENT_CYCLE.length] ?? 0x4ecdc4;
}

/**
 * The office floor and its sub-views, hosted inside the Workbench. The module's
 * header/tab strip lives in WorkbenchView, so this component only renders the
 * surface selected by `tab`; the task board and project board tabs never mount
 * it.
 */
export function OfficeView({
  tab,
  brutalist,
}: {
  tab: Exclude<WorkbenchTab, "tasks" | "projects">;
  brutalist: boolean;
}) {
  const workspaces = useSharedSettings((s) => s.workspaces);
  const agentInstances = useSharedSettings((s) => s.agentInstances);
  const teams = useSharedSettings((s) => s.teams);
  const threads = useAppStore((s) => s.threads);
  const projects = useAppStore((s) => s.projects);
  const contextByThread = useAppStore((s) => s.runtimeContextByThread);
  const itemIdsByThread = useAppStore((s) => s.runtimeItemIdsByThread);
  const itemsByIdByThread = useAppStore((s) => s.runtimeItemsByIdByThread);
  const requestsByThread = useAppStore((s) => s.runtimeRequestsByThread);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<OfficeFloorRuntime | null>(null);
  const prevWorkingRef = useRef<ReadonlySet<string>>(new Set());

  // Boot the pixi runtime once; destroy it on unmount so the GL context dies
  // with the view (no leak when the user navigates back to threads).
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    let cancelled = false;
    const rect = container.getBoundingClientRect();
    const openRole = (workspaceId: string) => {
      const state = useAppStore.getState();
      const agg = aggregateRole(
        state.threads,
        state.projects,
        workspaceId,
        state.runtimeContextByThread,
      );
      const nav = resolveRoleNavigation(agg);
      if (nav.type === "thread") {
        state.openThread(nav.threadId);
      } else {
        useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId);
        state.openDraft(HOME_PROJECT_ID);
      }
    };
    void createOfficeFloorRuntime({
      canvas,
      width: rect.width,
      height: rect.height,
      palette: OFFICE_PALETTES.default,
      onDeskClick: openRole,
    }).then((runtime) => {
      if (cancelled) {
        runtime.destroy();
        return;
      }
      runtimeRef.current = runtime;
    });
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) runtimeRef.current?.resize(Math.floor(box.width), Math.floor(box.height));
    });
    observer.observe(container);
    return () => {
      cancelled = true;
      observer.disconnect();
      runtimeRef.current?.destroy();
      runtimeRef.current = null;
    };
  }, []);

  // Level-1 containers are rooms, not employees — the floor renders only the
  // visible level-2 employees (ranked org-* workspaces, hiddenInNav / hidden
  // team filtered out). Regions follow teamId first, then container parent.
  const hiddenTeams = hiddenTeamIds(teams);
  const employees = employeeWorkspaces(workspaces, hiddenTeams);

  const projectById = new Map(projects.map((p) => [p.id, p] as const));

  // Pipeline lanes: degrade-projected from each employee's threads'
  // test_phase_advance tool calls (supervisor registry has no renderer channel).
  const pipelineLanes = pipelineLanesFromThreadItems(
    employees.map((ws) => ({
      employeeId: ws.id,
      threads: threads
        .filter(
          (th) => th.workspaceId === ws.id || projectById.get(th.projectId)?.workspaceId === ws.id,
        )
        .map((th) => ({
          itemIds: itemIdsByThread[th.id] ?? [],
          items: itemsByIdByThread[th.id] ?? {},
        })),
    })),
  );
  const flowData = buildOrgFlow(workspaces, teams, pipelineLanes);

  // Per-role aggregates from real threads (status, active thread, context).
  const regionOrder: string[] = [];
  for (const ws of employees) {
    const key = regionKeyForEmployee(ws);
    if (!regionOrder.includes(key)) regionOrder.push(key);
  }
  const regionColorForKey = (key: string): number =>
    regionColorForIndex(Math.max(0, regionOrder.indexOf(key)));
  const regionNameForKey = (key: string): string =>
    key === UNRANKED_REGION_KEY
      ? "—"
      : (teams.find((team) => team.id === key)?.name ??
        workspaces.find((w) => w.id === key)?.name ??
        key);
  const roles = employees.map((workspace, index) => {
    const agg = aggregateRole(threads, projects, workspace.id, contextByThread);
    const activeThread = agg.active;
    const activeThreadId = activeThread?.id;
    const toolName =
      activeThreadId !== undefined
        ? latestRunningToolName({
            itemIds: itemIdsByThread[activeThreadId] ?? [],
            items: itemsByIdByThread[activeThreadId] ?? {},
          })
        : undefined;
    const accent = deskAccent(agentInstances, workspace, index);
    return {
      workspace,
      agg,
      accent,
      status: munderStatusForThread(agg.status),
      toolName,
      toolToken: toolTokenForToolName(toolName),
      projectName: activeThread?.projectId
        ? projectById.get(activeThread.projectId)?.name
        : undefined,
      usedTokens: agg.context?.usedTokens,
      maxTokens: agg.context?.maxTokens,
      openRequests: activeThreadId !== undefined ? (requestsByThread[activeThreadId] ?? []) : [],
      regionKey: regionKeyForEmployee(workspace),
      rank: workspace.roleRank,
    };
  });

  // Push desk data into the scene whenever roles, threads, or instances change.
  const deskModels: DeskModel[] = roles.map((role) => ({
    id: role.workspace.id,
    name: role.workspace.name.slice(0, 8),
    accent: role.accent,
    status: role.status,
    teamColor: teamColorForWorkspace(teams, role.workspace.id),
    toolToken: role.toolToken,
    regionColor: regionColorForKey(role.regionKey),
    rankDots: rankDotCount(role.rank),
  }));
  useEffect(() => {
    runtimeRef.current?.floor.setDesks(deskModels);
  });

  // Theme switch: recolor the whole scene (cheap — the floor repaints itself).
  useEffect(() => {
    runtimeRef.current?.setPalette(brutalist ? OFFICE_PALETTES.brutalist : OFFICE_PALETTES.default);
  }, [brutalist]);

  // Team handoff envelopes: whenever a thread newly enters a live turn, fly
  // an envelope from its role's desk to the next desk in the office.
  useEffect(() => {
    const projectNow = new Map(projects.map((p) => [p.id, p] as const));
    const nowWorking = new Set(
      threads
        .filter(
          (thread) =>
            !thread.done &&
            !thread.archived &&
            WORKING_LIVE_STATUSES.has(thread.status as "working"),
        )
        .map((thread) => thread.id),
    );
    const runtime = runtimeRef.current;
    if (runtime) {
      const workspaceIds = employees.map((w) => w.id);
      for (const threadId of nowWorking) {
        if (prevWorkingRef.current.has(threadId)) continue;
        const thread = threads.find((th) => th.id === threadId);
        if (!thread) continue;
        const sourceWorkspaceId = threadWorkspaceId(thread, projectNow);
        if (!sourceWorkspaceId || !workspaceIds.includes(sourceWorkspaceId)) continue;
        const sourceIndex = workspaceIds.indexOf(sourceWorkspaceId);
        const targetWorkspaceId = workspaceIds[(sourceIndex + 1) % workspaceIds.length]!;
        if (targetWorkspaceId !== sourceWorkspaceId) {
          runtime.floor.flyEnvelope(sourceWorkspaceId, targetWorkspaceId);
        }
      }
    }
    prevWorkingRef.current = nowWorking;
    // employees/workspaceIds are derived from workspaces each render; the effect
    // deliberately depends on the rendered employee list, not on workspaces.
    // eslint-disable-next-line react/exhaustive-effect-dependencies
  }, [threads, projects, employees]);

  // Blocked roles (needs_approval) get a pixel approval card; opening the thread
  // surfaces the existing ThreadRuntimeRequestPanel in the composer — no new
  // approval state machine here.
  const blockedRoles = roles.filter(
    (role) => role.status === "blocked" && role.agg.active !== undefined,
  );

  const cards: AgentCardData[] = roles.map((role) => ({
    workspaceId: role.workspace.id,
    name: role.workspace.name,
    agentKind: role.workspace.agentKind,
    accent: role.accent,
    status: role.status,
    projectName: role.projectName,
    toolName: role.toolName,
    usedTokens: role.usedTokens,
    maxTokens: role.maxTokens,
    active: role.agg.active !== undefined,
    rank: role.rank,
  }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1"
        style={{ display: tab === "office" ? "block" : "none" }}
      >
        <canvas
          ref={canvasRef}
          className="block size-full"
          style={{ imageRendering: "pixelated" }}
        />
        {employees.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm text-muted">
              <Trans>No workspaces yet — create a role in settings to populate the office.</Trans>
            </span>
          </div>
        ) : null}
        {blockedRoles.length > 0 ? (
          <div className="absolute right-3 top-3 z-10 flex w-64 flex-col gap-2">
            {blockedRoles.map((role) => (
              <PixelPanel key={role.workspace.id} title={role.workspace.name}>
                <div className="mb-2 text-xs text-muted">
                  <Trans>Needs your approval</Trans>
                  {role.openRequests.length > 0 ? ` (${role.openRequests.length})` : ""}
                </div>
                <PixelButton
                  variant="destructive"
                  onClick={() => {
                    if (role.agg.active) useAppStore.getState().openThread(role.agg.active!.id);
                  }}
                >
                  <Trans>Open thread</Trans>
                </PixelButton>
              </PixelPanel>
            ))}
          </div>
        ) : null}
      </div>
      {tab === "flow" ? (
        <div className="min-h-0 flex-1">
          <OrgFlowPanel data={flowData} />
        </div>
      ) : null}
      {tab === "approvals" ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 md:grid-cols-2">
          <ApprovalsPanel />
          <SchedulePanel />
        </div>
      ) : null}
      <AgentCardStrip
        cards={cards}
        onCardClick={(workspaceId) => {
          const agg = aggregateRole(threads, projects, workspaceId, contextByThread);
          const nav = resolveRoleNavigation(agg);
          if (nav.type === "thread") {
            useAppStore.getState().openThread(nav.threadId);
          } else {
            useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId);
            useAppStore.getState().openDraft(HOME_PROJECT_ID);
          }
        }}
      />
      <div className="flex shrink-0 items-center gap-3 overflow-x-auto border-t border-[var(--hairline)] px-3 py-1.5">
        {regionOrder.length > 0 ? (
          <>
            <span className="whitespace-nowrap text-xs text-muted">
              <Trans>Regions</Trans>
            </span>
            {regionOrder.map((key) => (
              <span
                key={key}
                className="flex items-center gap-1 whitespace-nowrap text-xs text-muted"
              >
                <span
                  aria-hidden="true"
                  className="inline-block size-2.5 border border-[var(--ink,#1b1b1b)]"
                  style={{
                    backgroundColor: `#${regionColorForKey(key).toString(16).padStart(6, "0")}`,
                  }}
                />
                {regionNameForKey(key)}
              </span>
            ))}
            <span className="h-3 w-px bg-[var(--hairline)]" aria-hidden="true" />
          </>
        ) : null}
        {teams.length > 0 ? (
          <>
            <span className="whitespace-nowrap text-xs text-muted">
              <Trans>Teams</Trans>
            </span>
            {teams.map((team, index) => {
              const color = TEAM_COLOR_CYCLE[index % TEAM_COLOR_CYCLE.length] ?? 0x9b59b6;
              return (
                <span
                  key={team.id}
                  className="flex items-center gap-1 whitespace-nowrap text-xs text-muted"
                >
                  <span
                    aria-hidden="true"
                    className="inline-block size-2.5 border border-[var(--ink,#1b1b1b)]"
                    style={{ backgroundColor: `#${color.toString(16).padStart(6, "0")}` }}
                  />
                  {team.name}
                </span>
              );
            })}
          </>
        ) : null}
      </div>
    </div>
  );
}
