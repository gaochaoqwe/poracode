import type { Team, Workspace } from "@/shared/contracts";
import { ORG_CAPABILITIES } from "@/shared/orgCapabilities";

/**
 * Pure selectors for the org-flow view ("task landscape + bottleneck graph").
 * UI reads ONLY these — never touch the registry or workspace capabilityIds
 * inline. Hierarchy: level-1 container → team → level-2 employee. Hidden
 * (hiddenInNav) employees and hidden teams are filtered out. Each configured
 * capability resolves against the system registry: configured + implemented =
 * "have it"; configured but unimplemented = "missing" (bottleneck); unknown
 * custom ids degrade to missing-and-unknown.
 */

export interface OrgFlowCapabilityState {
  id: string;
  label: string;
  implemented: boolean;
  configured: boolean;
  unknown: boolean;
}

export interface OrgFlowEmployeeNode {
  id: string;
  name: string;
  rank: number | undefined;
  parentId: string | undefined;
  teamId: string | undefined;
  capabilities: OrgFlowCapabilityState[];
  missingCount: number;
  missingIds: string[];
}

export interface OrgFlowTeam {
  id: string;
  name: string;
  employees: OrgFlowEmployeeNode[];
}

export interface OrgFlowGroup {
  id: string;
  name: string;
  /** Employees bucketed by teamId (software-test lane: mgmt vs execution). */
  teams: OrgFlowTeam[];
  /** Employees with no teamId, listed directly under the container. */
  directEmployees: OrgFlowEmployeeNode[];
}

export interface OrgFlowData {
  groups: OrgFlowGroup[];
  unranked: OrgFlowEmployeeNode[];
  /** Test-project pipeline progress lanes (planning→…→done). */
  pipelineLanes: OrgFlowPhaseNode[];
}

/** Test pipeline stages, forward-only — mirrors supervisor TestPipelinePhase. */
export type TestPipelinePhase = "planning" | "requirements" | "dynamic" | "report" | "done";

export const TEST_PIPELINE_PHASES: readonly TestPipelinePhase[] = [
  "planning",
  "requirements",
  "dynamic",
  "report",
  "done",
];

export interface OrgFlowPhaseNode {
  projectId: string;
  projectName?: string | undefined;
  phase: TestPipelinePhase;
  /** Employee whose thread last advanced the phase. */
  ownerEmployeeId?: string | undefined;
  /** ISO time of the last phase update (for stall calc). */
  enteredAt?: string | undefined;
}

/** Current stage index + total (1-based progress). */
export function phaseProgress(phase: TestPipelinePhase): { index: number; total: number } {
  return { index: TEST_PIPELINE_PHASES.indexOf(phase), total: TEST_PIPELINE_PHASES.length };
}

/** Minutes stalled at the current phase; undefined when no timestamp. */
export function phaseStallMinutes(
  enteredAt: string | undefined,
  nowMs: number,
): number | undefined {
  if (!enteredAt) return undefined;
  const started = Date.parse(enteredAt);
  if (Number.isNaN(started)) return undefined;
  return Math.max(0, Math.floor((nowMs - started) / 60_000));
}

/**
 * Degraded projection: read the latest `test_phase_advance` tool call out of a
 * thread's runtime items (projectId/phase from args/result). The supervisor's
 * TestPipelineRegistry itself is in-memory only with no renderer channel yet —
 * these values are projections, not authoritative state.
 */
export interface ThreadItemsLike {
  itemIds: readonly string[];
  items: Record<string, { payload?: unknown; updatedAt?: string } | undefined>;
}

export function projectPhaseFromThreadItems(
  employeeId: string,
  thread: ThreadItemsLike,
): OrgFlowPhaseNode | undefined {
  let latest:
    | {
        projectId: string;
        projectName: string | undefined;
        phase: TestPipelinePhase;
        updatedAt: string | undefined;
      }
    | undefined;
  for (const itemId of thread.itemIds) {
    const item = thread.items[itemId];
    const payload = item?.payload as
      | { name?: string; args?: unknown; result?: unknown; status?: string }
      | undefined;
    if (payload?.name !== "test_phase_advance") continue;
    const args = (payload.args ?? {}) as { projectId?: string; projectName?: string };
    const result = (payload.result ?? {}) as { phase?: string; updatedAt?: string };
    if (!args.projectId) continue;
    const phase = (TEST_PIPELINE_PHASES as readonly string[]).includes(result.phase ?? "")
      ? (result.phase as TestPipelinePhase)
      : "planning";
    latest = {
      projectId: args.projectId,
      projectName: args.projectName,
      phase,
      updatedAt: result.updatedAt ?? item?.updatedAt,
    };
  }
  if (!latest) return undefined;
  const node: OrgFlowPhaseNode = {
    projectId: latest.projectId,
    phase: latest.phase,
    ownerEmployeeId: employeeId,
  };
  if (latest.projectName !== undefined) node.projectName = latest.projectName;
  if (latest.updatedAt !== undefined) node.enteredAt = latest.updatedAt;
  return node;
}

