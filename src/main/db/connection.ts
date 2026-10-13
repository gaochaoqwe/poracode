import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { resetMainCreatedThreads } from "./mainCreatedThreads";
import {
  assertRequiredDatabaseSchema,
  repairSafeSchemaDrift,
  runDatabaseMigrations,
} from "./migrations";

let _sqlite: InstanceType<typeof Database> | undefined;

/**
 * Monotonic counter bumped ONLY by writes the profile actually reads — the
 * durable usage_events log (dbAppendUsageEvents) and identity edits. The profile
 * caches key on this, so high-frequency chat persistence (runtime snapshots/
 * turns) does NOT churn the cache during active sessions.
 */
let _profileDataGeneration = 0;
export function getProfileDataGeneration(): number {
  return _profileDataGeneration;
}
export function bumpProfileDataGeneration(): void {
  _profileDataGeneration++;
}

/** How long durable usage events are retained (well beyond the 364-day heatmap). */
const USAGE_EVENTS_RETENTION_DAYS = 730;
const REMOTE_COMMAND_RECEIPTS_RETENTION_DAYS = 30;

const BETTER_SQLITE_NATIVE_BINDING_ENV = "AGENTEMPLOYEE_BETTER_SQLITE3_NATIVE_BINDING";

export function resolveBetterSqliteNativeBindingOptions(
  env: NodeJS.ProcessEnv = process.env,
  bindingExists: (path: string) => boolean = existsSync,
): ConstructorParameters<typeof Database>[1] | undefined {
  const explicit = env[BETTER_SQLITE_NATIVE_BINDING_ENV]?.trim();
  if (explicit) {
    if (!bindingExists(explicit)) {
      throw new Error(
        `${BETTER_SQLITE_NATIVE_BINDING_ENV} points to a file that does not exist: ${explicit}. ` +
          "Set it to a compatible better-sqlite3 13 N-API binary, or unset it.",
      );
    }
    return { nativeBinding: explicit };
  }
  // SQLite 13 bundles N-API binaries. Never load a stale pre-13 server-native artifact.
  return undefined;
}

function openDatabase(dbPath: string): InstanceType<typeof Database> {
  const options = resolveBetterSqliteNativeBindingOptions();
  return new Database(dbPath, options);
}

