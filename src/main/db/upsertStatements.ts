import Database from "better-sqlite3";
import type { Project, Thread } from "@/shared/contracts";
import { projectMutableRow } from "./rowMappers";

/**
 * Shared `projects` / `threads` upsert statements. Used by the single-row
 * writers in `projectsThreads.ts` and the bulk renderer sync in `sync.ts` so
 * both paths write exactly the same column set.
 */

export type SqliteStatement = ReturnType<InstanceType<typeof Database>["prepare"]>;

/**
 * `projects` columns the shared upsert writes, in order: `[column, bindParam]`.
 * Bind params come from {@link projectMutableRow} plus `sortOrder`/`createdAt`.
 */
const PROJECT_UPSERT_COLUMNS: readonly (readonly [string, string])[] = [
  ["id", "@id"],
  ["name", "@name"],
  ["icon", "@icon"],
  ["location_kind", "@locationKind"],
  ["location_path", "@locationPath"],
  ["location_distro", "@locationDistro"],
  ["location_linux_path", "@locationLinuxPath"],
  ["location_unc_path", "@locationUncPath"],
  ["last_draft_config", "@lastDraftConfig"],
  ["scripts", "@scripts"],
  ["search_settings", "@searchSettings"],
  ["worktree_location", "@worktreeLocation"],
  ["task_settings", "@taskSettings"],
  ["mcp_servers", "@mcpServers"],
  ["gh_account", "@ghAccount"],
  ["workspace_id", "@workspaceId"],
  ["disabled", "@disabled"],
  ["sort_order", "@sortOrder"],
  ["created_at", "@createdAt"],
];

export function prepareProjectUpsertStatement(
  sqlite: InstanceType<typeof Database>,
): SqliteStatement {
  // The shared statement is also called from the v42 dedup migration, which runs
  // before later additive `projects` columns exist (e.g. `task_settings`, v46).
  // Write only the columns the table actually has, so a historical run (and a
  // fixture that predates a column) doesn't fail on the newest field.
  const present = new Set(
    (sqlite.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );
  const columns = PROJECT_UPSERT_COLUMNS.filter(([column]) => present.has(column));
  const insertColumns = columns.map(([column]) => column).join(", ");
  const insertValues = columns.map(([, bind]) => bind).join(", ");
  const updates = columns
    .filter(([column]) => column !== "id")
    .map(([column]) => `${column} = excluded.${column}`)
    .join(", ");
  return sqlite.prepare(
    `INSERT INTO projects (${insertColumns}) VALUES (${insertValues}) ` +
      `ON CONFLICT(id) DO UPDATE SET ${updates}`,
  );
}

export function runProjectUpsert(stmt: SqliteStatement, project: Project, sortOrder: number): void {
  stmt.run({
    id: project.id,
    ...projectMutableRow(project),
    sortOrder,
    createdAt: project.createdAt,
  });
}

export interface ThreadUpsertOptions {
  /**
   * Whether `thread_status_source` is written. The single-row writer owns that
   * column; the bulk renderer sync leaves it untouched so a stale renderer
   * snapshot cannot clobber a status source the supervisor just recorded.
   */
  readonly writeThreadStatusSource: boolean;
}

export function prepareThreadUpsertStatement(
  sqlite: InstanceType<typeof Database>,
  options: ThreadUpsertOptions,
): SqliteStatement {
  const statusSourceUpdate = options.writeThreadStatusSource
    ? "thread_status_source = excluded.thread_status_source,"
    : "";
  return sqlite.prepare(`
    INSERT INTO threads (
      id, project_id, workspace_id, title, agent_kind, agent_instance_id, config, status,
      attention, thread_status_source, can_resume_with_config, session_ref, terminal_prompt, worktree_path,
      worktree_branch, pr_number, group_id, group_name, parent_thread_id, archived, archived_at, done, done_at,
      starred, presentation_mode, sort_order, created_at, updated_at,
      active_turn_started_at, last_turn_started_at, last_turn_ended_at
    ) VALUES (
      @id, @projectId, @workspaceId, @title, @agentKind, @agentInstanceId, @config, @status,
      @attention, @threadStatusSource, @canResumeWithConfig, @sessionRef, NULL, @worktreePath,
      @worktreeBranch, @prNumber, @groupId, @groupName, @parentThreadId, @archived, @archivedAt, @done, @doneAt,
      @starred, @presentationMode, @sortOrder, @createdAt, @updatedAt,
      @activeTurnStartedAt, @lastTurnStartedAt, @lastTurnEndedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      -- Kept in the update set so "Move to Workspace" survives full syncs.
      workspace_id = excluded.workspace_id,
      title = excluded.title,
      -- Mutable: a thread can be switched to another provider in place, keeping
      -- its id and transcript. Omitting this pinned rows to their first agent.
      agent_kind = excluded.agent_kind,
      agent_instance_id = excluded.agent_instance_id,
      config = excluded.config,
      status = excluded.status,
      attention = excluded.attention,
      ${statusSourceUpdate}
      can_resume_with_config = excluded.can_resume_with_config,
      session_ref = excluded.session_ref,
      terminal_prompt = excluded.terminal_prompt,
      worktree_path = excluded.worktree_path,
      worktree_branch = excluded.worktree_branch,
      pr_number = excluded.pr_number,
      group_id = excluded.group_id,
      group_name = excluded.group_name,
      parent_thread_id = excluded.parent_thread_id,
      archived = excluded.archived,
      archived_at = excluded.archived_at,
      done = excluded.done,
      done_at = excluded.done_at,
      starred = excluded.starred,
      presentation_mode = excluded.presentation_mode,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at,
      active_turn_started_at = excluded.active_turn_started_at,
      last_turn_started_at = excluded.last_turn_started_at,
      last_turn_ended_at = excluded.last_turn_ended_at
  `);
}

export function runThreadUpsert(
  stmt: SqliteStatement,
  thread: Thread,
  sortOrder: number,
  options: ThreadUpsertOptions,
): void {
  stmt.run({
    id: thread.id,
    projectId: thread.projectId,
    workspaceId: thread.workspaceId ?? null,
    title: thread.title,
    agentKind: thread.agentKind,
    agentInstanceId: thread.agentInstanceId ?? null,
    config: JSON.stringify(thread.config),
    status: thread.status,
    attention: thread.attention,
    threadStatusSource: options.writeThreadStatusSource
      ? (thread.threadStatusSource ?? null)
      : null,
    canResumeWithConfig: thread.canResumeWithConfig ? 1 : 0,
    sessionRef: thread.sessionRef ? JSON.stringify(thread.sessionRef) : null,
    worktreePath: thread.worktreePath ?? null,
    worktreeBranch: thread.worktreeBranch ?? null,
    prNumber: thread.prNumber ?? null,
    groupId: thread.groupId ?? null,
    groupName: thread.groupName ?? null,
    parentThreadId: thread.parentThreadId ?? null,
    archived: thread.archived ? 1 : 0,
    archivedAt: thread.archivedAt ?? null,
    done: thread.done ? 1 : 0,
    doneAt: thread.doneAt ?? null,
    starred: thread.starred ? 1 : 0,
    presentationMode: thread.presentationMode ?? "terminal",
    sortOrder,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    activeTurnStartedAt: thread.activeTurnStartedAt ?? null,
    lastTurnStartedAt: thread.lastTurnStartedAt ?? null,
    lastTurnEndedAt: thread.lastTurnEndedAt ?? null,
  });
}
