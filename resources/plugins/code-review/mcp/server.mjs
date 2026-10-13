// code-review: stdio MCP server exposing the TS code-index as tools an agent can call.
// Wraps index-core.mjs (web-tree-sitter symbol/call-graph index + better-sqlite3).
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import {
  indexProject,
  openReviewDb,
  listFiles,
  listFunctions,
  getFunction,
  getCallGraph,
} from "./index-core.mjs";

const server = new McpServer({
  name: "code-review-index",
  version: "0.1.0",
});

server.registerTool(
  "index_project",
  {
    title: "Index a code directory",
    description:
      "Parse a C/C++ source tree with tree-sitter (WASM) into a symbol and call-graph index, " +
      "persisted to a better-sqlite3 review db. Returns the task id and counts. " +
      "Required first step before any code-review queries.",
    inputSchema: z.object({
      rootDir: z.string().describe("Absolute path to the code directory to index"),
      dbPath: z.string().describe("Absolute path of the review sqlite db to write"),
      maxFiles: z.number().int().positive().optional().describe("Cap on files scanned (default 2000)"),
    }),
  },
  async ({ rootDir, dbPath, maxFiles }) => {
    const r = await indexProject({ rootDir, dbPath, maxFiles });
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  },
);

server.registerTool(
  "list_files",
  {
    title: "List indexed files",
    description: "List files that were indexed for a task.",
    inputSchema: z.object({
      dbPath: z.string(),
      taskId: z.string(),
    }),
  },
  ({ dbPath, taskId }) => {
    const db = openReviewDb(dbPath);
    try {
      const files = listFiles(db, taskId);
      return { content: [{ type: "text", text: JSON.stringify(files) }] };
    } finally {
      db.close();
    }
  },
);

server.registerTool(
  "list_functions",
  {
    title: "List indexed functions",
    description:
      "List functions in an indexed project. Optionally filter by fileId or exact name. " +
      "Use fileId/function ids from this tool as inputs to get_function / get_call_graph.",
    inputSchema: z.object({
      dbPath: z.string(),
      taskId: z.string(),
      fileId: z.number().int().optional(),
      name: z.string().optional(),
    }),
  },
  ({ dbPath, taskId, fileId, name }) => {
    const db = openReviewDb(dbPath);
    try {
      const functions = listFunctions(db, taskId, { fileId, name });
      return { content: [{ type: "text", text: JSON.stringify(functions) }] };
    } finally {
      db.close();
    }
  },
);

server.registerTool(
  "get_function",
  {
    title: "Get a function's source",
    description: "Return full detail of one function including its source code and file path.",
    inputSchema: z.object({
      dbPath: z.string(),
      functionId: z.number().int(),
    }),
  },
  ({ dbPath, functionId }) => {
    const db = openReviewDb(dbPath);
    try {
      const fn = getFunction(db, functionId);
      if (!fn) return { content: [{ type: "text", text: "function not found" }] };
      return { content: [{ type: "text", text: JSON.stringify(fn, null, 2) }] };
    } finally {
      db.close();
    }
  },
);

server.registerTool(
  "get_call_graph",
  {
    title: "Get a function's call graph",
    description:
      "Return what a function calls (callees) and what calls it (callers). " +
      "callee_id/caller_id null means an external or out-of-project symbol.",
    inputSchema: z.object({
      dbPath: z.string(),
      functionId: z.number().int(),
    }),
  },
  ({ dbPath, functionId }) => {
    const db = openReviewDb(dbPath);
    try {
      const g = getCallGraph(db, functionId);
      return { content: [{ type: "text", text: JSON.stringify(g, null, 2) }] };
    } finally {
      db.close();
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