export interface EmployeeThreadSource {
  employeeId: string;
  threads: readonly ThreadItemsLike[];
}

/**
 * Assemble pipeline lanes from per-employee thread projections. The same
 * project may be advanced from several employees' threads — keep the node with
 * the latest enteredAt. Projection-based (see projectPhaseFromThreadItems).
 */
export function pipelineLanesFromThreadItems(
  sources: readonly EmployeeThreadSource[],
): OrgFlowPhaseNode[] {
  const byProject = new Map<string, OrgFlowPhaseNode>();
  for (const source of sources) {
    for (const thread of source.threads) {
      const node = projectPhaseFromThreadItems(source.employeeId, thread);
      if (!node) continue;
      const existing = byProject.get(node.projectId);
      if (existing === undefined) {
        byProject.set(node.projectId, node);
        continue;
      }
      const existingTime = existing.enteredAt === undefined ? 0 : Date.parse(existing.enteredAt);
      const candidateTime = node.enteredAt === undefined ? 0 : Date.parse(node.enteredAt);
      if (candidateTime < existingTime) continue;
      // Newer node wins phase/owner/enteredAt, but keep its projectName unless
      // the projection itself carried one.
      if (node.projectName === undefined) node.projectName = existing.projectName;
      byProject.set(node.projectId, node);
    }
  }
  return [...byProject.values()];
}

/** A role is a bottleneck card when ≥2 configured capabilities are missing. */
export const BOTTLENECK_THRESHOLD = 2;

function buildEmployeeNode(ws: Workspace, knownIds: ReadonlySet<string>): OrgFlowEmployeeNode {
  const configured = new Set(ws.capabilityIds ?? []);
  const capabilities: OrgFlowCapabilityState[] = ORG_CAPABILITIES.map((cap) => ({
    id: cap.id,
    label: cap.label,
    implemented: cap.implemented,
    configured: configured.has(cap.id),
    unknown: false,
  }));
  for (const id of configured) {
    if (!knownIds.has(id)) {
      capabilities.push({ id, label: id, implemented: false, configured: true, unknown: true });
    }
  }
  const missing = capabilities.filter((c) => c.configured && !c.implemented);
  return {
    id: ws.id,
    name: ws.name,
    rank: ws.roleRank,
    parentId: ws.parentWorkspaceId,
    teamId: ws.teamId,
    capabilities,
    missingCount: missing.length,
    missingIds: missing.map((c) => c.id),
  };
}

export function buildOrgFlow(
  workspaces: readonly Workspace[],
  teams: readonly Team[] = [],
  pipelineLanes: readonly OrgFlowPhaseNode[] = [],
): OrgFlowData {
  const knownIds = new Set(ORG_CAPABILITIES.map((c) => c.id));
  const hiddenTeams = new Set(teams.filter((t) => t.hiddenInNav === true).map((t) => t.id));
  const visible = workspaces.filter(
    (w) =>
      w.roleRank !== undefined &&
      w.hiddenInNav !== true &&
      (w.teamId === undefined || !hiddenTeams.has(w.teamId)),
  );
  const containerById = new Map(workspaces.map((w) => [w.id, w] as const));
  const teamById = new Map(teams.map((t) => [t.id, t] as const));
  const nodes = visible.map((ws) => buildEmployeeNode(ws, knownIds));

  const groupById = new Map<string, OrgFlowGroup>();
  const unranked: OrgFlowEmployeeNode[] = [];
  for (const node of nodes) {
    if (node.parentId === undefined) {
      unranked.push(node);
      continue;
    }
    if (!groupById.has(node.parentId)) {
      groupById.set(node.parentId, {
        id: node.parentId,
        name: containerById.get(node.parentId)?.name ?? node.parentId,
        teams: [],
        directEmployees: [],
      });
    }
    const group = groupById.get(node.parentId)!;
    if (node.teamId === undefined) {
      group.directEmployees.push(node);
      continue;
    }
    let team = group.teams.find((t) => t.id === node.teamId);
    if (!team) {
      team = {
        id: node.teamId,
        name: teamById.get(node.teamId)?.name ?? node.teamId,
        employees: [],
      };
      group.teams.push(team);
    }
    team.employees.push(node);
  }
  return { groups: [...groupById.values()], unranked, pipelineLanes: [...pipelineLanes] };
}

export function isBottleneckNode(node: Pick<OrgFlowEmployeeNode, "missingCount">): boolean {
  return node.missingCount >= BOTTLENECK_THRESHOLD;
}

/** Legend rows (text is wrapped in i18n at the UI layer). */
export interface OrgFlowLegendEntry {
  id: "have" | "missing" | "unconfigured";
}

export function orgFlowLegend(): readonly OrgFlowLegendEntry[] {
  return [{ id: "have" }, { id: "missing" }, { id: "unconfigured" }];
}
