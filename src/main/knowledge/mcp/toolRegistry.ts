import { relative } from "node:path";
import type { AgentEmployeePaths } from "@/shared/agentemployeePaths";
import type {
  StreamableHttpMcpToolResult,
  StreamableHttpMcpToolSpec,
} from "../../mcp/StreamableHttpMcpIngress";
import { ensureKnowledgeProject, listKnowledgeTree, readKnowledgeFile } from "../knowledgeStore";
import { searchKnowledge } from "./search";

/** Main-side seam the knowledge MCP server acts through. */
export interface KnowledgeToolContext {
  requireAgentEmployeePaths(): AgentEmployeePaths;
  /** The knowledge base this thread is bound to (from the launch URL `?kb=`). */
  baseId?: string;
}

function requireBaseId(ctx: KnowledgeToolContext): string {
  if (!ctx.baseId) throw new Error("No knowledge base is bound to this thread.");
  return ctx.baseId;
}

export const KNOWLEDGE_MCP_SERVER_INFO = { name: "knowledge", version: "1.0.0" } as const;

export const KNOWLEDGE_MCP_INSTRUCTIONS =
  "AgentEmployee knowledge base. A machine-wide markdown wiki the user maintains at " +
  "~/.agentemployee/knowledge. Use kb_search to find relevant pages by keyword, kb_read to read a " +
  "page (frontmatter + body; start with index.md to browse the catalog), and kb_list to list " +
  "the tree. Read-only: never write to the knowledge base, and cite the page paths you used.";

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;

type ToolHandler = (args: Record<string, unknown>, ctx: KnowledgeToolContext) => Promise<unknown>;

export const TOOLS: readonly StreamableHttpMcpToolSpec[] = [
  {
    name: "kb_list",
    description:
      "List directories and files in the knowledge base. Omit directoryPath for the root.",
    inputSchema: {
      type: "object",
      properties: {
        directoryPath: { type: "string", description: "Path relative to the KB root." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "kb_search",
    description:
      "Keyword-search the knowledge base wiki pages. Returns ranked page paths + snippets.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keywords." },
        limit: { type: "number", description: "Max results (1-50, default 20)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "kb_read",
    description:
      "Read a knowledge base page by its path relative to the KB root (e.g. wiki/index.md).",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Path relative to the KB root." } },
      required: ["path"],
      additionalProperties: false,
    },
  },
];

function clampLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SEARCH_LIMIT;
  return Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.floor(value)));
}

const HANDLERS: Record<string, ToolHandler> = {
  kb_list: async (args, ctx) => {
    const root = await ensureKnowledgeProject(ctx.requireAgentEmployeePaths(), requireBaseId(ctx));
    const directoryPath = typeof args.directoryPath === "string" ? args.directoryPath : "";
    return listKnowledgeTree(root, directoryPath);
  },
  kb_search: async (args, ctx) => {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) throw new Error("query is required");
    const root = await ensureKnowledgeProject(ctx.requireAgentEmployeePaths(), requireBaseId(ctx));
    const hits = await searchKnowledge(root, query, clampLimit(args.limit));
    return {
      query,
      results: hits.map((hit) => ({
        ...hit,
        path: relative(root, hit.path).replace(/\\/gu, "/"),
      })),
    };
  },
  kb_read: async (args, ctx) => {
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) throw new Error("path is required");
    const root = await ensureKnowledgeProject(ctx.requireAgentEmployeePaths(), requireBaseId(ctx));
    return readKnowledgeFile(root, path);
  },
};

const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));

export function isKnownToolName(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: KnowledgeToolContext,
): Promise<unknown> {
  const handler = HANDLERS[name];
  if (!handler) throw new Error(`Unknown tool: ${name}`);
  return handler(args, ctx);
}

export function formatToolResult(_name: string, result: unknown): StreamableHttpMcpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}
