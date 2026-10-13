import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WslHostAccessResolver } from "@/supervisor/wsl/hostAccess";
import {
  KNOWLEDGE_MCP_TOKEN_ENV,
  KNOWLEDGE_MCP_URL_ENV,
  resolveKnowledgeMcpHttpConfig,
  resolveKnowledgeMcpHttpConfigForLaunch,
} from "./index";

beforeEach(() => {
  process.env[KNOWLEDGE_MCP_URL_ENV] = "http://127.0.0.1:4567";
  process.env[KNOWLEDGE_MCP_TOKEN_ENV] = "secret";
});

afterEach(() => {
  delete process.env[KNOWLEDGE_MCP_URL_ENV];
  delete process.env[KNOWLEDGE_MCP_TOKEN_ENV];
});

describe("resolveKnowledgeMcpHttpConfig", () => {
  it("builds an http config for native locations", () => {
    const config = resolveKnowledgeMcpHttpConfig({ kind: "windows" });
    expect(config?.url).toBe("http://127.0.0.1:4567/mcp");
    expect(config?.headers.Authorization).toBe("Bearer secret");
  });

  it("declines for WSL without host access", () => {
    expect(resolveKnowledgeMcpHttpConfig({ kind: "wsl", distro: "Ubuntu" })).toBeNull();
  });

  it("encodes the bound knowledge base id into the URL", () => {
    const config = resolveKnowledgeMcpHttpConfig({ kind: "windows" }, { kb: "radar-1a2b" });
    expect(config?.url).toBe("http://127.0.0.1:4567/mcp?kb=radar-1a2b");
  });
});

describe("resolveKnowledgeMcpHttpConfigForLaunch", () => {
  it("rewrites the host to the gateway IP for NAT WSL", async () => {
    const hostAccess: WslHostAccessResolver = {
      resolveHostAccess: async () => ({ kind: "gateway", ip: "172.20.0.1" }),
    };
    const config = await resolveKnowledgeMcpHttpConfigForLaunch(
      { kind: "wsl", distro: "Ubuntu" },
      hostAccess,
    );
    expect(config?.url).toBe("http://172.20.0.1:4567/mcp");
  });

  it("keeps loopback for mirrored WSL", async () => {
    const hostAccess: WslHostAccessResolver = {
      resolveHostAccess: async () => ({ kind: "loopback" }),
    };
    const config = await resolveKnowledgeMcpHttpConfigForLaunch(
      { kind: "wsl", distro: "Ubuntu" },
      hostAccess,
    );
    expect(config?.url).toBe("http://127.0.0.1:4567/mcp");
  });

  it("declines when the distro is unreachable", async () => {
    const hostAccess: WslHostAccessResolver = { resolveHostAccess: async () => undefined };
    expect(
      await resolveKnowledgeMcpHttpConfigForLaunch({ kind: "wsl", distro: "Ubuntu" }, hostAccess),
    ).toBeUndefined();
  });
});