export function initDatabase(dbPath: string) {
  console.log(`[db] opening ${dbPath}`);
  const sqlite = openDatabase(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  _sqlite = sqlite;

  // Create tables if they don't exist.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location_kind TEXT NOT NULL,
      location_path TEXT,
      location_distro TEXT,
      location_linux_path TEXT,
      location_unc_path TEXT,
      last_draft_config TEXT,
      scripts TEXT,
      worktree_location TEXT,
      task_settings TEXT,
      workspace_id TEXT,
      mcp_servers TEXT,
      disabled INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      agent_kind TEXT NOT NULL,
      config TEXT NOT NULL,
      status TEXT NOT NULL,
      attention TEXT NOT NULL,
      can_resume_with_config INTEGER NOT NULL DEFAULT 0,
      session_ref TEXT,
      terminal_prompt TEXT,
      worktree_path TEXT,
      worktree_branch TEXT,
      pr_number INTEGER,
      archived INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      done INTEGER NOT NULL DEFAULT 0,
      done_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      active_turn_started_at TEXT,
      last_turn_started_at TEXT,
      last_turn_ended_at TEXT
    );
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS thread_runtime_items (
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      type TEXT NOT NULL,
      state TEXT NOT NULL,
      payload TEXT,
      streams TEXT,
      PRIMARY KEY (thread_id, item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_items_thread_pos
      ON thread_runtime_items (thread_id, position);
    CREATE TABLE IF NOT EXISTS thread_runtime_item_stream_chunks (
      thread_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      stream TEXT NOT NULL,
      seq INTEGER NOT NULL,
      chars INTEGER NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY (thread_id, item_id, stream, seq),
      FOREIGN KEY (thread_id, item_id)
        REFERENCES thread_runtime_items (thread_id, item_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS thread_runtime_item_stream_state (
      thread_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      stream TEXT NOT NULL,
      next_seq INTEGER NOT NULL,
      tail_chars INTEGER NOT NULL,
      elided_chars INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (thread_id, item_id, stream),
      FOREIGN KEY (thread_id, item_id)
        REFERENCES thread_runtime_items (thread_id, item_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS thread_completed_turns (
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      anchor_item_id TEXT,
      PRIMARY KEY (thread_id, idx)
    );
    CREATE TABLE IF NOT EXISTS thread_context_usage (
      thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
      usage TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_notes (
      project_id TEXT PRIMARY KEY,
      doc TEXT,
      todos TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      mode TEXT,
      fast INTEGER NOT NULL DEFAULT 0,
      effort TEXT,
      name TEXT,
      value INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_usage_events_kind ON usage_events (kind);
    CREATE TABLE IF NOT EXISTS usage_token_ledger (
      provider TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      last_counter INTEGER NOT NULL,
      PRIMARY KEY (provider, scope_id, epoch)
    );
    CREATE TABLE IF NOT EXISTS usage_token_samples (
      sample_id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      agent_kind TEXT NOT NULL,
      config TEXT NOT NULL,
      employee_id TEXT,
      category TEXT,
      project_id TEXT,
      isolation TEXT NOT NULL DEFAULT 'worktree',
      worktree_path TEXT,
      worktree_branch TEXT,
      thread_id TEXT,
      recurrence TEXT,
      schedule_enabled INTEGER NOT NULL DEFAULT 0,
      next_run_at TEXT,
      last_run_at TEXT,
      last_completed_at TEXT,
      last_status TEXT NOT NULL DEFAULT 'never',
      last_result TEXT,
      last_error TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_next_run
      ON tasks (schedule_enabled, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
    CREATE INDEX IF NOT EXISTS idx_tasks_thread ON tasks (thread_id);
    CREATE TABLE IF NOT EXISTS task_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      summary TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_task_runs_task
      ON task_runs (task_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS task_drafts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      note TEXT,
      category TEXT,
      employee_id TEXT,
      project_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_drafts_project
      ON task_drafts (project_id, sort_order);
    CREATE TABLE IF NOT EXISTS pr_watches (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      pr_number INTEGER NOT NULL,
      head_branch TEXT NOT NULL,
      worktree_path TEXT,
      watch_enabled INTEGER NOT NULL DEFAULT 1,
      auto_merge INTEGER NOT NULL DEFAULT 0,
      agent_kind TEXT,
      config TEXT,
      last_comment_cursor TEXT,
      last_review_comment_cursor TEXT,
      last_review_cursor TEXT,
      last_check_key TEXT,
      active_thread_id TEXT,
      last_error TEXT,
      blocked_reason TEXT,
      PRIMARY KEY (project_id, pr_number)
    );
    CREATE TABLE IF NOT EXISTS remote_command_receipts (
      command_id TEXT PRIMARY KEY,
      route TEXT NOT NULL,
      state TEXT NOT NULL,
      response TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_remote_command_receipts_updated
      ON remote_command_receipts (updated_at);
    -- =====================================================================
    -- Code-review persisted data (in the same global sqlite as projects so the
    -- review task / issue / diff rows live in one database, mirrored from the
    -- per-project reviews/*.json reports by the main ingest service).
    -- kind distinguishes the review type (function / chain / feature for
    -- configuration-item review; regression for regression review), matching the
    -- original requirement_extractor's per-type review tables.
    -- =====================================================================
    CREATE TABLE IF NOT EXISTS review_tasks (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      task_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      total INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0,
      issue_count INTEGER NOT NULL DEFAULT 0,
      diff_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      created_at TEXT,
      PRIMARY KEY (project_id, task_id, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_review_tasks_project ON review_tasks (project_id);
    CREATE TABLE IF NOT EXISTS review_issues (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      issue_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      file TEXT NOT NULL,
      function_name TEXT,
      line INTEGER,
      type TEXT,
      severity TEXT,
      summary TEXT,
      description_issue TEXT,
      suggestion TEXT,
      impact TEXT,
      description_location TEXT,
      code_statement TEXT,
      problem_reason TEXT,
      issue_location TEXT,
      source_code TEXT,
      PRIMARY KEY (project_id, task_id, issue_id)
    );
    CREATE INDEX IF NOT EXISTS idx_review_issues_task ON review_issues (project_id, task_id);
    CREATE TABLE IF NOT EXISTS review_diff_files (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      path TEXT NOT NULL,
      status TEXT NOT NULL,
      left_content TEXT,
      right_content TEXT,
      PRIMARY KEY (project_id, task_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_review_diff_task ON review_diff_files (project_id, task_id);
    -- 功能模块（链路 / 功能审查四栏第一栏的数据源）。报告 features[] 的镜像：
    -- 平铺一行一个模块，parent_id 指回父模块（链路审查是树，功能审查一般平铺）。
    -- files / functions / chain_order 以 JSON 数组文本存储，读回时解析。
    CREATE TABLE IF NOT EXISTS review_features (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      feature_id TEXT NOT NULL,
      parent_id TEXT,
      kind TEXT NOT NULL,
      ordinal INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      section TEXT,
      description TEXT,
      entry_function TEXT,
      status TEXT,
      files TEXT NOT NULL DEFAULT '[]',
      functions TEXT NOT NULL DEFAULT '[]',
      chain_order TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (project_id, task_id, feature_id)
    );
    CREATE INDEX IF NOT EXISTS idx_review_features_task ON review_features (project_id, task_id);
    -- =====================================================================
    -- Static-analysis persisted data (migrated from the original
    -- requirement_extractor staticAnalysis module). One database (the global
    -- state.sqlite), with mode distinguishing the analysis kind:
    --   normal_c / normal_fpga  = pure-AI mode, C language / FPGA (VHDL·Verilog)
    --   filter_c / filter_fpga  = tool mode (科代 results), C / FPGA
    -- Tasks are written the moment the user creates them; report rows are
    -- mirrored from <project>/static-analysis/*.json by the ingest service.
    -- =====================================================================
    CREATE TABLE IF NOT EXISTS static_analysis_tasks (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      task_name TEXT NOT NULL,
      mode TEXT NOT NULL,
      domain TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      progress INTEGER NOT NULL DEFAULT 0,
      total_files INTEGER NOT NULL DEFAULT 0,
      processed_files INTEGER NOT NULL DEFAULT 0,
      total_problems INTEGER NOT NULL DEFAULT 0,
      total_rules INTEGER NOT NULL DEFAULT 0,
      accurate_rules INTEGER NOT NULL DEFAULT 0,
      uncertain_rules INTEGER NOT NULL DEFAULT 0,
      total_units INTEGER NOT NULL DEFAULT 0,
      processed_units INTEGER NOT NULL DEFAULT 0,
      current_rule_code TEXT,
      current_analyzing_issue TEXT,
      tool_calls_count INTEGER NOT NULL DEFAULT 0,
      selected_rules TEXT NOT NULL DEFAULT '[]',
      excel_file TEXT,
      codebase_path TEXT,
      created_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (project_id, task_id)
    );
    CREATE INDEX IF NOT EXISTS idx_static_tasks_project ON static_analysis_tasks (project_id);
    CREATE TABLE IF NOT EXISTS static_analysis_problems (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      problem_id TEXT NOT NULL,
      issue_name TEXT,
      issue_file TEXT,
      issue_line INTEGER,
      issue_location TEXT,
      issue_description TEXT,
      issue_level TEXT,
      rule_code TEXT,
      rule_type TEXT,
      rule_accuracy_type TEXT,
      ai_analyzed INTEGER NOT NULL DEFAULT 0,
      ai_is_real_issue INTEGER,
      ai_confidence INTEGER,
      ai_analysis_result TEXT,
      ai_reasoning TEXT,
      ai_recommendations TEXT,
      problem_status INTEGER NOT NULL DEFAULT 0,
      is_filtered INTEGER NOT NULL DEFAULT 0,
      filter_reason TEXT,
      file_name TEXT,
      violation_rules TEXT,
      description_requirement TEXT,
      description_issue TEXT,
      description_location TEXT,
      description_impact TEXT,
      problem_sheet TEXT,
      function_name TEXT,
      source_code TEXT,
      sheet_name TEXT,
      row_index INTEGER,
      PRIMARY KEY (project_id, task_id, problem_id)
    );
    CREATE INDEX IF NOT EXISTS idx_static_problems_task ON static_analysis_problems (project_id, task_id);
    CREATE TABLE IF NOT EXISTS static_analysis_files (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      source_code TEXT,
      PRIMARY KEY (project_id, task_id, file_path)
    );
    CREATE INDEX IF NOT EXISTS idx_static_files_task ON static_analysis_files (project_id, task_id);
    CREATE TABLE IF NOT EXISTS static_analysis_rules (
      rule_code TEXT NOT NULL,
      rule_type TEXT NOT NULL,
      rule_name TEXT,
      rule_description TEXT,
      category TEXT,
      accuracy_type TEXT NOT NULL DEFAULT 'uncertain',
      analysis_complexity TEXT,
      detection_method TEXT,
      keywords TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (rule_code)
    );
    CREATE INDEX IF NOT EXISTS idx_static_rules_type ON static_analysis_rules (rule_type);
    CREATE TABLE IF NOT EXISTS static_analysis_marked_problems (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      problem_key TEXT NOT NULL,
      rule_type TEXT,
      problem_data TEXT,
      marked_at TEXT,
      PRIMARY KEY (project_id, task_id, problem_key)
    );
    -- 全局默认规则配置：跨用户保存的默认勾选规则码集合（"保存为默认规则配置"）。
    CREATE TABLE IF NOT EXISTS static_analysis_default_rules (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      selected_rules TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    -- teams/team_runs were introduced by migration 48 and are listed in
    -- REQUIRED_COLUMNS, so a recorded schema version that skips their migration
    -- would otherwise fail assertRequiredDatabaseSchema at startup. Creating
    -- them here keeps every required table present no matter which version a
    -- profile happens to have recorded.
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      member_employee_ids TEXT NOT NULL DEFAULT '[]',
      manager_employee_id TEXT,
      dispatch_policy TEXT NOT NULL DEFAULT 'round-robin',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS team_runs (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      policy TEXT NOT NULL,
      target_workspace_ids TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_team_runs_team
      ON team_runs (team_id, created_at DESC);
  `);

  const storedVersion = Number(
    (
      sqlite.prepare("SELECT value FROM app_state WHERE key = 'schema_version'").get() as
        | { value: string }
        | undefined
    )?.value ?? "0",
  );

  runDatabaseMigrations(sqlite, storedVersion);
  repairSafeSchemaDrift(sqlite);
  assertRequiredDatabaseSchema(sqlite);

  // Bound the durable usage log: drop events older than the retention window so
  // a long-lived install can't accumulate unboundedly (aggregation reads scan
  // this table). Runs once per startup; cheap on a bounded table. Migration and
  // schema validation above guarantee this table exists, so SQLite failures here
  // must remain observable instead of being mistaken for legacy schema drift.
  const cutoff = Date.now() - USAGE_EVENTS_RETENTION_DAYS * 86_400_000;
  sqlite.prepare("DELETE FROM usage_events WHERE ts < ?").run(cutoff);

  const receiptCutoff = Date.now() - REMOTE_COMMAND_RECEIPTS_RETENTION_DAYS * 86_400_000;
  sqlite.prepare("DELETE FROM remote_command_receipts WHERE updated_at < ?").run(receiptCutoff);

  console.log("[db] initialized");
  return sqlite;
}

/** better-sqlite3 handle; every DB module issues prepared statements against it. */
export function getSqlite(): InstanceType<typeof Database> {
  if (!_sqlite) throw new Error("Database not initialized");
  return _sqlite;
}

/**
 * Hooks run while the database is still open, before it closes. Registered by
 * modules that buffer writes (see `runtimeItems.ts`) so nothing queued is lost
 * on shutdown. Registration order is preserved; a failed hook leaves the
 * database open so its buffered writes can be retried instead of discarded.
 */
const beforeCloseHooks: Array<() => void> = [];

export function registerBeforeDatabaseClose(hook: () => void): void {
  beforeCloseHooks.push(hook);
}

export function closeDatabase() {
  const sqlite = _sqlite;
  if (sqlite) {
    for (const hook of beforeCloseHooks) hook();
    // With journal_mode=WAL + synchronous=NORMAL, committed transactions live
    // in the -wal file and only become durable across an OS crash/power loss
    // after a checkpoint. Fold the WAL back into the main db on shutdown so the
    // most recent writes (threads/messages the user just made) are not at risk
    // if `close()`'s implicit checkpoint is skipped on an unclean exit.
    try {
      sqlite.pragma("wal_checkpoint(TRUNCATE)");
    } catch (error) {
      console.error("[db] wal_checkpoint on close failed:", error);
    }
    sqlite.close();
  }
  _sqlite = undefined;
  resetMainCreatedThreads();
}
