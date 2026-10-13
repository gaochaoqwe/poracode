import type { ProjectLocation } from "@/shared/contracts";
import { encodeThreadQuery, type McpThreadIdentity } from "@/shared/browserMcpThread";
import type { WslHostAccessResolver } from "@/supervisor/wsl/hostAccess";

export type KnowledgeMcpLocation =
  | ProjectLocation
  | { kind: "windows" }
  | { kind: "posix" }
  | { kind: "wsl"; distro: string };

export interface KnowledgeMcpHttpConfig {
  url: string;
  token: string;
  headers: Record<string, string>;
}

export const KNOWLEDGE_MCP_URL_ENV = "AGENTEMPLOYEE_KB_MCP_URL";
export const KNOWLEDGE_MCP_TOKEN_ENV = "AGENTEMPLOYEE_KB_MCP_TOKEN";

export function resolveKnowledgeMcpHttpConfig(
  location: KnowledgeMcpLocation,
  identity?: McpThreadIdentity,
): KnowledgeMcpHttpConfig | null {
  const url = process.env[KNOWLEDGE_MCP_URL_ENV];
  const token = process.env[KNOWLEDGE_MCP_TOKEN_ENV];
  if (!url || !token || location.kind === "wsl") return null;
  return createConfig(encodeThreadQuery(`${url.replace(/\/$/u, "")}/mcp`, identity), token);
}

/**
 * WSL-aware resolution: WSL agents can't reach the host's loopback, so rewrite
 * the URL to the host-gateway IP the same way the app-controls server does.
 */
export async function resolveKnowledgeMcpHttpConfigForLaunch(
  location: KnowledgeMcpLocation,
  hostAccess: WslHostAccessResolver | undefined,
  identity?: McpThreadIdentity,
): Promise<KnowledgeMcpHttpConfig | undefined> {
  if (location.kind !== "wsl") {
    return resolveKnowledgeMcpHttpConfig(location, identity) ?? undefined;
  }
  const url = process.env[KNOWLEDGE_MCP_URL_ENV];
  const token = process.env[KNOWLEDGE_MCP_TOKEN_ENV];
  if (!url || !token || !hostAccess) return undefined;
  const access = await hostAccess.resolveHostAccess(location.distro);
  if (!access) return undefined;
  const nativeUrl = encodeThreadQuery(`${url.replace(/\/$/u, "")}/mcp`, identity);
  if (access.kind === "loopback") return createConfig(nativeUrl, token);
  const parsed = new URL(nativeUrl);
  parsed.hostname = access.ip;
  return createConfig(parsed.toString(), token);
}

function createConfig(url: string, token: string): KnowledgeMcpHttpConfig {
  return { url, token, headers: { Authorization: `Bearer ${token}` } };
}
