import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { HOME_PROJECT_ID } from "@/shared/homeScope";
import { closeDatabase, initDatabase } from "./connection";
import {
  assertRequiredDatabaseSchema,
  DATABASE_MIGRATIONS,
  LATEST_SCHEMA_VERSION,
  repairSafeSchemaDrift,
  runDatabaseMigrations,
  validateMigrationRegistry,
} from "./migrations";

describe("database migration registry", () => {
  it("keeps the published migration history append-only", () => {
    expect(DATABASE_MIGRATIONS.map(({ version, name }) => [version, name])).toEqual([
      [2, "threads.done"],
      [3, "threads.group_id"],
      [4, "threads.group_name"],
      [5, "projects.search_settings"],
      [6, "threads.starred"],
      [7, "normalize model context suffixes"],
      [8, "thread presentation"],
      [9, "thread runtime items"],
      [10, "thread runtime parent item"],
      [11, "thread turn timestamps"],
      [12, "thread completed turns"],
      [13, "projects.disabled"],
      [14, "threads.done_at"],
      [15, "thread context usage"],
      [16, "project notes"],
      [19, "usage events"],
      [20, "thread status source"],
      [21, "scheduled tasks"],
      [22, "scheduled task runs"],
      [23, "scheduled task project"],
      [24, "project MCP servers"],
      [25, "remote command receipts"],
      [26, "thread parent"],
      [27, "token usage ledger"],
      [28, "pull request watches"],
      [29, "project workspace"],
      [30, "repair empty thread models"],
      [31, "project worktree location"],
      [32, "pr watch blocked reason"],
      [33, "project GitHub account"],
      [34, "projects.icon"],
      [35, "threads.archived_at"],
      [36, "runtime item stream chunks"],
      [37, "threads.workspace_id"],
      [38, "runtime item parent index"],
      [39, "adopt Antigravity ACP provider"],
      [40, "normalize Antigravity ACP model variants"],
      [41, "repair Antigravity persisted model variants"],
      [42, "deduplicate project locations"],
      [43, "tasks"],
      [44, "fold scheduled tasks into tasks"],
      [45, "tasks.sort_order"],
      [46, "project task settings"],
      [47, "task drafts"],
      [48, "teams"],
      [49, "review_tasks.task_name"],
      [50, "task categories"],
      [51, "task employees"],
      [52, "review_issues.source_code"],
      [53, "review_features"],
    ]);
    expect(LATEST_SCHEMA_VERSION).toBe(53);
    expect(() => validateMigrationRegistry()).not.toThrow();
  });

  it("rejects duplicate, reordered, or non-integer versions", () => {
    expect(() =>
      validateMigrationRegistry([
        { version: 2, name: "first" },
        { version: 2, name: "duplicate" },
      ]),
    ).toThrow(/strictly increasing/i);
    expect(() =>
      validateMigrationRegistry([
        { version: 3, name: "first" },
        { version: 2, name: "reordered" },
      ]),
    ).toThrow(/strictly increasing/i);
    expect(() => validateMigrationRegistry([{ version: 1.5, name: "fractional" }])).toThrow(
      /integer/i,
    );
  });

  it("rejects duplicate migration names", () => {
    expect(() =>
      validateMigrationRegistry([
        { version: 2, name: "same operation" },
        { version: 3, name: "same operation" },
      ]),
    ).toThrow(/name is duplicated/i);
  });

  it.each([
    { kind: "draft", projectId: "duplicate" },
    { kind: "experiment", projectId: "duplicate", experimentId: "e1" },
    {
      kind: "thread",
      panes: ["draft:duplicate#pane-1", "thread-1"],
      paneLayout: {
        kind: "split",
        axis: "vertical",
        children: [
          { kind: "leaf", paneId: "draft:duplicate#pane-1" },
          { kind: "leaf", paneId: "thread-1" },
        ],
      },
    },
  ])(
    "upgrades a newest-first duplicate without losing settings, transcripts, or its $kind view",
    (view) => {
      const sqlite = new Database(":memory:");
      try {
        sqlite.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE projects (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, location_kind TEXT NOT NULL,
          location_path TEXT, location_distro TEXT, location_linux_path TEXT, location_unc_path TEXT,
          last_draft_config TEXT, scripts TEXT, search_settings TEXT, worktree_location TEXT,
          mcp_servers TEXT, gh_account TEXT, workspace_id TEXT, disabled INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
        );
        CREATE TABLE threads (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE);
        CREATE TABLE thread_runtime_items (thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE, content TEXT);
        CREATE TABLE project_notes (project_id TEXT PRIMARY KEY, doc TEXT, todos TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE scheduled_tasks (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL, agent_kind TEXT NOT NULL,
          config TEXT NOT NULL, recurrence TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
          project_id TEXT, next_run_at TEXT, last_run_at TEXT, last_completed_at TEXT,
          last_status TEXT NOT NULL DEFAULT 'never', last_result TEXT, last_error TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE pr_watches (
          project_id TEXT NOT NULL REFERENCES projects(id), pr_number INTEGER NOT NULL,
          PRIMARY KEY (project_id, pr_number)
        );
      `);
        const insertProject = sqlite.prepare(
          `INSERT INTO projects (id, name, location_kind, location_path, sort_order, created_at)
         VALUES (?, ?, 'posix', ?, ?, ?)`,
        );
        insertProject.run("canonical", "Canonical", "/repo", 1, "2024-01-01T00:00:00.000Z");
        insertProject.run("duplicate", "Duplicate", "/repo/", 0, "2026-01-01T00:00:00.000Z");
        insertProject.run(HOME_PROJECT_ID, "Home", "/repo", 2, "2024-01-01T00:00:00.000Z");
        const actions = [1, 2, 3, 4].map((index) => ({
          id: `action-${index}`,
          name: `Action ${index}`,
          command: `echo ${index}`,
        }));
        const originalScripts = { setupScript: "custom setup", actions };
        sqlite
          .prepare("UPDATE projects SET scripts = ? WHERE id = 'canonical'")
          .run(JSON.stringify(originalScripts));
        sqlite.prepare("UPDATE projects SET scripts = ? WHERE id = 'duplicate'").run(
          JSON.stringify({
            setupScript: "auto-detected setup",
            cleanupScript: "custom cleanup",
            actions: [],
          }),
        );
        const recoveredSettings = {
          icon: "lucide:rocket",
          mcp_servers: JSON.stringify([
            {
              id: "memory",
              name: "memory",
              enabled: false,
              description: "",
              timeoutMs: 30000,
              transport: { type: "stdio", command: "node", args: ["memory.js"], env: {} },
            },
          ]),
          search_settings: JSON.stringify({ useIgnoreFiles: false, exclude: { dist: false } }),
          gh_account: JSON.stringify({ host: "github.com", login: "original-account" }),
          worktree_location: JSON.stringify({ mode: "global", basePath: "/worktrees" }),
          last_draft_config: JSON.stringify({ agentKind: "codex", model: "auto", fast: false }),
          workspace_id: "workspace-1",
        };
        for (const [column, value] of Object.entries(recoveredSettings)) {
          sqlite.prepare(`UPDATE projects SET ${column} = ? WHERE id = 'duplicate'`).run(value);
        }
        sqlite.prepare("INSERT INTO threads VALUES (?, ?)").run("thread-1", "duplicate");
        for (const content of ["first reply", "second reply", "third reply"]) {
          sqlite.prepare("INSERT INTO thread_runtime_items VALUES (?, ?)").run("thread-1", content);
        }
        sqlite
          .prepare("INSERT INTO project_notes VALUES (?, ?, ?, ?)")
          .run("duplicate", "notes", "[]", "2026-01-01T00:00:00.000Z");
        sqlite
          .prepare("INSERT INTO project_notes VALUES (?, ?, ?, ?)")
          .run("canonical", null, "[]", "2026-01-01T00:00:00.000Z");
        sqlite
          .prepare(
            `INSERT INTO scheduled_tasks (
               id, name, prompt, agent_kind, config, recurrence, enabled, project_id,
               last_status, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "schedule-1",
            "Schedule",
            "Do it",
            "codex",
            "{}",
            '{"kind":"hourly","minute":0}',
            1,
            "duplicate",
            "never",
            "2024-01-01T00:00:00.000Z",
            "2024-01-01T00:00:00.000Z",
          );
        sqlite.prepare("INSERT INTO pr_watches VALUES (?, ?)").run("duplicate", 7);
        sqlite.prepare("INSERT INTO app_state VALUES (?, ?)").run("view", JSON.stringify(view));
        const groupLayouts = {
          group1: {
            panes: ["draft:duplicate#pane-2"],
            paneLayout: { kind: "leaf", paneId: "draft:duplicate#pane-2" },
          },
        };
        sqlite
          .prepare("INSERT INTO app_state VALUES (?, ?)")
          .run("groupLayouts", JSON.stringify(groupLayouts));
        sqlite.prepare("INSERT INTO app_state VALUES (?, ?)").run(
          "agentemployee-experiments-v1",
          JSON.stringify({
            state: { experiments: { e1: { projectId: "duplicate" } } },
            version: 1,
          }),
        );

        runDatabaseMigrations(sqlite, 41);

        expect(sqlite.prepare("SELECT id FROM projects ORDER BY id").all()).toEqual([
          { id: HOME_PROJECT_ID },
          { id: "canonical" },
        ]);
        expect(
          sqlite.prepare("SELECT content FROM thread_runtime_items ORDER BY rowid").all(),
        ).toEqual(["first reply", "second reply", "third reply"].map((content) => ({ content })));
        const survivor = sqlite
          .prepare("SELECT * FROM projects WHERE id = 'canonical'")
          .get() as Record<string, unknown>;
        expect(JSON.parse(survivor.scripts as string)).toEqual({
          ...originalScripts,
          cleanupScript: "custom cleanup",
        });
        expect(survivor).toMatchObject(recoveredSettings);
        for (const [key, original] of Object.entries({ view, groupLayouts })) {
          const persisted = sqlite
            .prepare("SELECT value FROM app_state WHERE key = ?")
            .get(key) as {
            value: string;
          };
          expect(JSON.parse(persisted.value)).toEqual(
            JSON.parse(JSON.stringify(original).replaceAll("duplicate", "canonical")),
          );
        }
        expect(sqlite.prepare("SELECT project_id FROM threads").get()).toEqual({
          project_id: "canonical",
        });
        expect(sqlite.prepare("SELECT project_id FROM project_notes").get()).toEqual({
          project_id: "canonical",
        });
        expect(sqlite.prepare("SELECT doc FROM project_notes").get()).toEqual({ doc: "notes" });
        expect(sqlite.prepare("SELECT project_id FROM tasks").get()).toEqual({
          project_id: "canonical",
        });
        expect(sqlite.prepare("SELECT project_id FROM pr_watches").get()).toEqual({
          project_id: "canonical",
        });
        expect(
          JSON.parse(
            (
              sqlite
                .prepare("SELECT value FROM app_state WHERE key = ?")
                .get("agentemployee-experiments-v1") as { value: string }
            ).value,
          ).state.experiments.e1.projectId,
        ).toBe("canonical");
      } finally {
        sqlite.close();
      }
    },
  );

  it("folds scheduled tasks and their runs into the task board (v44)", () => {
    const sqlite = new Database(":memory:");
    try {
      sqlite.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE scheduled_tasks (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL, agent_kind TEXT NOT NULL,
          config TEXT NOT NULL, recurrence TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
          project_id TEXT, next_run_at TEXT, last_run_at TEXT, last_completed_at TEXT,
          last_status TEXT NOT NULL DEFAULT 'never', last_result TEXT, last_error TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE scheduled_task_runs (
          id TEXT PRIMARY KEY,
          schedule_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
          thread_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT,
          status TEXT NOT NULL, summary TEXT, error TEXT
        );
      `);
      const insertSchedule = sqlite.prepare(
        `INSERT INTO scheduled_tasks (
           id, name, prompt, agent_kind, config, recurrence, enabled, project_id,
           next_run_at, last_status, last_result, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      );
      // A recurring schedule that last succeeded: stays actionable → todo.
      insertSchedule.run(
        "recurring",
        "Nightly brief",
        "Summarize",
        "codex",
        "{}",
        '{"kind":"hourly","minute":0}',
        1,
        "2026-07-11T00:00:00.000Z",
        "succeeded",
        "",
        "2026-01-01T00:00:00.000Z",
        "2026-07-01T00:00:00.000Z",
      );
      // A one-off that failed terminally → failed lane.
      insertSchedule.run(
        "once-failed",
        "One shot",
        "Do it",
        "codex",
        "{}",
        '{"kind":"once","runAt":"2026-07-01T00:00:00.000Z"}',
        0,
        null,
        "failed",
        null,
        "2026-01-01T00:00:00.000Z",
        "2026-07-01T00:00:00.000Z",
      );
      const insertRun = sqlite.prepare(
        `INSERT INTO scheduled_task_runs (
           id, schedule_id, thread_id, started_at, completed_at, status, summary, error
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
      );
      insertRun.run(
        "r1",
        "recurring",
        "thread-old",
        "2026-06-01T00:00:00.000Z",
        "2026-06-01T01:00:00.000Z",
        "succeeded",
      );
      insertRun.run("r2", "recurring", "thread-new", "2026-07-01T00:00:00.000Z", null, "running");
      insertRun.run(
        "r3",
        "once-failed",
        "thread-fail",
        "2026-07-01T00:00:00.000Z",
        "2026-07-01T00:00:10.000Z",
        "failed",
      );

      runDatabaseMigrations(sqlite, 42);

      const tasks = sqlite
        .prepare(
          "SELECT id, title, status, isolation, schedule_enabled, thread_id FROM tasks ORDER BY id",
        )
        .all();
      expect(tasks).toEqual([
        {
          id: "once-failed",
          title: "One shot",
          status: "failed",
          isolation: "project",
          schedule_enabled: 0,
          thread_id: "thread-fail",
        },
        {
          id: "recurring",
          title: "Nightly brief",
          status: "todo",
          isolation: "project",
          schedule_enabled: 1,
          thread_id: "thread-new",
        },
      ]);
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM task_runs").get()).toEqual({ n: 3 });
      expect(sqlite.prepare("SELECT task_id FROM task_runs WHERE id = 'r3'").get()).toEqual({
        task_id: "once-failed",
      });
      // The legacy tables are gone; a second pass is a harmless no-op.
      expect(
        sqlite.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'scheduled_task%'").all(),
      ).toEqual([]);
      expect(() => runDatabaseMigrations(sqlite, 44)).not.toThrow();
    } finally {
      sqlite.close();
    }
  });

  it("adds teams/team_runs on upgrade from the pre-v48 schema without touching existing rows", () => {
    const sqlite = new Database(":memory:");
    try {
      sqlite.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE projects (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, location_kind TEXT NOT NULL,
          location_path TEXT, location_distro TEXT, location_linux_path TEXT, location_unc_path TEXT,
          last_draft_config TEXT, scripts TEXT, search_settings TEXT, worktree_location TEXT,
          mcp_servers TEXT, gh_account TEXT, workspace_id TEXT, disabled INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
        );
        CREATE TABLE threads (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL, agent_kind TEXT NOT NULL, config TEXT NOT NULL,
          status TEXT NOT NULL, attention TEXT NOT NULL,
          can_resume_with_config INTEGER NOT NULL DEFAULT 0, session_ref TEXT,
          terminal_prompt TEXT, worktree_path TEXT, worktree_branch TEXT, pr_number INTEGER,
          archived INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
      `);

      // Advance the schema to the last pre-change version by running every
      // migration except the newly appended one (v48).
      for (const migration of DATABASE_MIGRATIONS.slice(0, -1)) {
        migration.migrate(sqlite);
      }

      // Legacy data that must survive the upgrade byte-for-byte.
      sqlite
        .prepare(
          `INSERT INTO projects (id, name, location_kind, sort_order, created_at)
           VALUES (?, ?, 'posix', 0, '2026-01-01T00:00:00.000Z')`,
        )
        .run("p1", "Legacy repo");
      sqlite
        .prepare(
          `INSERT INTO threads (id, project_id, title, agent_kind, config, status, attention, created_at, updated_at)
           VALUES ('th1', 'p1', 'Legacy thread', 'codex', '{}', 'ready', 'none',
                   '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        )
        .run();
      const insertTask = sqlite.prepare(
        `INSERT INTO tasks (
           id, title, prompt, agent_kind, config, project_id, isolation,
           worktree_path, worktree_branch, thread_id, recurrence, schedule_enabled,
           next_run_at, last_run_at, last_completed_at, last_status, last_result, last_error,
           status, sort_order, created_at, updated_at
         ) VALUES (?, ?, ?, 'codex', '{}', 'p1', 'project', NULL, NULL, NULL, NULL, 0,
                   NULL, NULL, NULL, 'never', NULL, NULL, ?, 0, '2026-01-01T00:00:00.000Z',
                   '2026-01-01T00:00:00.000Z')`,
      );
      insertTask.run("task-old-1", "Old task one", "Do the first thing", "todo");
      insertTask.run("task-old-2", "Old task two", "Do the second thing", "done");
      const insertRun = sqlite.prepare(
        `INSERT INTO task_runs (id, task_id, thread_id, started_at, completed_at, status, summary, error)
         VALUES (?, ?, 'th1', ?, ?, ?, NULL, NULL)`,
      );
      insertRun.run("run-old-1", "task-old-1", "2026-09-01T00:00:00.000Z", null, "running");
      insertRun.run(
        "run-old-2",
        "task-old-1",
        "2026-09-02T00:00:00.000Z",
        "2026-09-02T00:30:00.000Z",
        "succeeded",
      );

      const beforeTasks = sqlite
        .prepare(
          `SELECT id, title, prompt, agent_kind, config, project_id, isolation,
                  worktree_path, worktree_branch, thread_id, recurrence, schedule_enabled,
                  next_run_at, last_run_at, last_completed_at, last_status, last_result,
                  last_error, status, sort_order, created_at, updated_at
           FROM tasks ORDER BY id`,
        )
        .all();
      const beforeTaskRuns = sqlite.prepare("SELECT * FROM task_runs ORDER BY id").all();
      expect(beforeTasks).toHaveLength(2);
      expect(beforeTaskRuns).toHaveLength(2);

      // The profile recorded schema 49; the upgrade path runs the rest.
      sqlite.prepare("INSERT INTO app_state (key, value) VALUES ('schema_version', '49')").run();
      runDatabaseMigrations(sqlite, 49);

      const tables = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('teams', 'team_runs') ORDER BY name",
        )
        .all();
      expect(tables).toEqual([{ name: "team_runs" }, { name: "teams" }]);
      expect(
        sqlite.prepare("SELECT value FROM app_state WHERE key = 'schema_version'").get(),
      ).toEqual({ value: "53" });

      // Existing rows survive with their data intact. Compare the columns that
      // predate the newly-added ones (v50 appends `category` with a NULL
      // default), so a row's pre-upgrade values must be preserved verbatim.
      const legacyTaskColumns =
        "id, title, prompt, agent_kind, config, project_id, isolation, " +
        "worktree_path, worktree_branch, thread_id, recurrence, schedule_enabled, " +
        "next_run_at, last_run_at, last_completed_at, last_status, last_result, " +
        "last_error, status, sort_order, created_at, updated_at";
      expect(sqlite.prepare(`SELECT ${legacyTaskColumns} FROM tasks ORDER BY id`).all()).toEqual(
        beforeTasks,
      );
      expect(sqlite.prepare("SELECT * FROM task_runs ORDER BY id").all()).toEqual(beforeTaskRuns);
      // The new column lands NULL for every pre-existing row.
      expect(
        sqlite.prepare("SELECT category FROM tasks WHERE category IS NULL").all(),
      ).toHaveLength(2);
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM teams").get()).toEqual({ n: 0 });
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM team_runs").get()).toEqual({ n: 0 });

      expect(() => assertRequiredDatabaseSchema(sqlite)).not.toThrow();
      // A second pass is a harmless no-op (fresh install already at the latest).
      expect(() => runDatabaseMigrations(sqlite, 50)).not.toThrow();
    } finally {
      sqlite.close();
    }
  });
});

describe("repairSafeSchemaDrift", () => {
  it("backfills task categories when app_state already claims the latest version", () => {
    // Reproduces the field failure: a profile whose `tasks`/`task_drafts`
    // tables predate v50 while `app_state.schema_version` already claims the
    // latest version. `runDatabaseMigrations` skips every recorded version, so
    // the columns can only come back from this repair pass.
    //
    // The fixture is a real `initDatabase` schema with the two columns dropped
    // again — that way the repair runs against the genuine table shapes
    // (including every other column it touches) rather than a hand-rolled
    // approximation that drifts from the real database.
    const dir = mkdtempSync(join(tmpdir(), "poracode-category-drift-"));
    const dbPath = join(dir, "state.sqlite");
    try {
      const seeded = initDatabase(dbPath);
      seeded
        .prepare(
          `INSERT INTO tasks (
             id, title, prompt, agent_kind, config, category, status, created_at, updated_at
           ) VALUES ('t1', 'Ship it', 'Do the thing', 'codex', '{}', 'Billing', 'todo',
                     '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        )
        .run();
      // Drop the v50 columns to emulate a profile that never ran the migration
      // while still claiming the latest version.
      seeded.exec("ALTER TABLE tasks DROP COLUMN category;");
      seeded.exec("ALTER TABLE task_drafts DROP COLUMN category;");
      seeded
        .prepare("UPDATE app_state SET value = ? WHERE key = 'schema_version'")
        .run(String(LATEST_SCHEMA_VERSION));
      closeDatabase();

      const sqlite = new Database(dbPath);
      sqlite.pragma("foreign_keys = ON");
      try {
        const before = sqlite
          .prepare("PRAGMA table_info(tasks)")
          .all()
          .map((row) => (row as { name: string }).name);
        expect(before).not.toContain("category");

        repairSafeSchemaDrift(sqlite);

        const taskColumns = sqlite
          .prepare("PRAGMA table_info(tasks)")
          .all()
          .map((row) => (row as { name: string }).name);
        const draftColumns = sqlite
          .prepare("PRAGMA table_info(task_drafts)")
          .all()
          .map((row) => (row as { name: string }).name);
        expect(taskColumns).toContain("category");
        expect(draftColumns).toContain("category");

        // The repair is additive only: the pre-existing row survives, and the
        // re-added column starts NULL (the data was lost with the drop).
        expect(sqlite.prepare("SELECT id, title, category FROM tasks").all()).toEqual([
          { id: "t1", title: "Ship it", category: null },
        ]);
        expect(() => assertRequiredDatabaseSchema(sqlite)).not.toThrow();
      } finally {
        sqlite.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
