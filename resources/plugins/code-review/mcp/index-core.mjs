// code-review: TS code-index core
// Uses web-tree-sitter (WASM) to parse C/C++ into a symbol/call-graph index,
// persisted to better-sqlite3. No native compilation, no VS2015, no Python.
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, relative, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Parser = require("web-tree-sitter");
const Database = require("better-sqlite3");

const C_EXT = [".c", ".h"];
const CPP_EXT = [".cpp", ".hpp", ".cc", ".cxx", ".hh"];

let _parserReady = null;
async function ensureParser() {
  if (_parserReady) return _parserReady;
  await Parser.init();
  const Language = Parser.Language;
  _parserReady = {
    c: await Language.load(join(rootNodeModules(), "tree-sitter-wasms/out/tree-sitter-c.wasm")),
    cpp: await Language.load(join(rootNodeModules(), "tree-sitter-wasms/out/tree-sitter-cpp.wasm")),
  };
  return _parserReady;
}

function rootNodeModules() {
  // walk up from this file to the project's node_modules (web-tree-sitter lives there)
  let dir = dirname(new URL(import.meta.url).pathname);
  // fallback: resolve from cwd upward
  for (;;) {
    const nm = join(dir, "node_modules");
    if (existsSync(join(nm, "web-tree-sitter"))) return nm;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return join(process.cwd(), "node_modules");
}

function collectFiles(rootDir) {
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        walk(full);
      } else if (C_EXT.includes(extname(name)) || CPP_EXT.includes(extname(name))) {
        files.push(full);
      }
    }
  };
  walk(rootDir);
  return files;
}

