import { describe, expect, it } from "vitest";
import type { UsageSnapshot, UsageStatus, UsageWindow } from "@agentemployee/agents-usage";
import type { AgentInstanceConfigMap } from "@/shared/contracts";
import {
  hasRailUsage,
  needsBrowserSessionForUsage,
  pickUsageRings,
  supportsApiKeyLogin,
  supportsBrowserLogin,
  usageProvidersForAgentInstances,
  usageRingGroups,
} from "./usageProviders";

const agentInstances: AgentInstanceConfigMap = {
  yieldmo: {
    id: "yieldmo",
    driver: "cursor",
    displayName: "Work",
    environment: { CURSOR_API_KEY: { value: "lc-safe:encrypted", sensitive: true } },
  },
};

describe("usageProviders", () => {
  it("derives API-key login support from provider descriptors", () => {
    expect(supportsApiKeyLogin("zai")).toBe(true);
    expect(supportsApiKeyLogin("kimi")).toBe(true);
    expect(supportsApiKeyLogin("qwen")).toBe(true);
    expect(supportsApiKeyLogin("qoder")).toBe(true);
    expect(supportsApiKeyLogin("grok")).toBe(false);
    expect(supportsBrowserLogin("qwen")).toBe(true);
    expect(supportsBrowserLogin("qoder")).toBe(true);
  });

  it("identifies providers whose empty local snapshot still needs browser usage auth", () => {
    expect(needsBrowserSessionForUsage("opencode")).toBe(true);
    expect(needsBrowserSessionForUsage("grok")).toBe(false);
  });

  it("adds Cursor profile providers after the base Cursor provider", () => {
    const providers = usageProvidersForAgentInstances(agentInstances);
    const cursorIndex = providers.findIndex((provider) => provider.id === "cursor");

    expect(providers.slice(cursorIndex, cursorIndex + 2).map((provider) => provider.id)).toEqual([
      "cursor",
      "cursor:yieldmo",
    ]);
    expect(providers.find((provider) => provider.id === "cursor:yieldmo")?.label).toBe(
      "Cursor Work",
    );
    expect(providers.find((provider) => provider.id === "cursor:yieldmo")?.sharedWindowReset).toBe(
      true,
    );
  });

  it("rings z.ai with the 5h window only when there is no weekly (MCP/monthly stays off the ring)", () => {
    const windows: UsageWindow[] = [
      { id: "session-5h", label: "Session (5h)", usedPercent: 0 },
      { id: "monthly", label: "MCP", usedPercent: 2 },
    ];
    const rings = pickUsageRings("zai", windows);
    expect(rings.outer?.id).toBe("session-5h");
    expect(rings.inner).toBeUndefined();
  });

  it("rings z.ai with 5h + weekly when a weekly window is present, never the monthly MCP window", () => {
    const windows: UsageWindow[] = [
      { id: "session-5h", label: "Session (5h)", usedPercent: 25 },
      { id: "weekly", label: "Weekly", usedPercent: 9 },
      { id: "monthly", label: "MCP", usedPercent: 22 },
    ];
    const rings = pickUsageRings("zai", windows);
    expect(rings.outer?.id).toBe("session-5h");
    expect(rings.inner?.id).toBe("weekly");
  });

  it("rings Kimi with the 5h rate limit outside and the weekly quota inside", () => {
    const windows: UsageWindow[] = [
      { id: "weekly", label: "Weekly", usedPercent: 10 },
      { id: "session-5h", label: "Session (5h)", usedPercent: 70 },
    ];
    const rings = pickUsageRings("kimi", windows);
    expect(rings.outer?.id).toBe("session-5h");
    expect(rings.inner?.id).toBe("weekly");
  });

  it("rings Muse Code with the 5h window outside and the weekly quota inside", () => {
    const windows: UsageWindow[] = [
      { id: "weekly", label: "Weekly", usedPercent: 10 },
      { id: "session-5h", label: "Session (5h)", usedPercent: 70 },
    ];
    const rings = pickUsageRings("muse", windows);
    expect(rings.outer?.id).toBe("session-5h");
    expect(rings.inner?.id).toBe("weekly");
  });

  it("rings Alibaba Token Plan with the 5h quota outside and weekly quota inside", () => {
    const windows: UsageWindow[] = [
      { id: "monthly", label: "Monthly", usedPercent: 5 },
      { id: "weekly", label: "Weekly", usedPercent: 10 },
      { id: "session-5h", label: "Session (5h)", usedPercent: 70 },
    ];
    const rings = pickUsageRings("qwen", windows);
    expect(rings.outer?.id).toBe("session-5h");
    expect(rings.inner?.id).toBe("weekly");
  });

  it("rings Qoder with the monthly credits window", () => {
    const windows: UsageWindow[] = [
      { id: "monthly", label: "Credits", usedPercent: 45, unit: "credits" },
    ];
    const rings = pickUsageRings("qoder", windows);
    expect(rings.outer?.id).toBe("monthly");
  });

  describe("Antigravity ring groups", () => {
    const windows: UsageWindow[] = [
      { id: "antigravity:gemini:session-5h", label: "Gemini · 5h", usedPercent: 60 },
      { id: "antigravity:gemini:weekly", label: "Gemini · Weekly", usedPercent: 11 },
      { id: "antigravity:gdsAgent:session-5h", label: "GdsAgent · 5h", usedPercent: 0 },
      { id: "antigravity:gdsAgent:weekly", label: "GdsAgent · Weekly", usedPercent: 0 },
    ];

    it("exposes the Gemini and GdsAgent+GPT swap groups", () => {
      expect(usageRingGroups("antigravity").map((g) => g.key)).toEqual(["gemini", "gdsAgent"]);
      expect(usageRingGroups("gdsAgent")).toEqual([]);
    });

    it("defaults to the Gemini group (5h outer, weekly inner)", () => {
      const rings = pickUsageRings("antigravity", windows);
      expect(rings.outer?.id).toBe("antigravity:gemini:session-5h");
      expect(rings.inner?.id).toBe("antigravity:gemini:weekly");
    });

    it("swaps to the GdsAgent group when selected", () => {
      const rings = pickUsageRings("antigravity", windows, "gdsAgent");
      expect(rings.outer?.id).toBe("antigravity:gdsAgent:session-5h");
      expect(rings.inner?.id).toBe("antigravity:gdsAgent:weekly");
    });

    it("falls back to the most-constrained window when the selected group is absent", () => {
      const onlyGdsAgent = windows.filter((w) => w.id.startsWith("antigravity:gdsAgent"));
      // Selecting the Gemini group but only GdsAgent windows are present.
      const rings = pickUsageRings("antigravity", onlyGdsAgent, "gemini");
      expect(rings.outer?.id).toBe("antigravity:gdsAgent:session-5h");
      expect(rings.inner).toBeUndefined();
    });
  });
});

describe("hasRailUsage", () => {
  const snapshot = (status: UsageStatus): UsageSnapshot => ({
    providerId: "kimi",
    status,
    windows: [],
    fetchedAt: 0,
  });

  // Signed-out and usage-less providers belong in Settings, not the rail;
  // everything else is readable now or recovers on its own. `undefined` keeps a
  // cold start from painting an empty rail.
  it.each<[UsageStatus | "pending", boolean]>([
    ["ok", true],
    ["app-not-running", true],
    ["rate-limited", true],
    ["quota-hit", true],
    ["error", true],
    ["pending", true],
    ["auth-missing", false],
    ["unsupported", false],
  ])("keeps %s in the rail: %s", (status, expected) => {
    expect(hasRailUsage(status === "pending" ? undefined : snapshot(status))).toBe(expected);
  });
});
