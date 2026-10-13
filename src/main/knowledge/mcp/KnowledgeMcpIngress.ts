import type { AgentEmployeePaths } from "@/shared/agentemployeePaths";
import {
  StreamableHttpMcpIngress,
  type StreamableHttpMcpIngressInfo,
} from "../../mcp/StreamableHttpMcpIngress";
import {
  KNOWLEDGE_MCP_INSTRUCTIONS,
  KNOWLEDGE_MCP_SERVER_INFO,
  TOOLS,
  dispatchTool,
  formatToolResult,
  isKnownToolName,
  type KnowledgeToolContext,
} from "./toolRegistry";

export type KnowledgeMcpIngressInfo = StreamableHttpMcpIngressInfo;

/**
 * In-process MCP server exposing read/search tools over the machine-wide
 * knowledge base. Mirrors `AppControlsMcpIngress`: binds `0.0.0.0` so WSL agents
 * can reach it via the host gateway, and is handed to the supervisor via env.
 */
export class KnowledgeMcpIngress {
  private readonly ingress: StreamableHttpMcpIngress<KnowledgeToolContext>;

  constructor(deps: { requireAgentEmployeePaths(): AgentEmployeePaths }) {
    this.ingress = new StreamableHttpMcpIngress<KnowledgeToolContext>({
      serverInfo: { ...KNOWLEDGE_MCP_SERVER_INFO },
      instructions: KNOWLEDGE_MCP_INSTRUCTIONS,
      tools: TOOLS,
      isKnownToolName,
      buildContext: (identity) => ({
        requireAgentEmployeePaths: deps.requireAgentEmployeePaths,
        ...(identity.kb ? { baseId: identity.kb } : {}),
      }),
      dispatchTool,
      formatToolResult,
    });
  }

  start(): Promise<KnowledgeMcpIngressInfo> {
    return this.ingress.start();
  }

  getInfo(): KnowledgeMcpIngressInfo | null {
    return this.ingress.getInfo();
  }

  dispose(): void {
    this.ingress.dispose();
  }
}
