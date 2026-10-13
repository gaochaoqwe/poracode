import type { Team } from "@/shared/contracts";
import { getSqlite } from "./connection";

interface TeamRow {
  id: string;
  name: string;
  member_employee_ids: string;
  manager_employee_id: string | null;
  dispatch_policy: string;
  created_at: string;
}

function teamFromRow(row: TeamRow): Team {
  let memberEmployeeIds: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.member_employee_ids);
    if (Array.isArray(parsed)) memberEmployeeIds = parsed.filter((id): id is string => typeof id === "string");
  } catch {
    // Corrupt member list — degrade to an empty team rather than throwing.
  }
  return {
    id: row.id,
    name: row.name,
    memberEmployeeIds,
    managerEmployeeId: row.manager_employee_id ?? undefined,
    dispatchPolicy: row.dispatch_policy as Team["dispatchPolicy"],
    createdAt: row.created_at,
  };
}

export function dbListTeams(): Team[] {
  const rows = getSqlite()
    .prepare("SELECT * FROM teams ORDER BY created_at ASC, rowid ASC")
    .all() as TeamRow[];
  return rows.map(teamFromRow);
}

export function dbGetTeam(id: string): Team | null {
  const row = getSqlite().prepare("SELECT * FROM teams WHERE id = ?").get(id) as
    | TeamRow
    | undefined;
  return row ? teamFromRow(row) : null;
}

export function dbUpsertTeam(team: Team): void {
  getSqlite()
    .prepare(
      `INSERT INTO teams (
        id, name, member_employee_ids, manager_employee_id, dispatch_policy, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        member_employee_ids = excluded.member_employee_ids,
        manager_employee_id = excluded.manager_employee_id,
        dispatch_policy = excluded.dispatch_policy`,
    )
    .run(
      team.id,
      team.name,
      JSON.stringify(team.memberEmployeeIds),
      team.managerEmployeeId ?? null,
      team.dispatchPolicy,
      team.createdAt,
    );
}

export function dbDeleteTeam(id: string): void {
  getSqlite().prepare("DELETE FROM teams WHERE id = ?").run(id);
}

/** A team-orchestration run: one dispatch against a team's members. */
export interface TeamRunRecord {
  id: string;
  teamId: string;
  prompt: string;
  policy: string;
  targetWorkspaceIds: string[];
  status: string;
  createdAt: string;
  finishedAt: string | null;
}

interface TeamRunRow {
  id: string;
  team_id: string;
  prompt: string;
  policy: string;
  target_workspace_ids: string;
  status: string;
  created_at: string;
  finished_at: string | null;
}

function teamRunFromRow(row: TeamRunRow): TeamRunRecord {
  let targetWorkspaceIds: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.target_workspace_ids);
    if (Array.isArray(parsed)) {
      targetWorkspaceIds = parsed.filter((id): id is string => typeof id === "string");
    }
  } catch {
    // Corrupt target list — degrade to empty.
  }
  return {
    id: row.id,
    teamId: row.team_id,
    prompt: row.prompt,
    policy: row.policy,
    targetWorkspaceIds,
    status: row.status,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

export function dbInsertTeamRun(run: TeamRunRecord): void {
  getSqlite()
    .prepare(
      `INSERT INTO team_runs (
        id, team_id, prompt, policy, target_workspace_ids, status, created_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      run.id,
      run.teamId,
      run.prompt,
      run.policy,
      JSON.stringify(run.targetWorkspaceIds),
      run.status,
      run.createdAt,
      run.finishedAt ?? null,
    );
}

export function dbListTeamRuns(teamId: string, limit = 50): TeamRunRecord[] {
  const rows = getSqlite()
    .prepare(
      `SELECT * FROM team_runs
       WHERE team_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`,
    )
    .all(teamId, limit) as TeamRunRow[];
  return rows.map(teamRunFromRow);
}

export function dbUpdateTeamRunStatus(
  id: string,
  status: string,
  finishedAt: string | null,
): void {
  getSqlite()
    .prepare("UPDATE team_runs SET status = ?, finished_at = ? WHERE id = ?")
    .run(status, finishedAt, id);
}