export async function indexProject({ rootDir, dbPath, mode = "function", maxFiles = 2000 }) {
  const langs = await ensureParser();
  const files = collectFiles(rootDir).slice(0, maxFiles);
  if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, mode TEXT NOT NULL, root_dir TEXT NOT NULL,
      status TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
      path TEXT NOT NULL, language TEXT NOT NULL, UNIQUE(task_id, path)
    );
    CREATE TABLE IF NOT EXISTS functions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
      file_id INTEGER NOT NULL, name TEXT NOT NULL,
      start_line INTEGER NOT NULL, end_line INTEGER NOT NULL,
      source_code TEXT NOT NULL, description TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_fn_name ON functions(task_id, name);
    CREATE TABLE IF NOT EXISTS call_edges (
      caller_id INTEGER NOT NULL REFERENCES functions(id),
      callee_name TEXT NOT NULL, callee_id INTEGER,
      file_id INTEGER NOT NULL, line INTEGER NOT NULL
    );
  `);

  const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  db.prepare("INSERT INTO tasks VALUES (?,?,?,?,?)").run(taskId, mode, rootDir, "indexed", new Date().toISOString());
  const insFile = db.prepare("INSERT INTO files (task_id,path,language) VALUES (?,?,?)");
  const insFn = db.prepare(
    "INSERT INTO functions (task_id,file_id,name,start_line,end_line,source_code) VALUES (?,?,?,?,?,?)",
  );
  const insEdge = db.prepare(
    "INSERT INTO call_edges (caller_id,callee_name,callee_id,file_id,line) VALUES (?,?,?,?,?)",
  );

  let nFiles = 0, nFuncs = 0, nEdges = 0;

  // Parse every file once and keep the handles for the two passes below.
  const parsedFiles = [];
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    const isCpp = CPP_EXT.includes(ext);
    const lang = isCpp ? langs.cpp : langs.c;
    const parser = new Parser();
    parser.setLanguage(lang);

    let code;
    try { code = readFileSync(file, "utf8"); } catch { continue; }
    const tree = parser.parse(code);
    const root = tree.rootNode;

    const fileId = Number(insFile.run(taskId, relative(rootDir, file).replace(/\\/g, "/"), isCpp ? "cpp" : "c").lastInsertRowid);
    nFiles++;
    parsedFiles.push({ file, fileId, root, lang, code });
  }

  // Pass 1: index every function and build a *project-wide* name->id map so a
  // caller in one file can resolve a callee defined in another file (essential
  // for chain/feature review call graphs across translation units).
  const nameToId = new Map();
  for (const p of parsedFiles) {
    const fnQuery = p.lang.query("(function_definition) @func");
    const fnNameQuery = p.lang.query("(function_definition declarator: (function_declarator declarator: (identifier) @name))");
    for (const cap of fnQuery.captures(p.root)) {
      const node = cap.node;
      const name = fnNameOf(fnNameQuery, node) || "anon";
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;
      const src = p.code.slice(node.startIndex, node.endIndex);
      const id = Number(insFn.run(taskId, p.fileId, name, startLine, endLine, src).lastInsertRowid);
      nameToId.set(name, id);
      nFuncs++;
    }
  }

  // Pass 2: call edges, resolving callees against the project-wide map.
  for (const p of parsedFiles) {
    const fnQuery = p.lang.query("(function_definition) @func");
    const callQuery = p.lang.query("(call_expression function: (identifier) @callee)");
    const fnNameQuery = p.lang.query("(function_definition declarator: (function_declarator declarator: (identifier) @name))");
    for (const cap of fnQuery.captures(p.root)) {
      const node = cap.node;
      const callerName = fnNameOf(fnNameQuery, node) || "anon";
      const callerId = nameToId.get(callerName);
      if (!callerId) continue;
      for (const ccap of callQuery.captures(node)) {
        const callee = ccap.node.text;
        const line = ccap.node.startPosition.row + 1;
        insEdge.run(callerId, callee, nameToId.get(callee) ?? null, p.fileId, line);
        nEdges++;
      }
    }
  }

  db.close();
  return { taskId, files: nFiles, functions: nFuncs, callEdges: nEdges, rootDir };
}

function fnNameOf(q, node) {
  for (const cap of q.captures(node)) return cap.node.text;
  return "";
}

// ---- query helpers (used by the MCP server) ----

/** Open a review db read-only. */
export function openReviewDb(dbPath) {
  if (!existsSync(dbPath)) throw new Error(`review db not found: ${dbPath}`);
  return new Database(dbPath, { readonly: true });
}

/** List indexed files for a task. */
export function listFiles(db, taskId) {
  return db.prepare("SELECT id, path, language FROM files WHERE task_id = ? ORDER BY path").all(taskId);
}

/** List functions for a task (optionally filtered by fileId or name). */
export function listFunctions(db, taskId, { fileId, name } = {}) {
  let sql = "SELECT id, file_id, name, start_line, end_line FROM functions WHERE task_id = ?";
  const args = [taskId];
  if (fileId) { sql += " AND file_id = ?"; args.push(fileId); }
  if (name) { sql += " AND name = ?"; args.push(name); }
  return db.prepare(sql + " ORDER BY file_id, start_line").all(...args);
}

/** Full detail of one function, including source code. */
export function getFunction(db, functionId) {
  const fn = db.prepare("SELECT * FROM functions WHERE id = ?").get(functionId);
  if (!fn) return null;
  const file = db.prepare("SELECT path FROM files WHERE id = ?").get(fn.file_id);
  return { ...fn, path: file ? file.path : null };
}

/** Call graph for a function: who it calls, and who calls it. */
export function getCallGraph(db, functionId) {
  const callees = db.prepare(
    "SELECT callee_name, callee_id, line FROM call_edges WHERE caller_id = ? ORDER BY line",
  ).all(functionId);
  const callers = db.prepare(
    "SELECT e.caller_id, f.name AS caller_name, e.line FROM call_edges e JOIN functions f ON f.id = e.caller_id WHERE e.callee_id = ? ORDER BY e.line",
  ).all(functionId);
  return { callees, callers };
}

/** Number of indexed tasks/files/functions for a db. */
export function dbStats(db) {
  return {
    tasks: db.prepare("SELECT COUNT(*) AS n FROM tasks").get().n,
    files: db.prepare("SELECT COUNT(*) AS n FROM files").get().n,
    functions: db.prepare("SELECT COUNT(*) AS n FROM functions").get().n,
    edges: db.prepare("SELECT COUNT(*) AS n FROM call_edges").get().n,
  };
}

// CLI self-test
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rootDir = process.argv[2] || join(process.cwd(), "tmp/sample_nav");
  const dbPath = process.argv[3] || join(process.cwd(), "tmp/review.db");
  indexProject({ rootDir, dbPath }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    const db = new Database(dbPath, { readonly: true });
    console.log("--- functions ---");
    for (const row of db.prepare("SELECT name,start_line,end_line FROM functions").all())
      console.log(row);
    console.log("--- call edges ---");
    for (const row of db.prepare("SELECT caller_id,callee_name,callee_id,line FROM call_edges").all())
      console.log(row);
    db.close();
  }).catch((e) => { require("node:fs").writeFileSync(join(process.cwd(), "tmp/index_err.txt"), (e && e.stack) || String(e)); console.error(e); process.exit(1); });
}
