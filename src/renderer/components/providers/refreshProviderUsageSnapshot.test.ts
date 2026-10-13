import type { UsageSnapshot } from "@agentemployee/agents-usage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { refreshAndMergeProviderUsage } from "./refreshProviderUsageSnapshot";

const refreshProviderUsage = vi.hoisted(() =>
  vi.fn<() => Promise<{ snapshots: UsageSnapshot[]; fromCache: boolean }>>(),
);

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    refreshProviderUsage,
  }),
}));

function okSnapshot(providerId: string): UsageSnapshot {
  return {
    providerId,
    status: "ok",
    plan: "Pro",
    windows: [{ id: "session-5h", label: "Session", usedPercent: 12, resetsAt: 2 }],
    fetchedAt: 2,
  } as UsageSnapshot;
}

describe("refreshAndMergeProviderUsage", () => {
  beforeEach(() => {
    refreshProviderUsage.mockReset();
    useProviderUsageStore.setState({ snapshots: {} });
  });

  it("merges the refreshed provider snapshot into the store", async () => {
    refreshProviderUsage.mockResolvedValue({
      snapshots: [okSnapshot("gdsAgent")],
      fromCache: false,
    });

    await refreshAndMergeProviderUsage("gdsAgent");

    expect(refreshProviderUsage).toHaveBeenCalledWith({
      providerIds: ["gdsAgent"],
      force: true,
    });
    expect(useProviderUsageStore.getState().snapshots.gdsAgent?.plan).toBe("Pro");
  });

  it("swallows refresh failures so callers can fire-and-forget", async () => {
    refreshProviderUsage.mockRejectedValue(new Error("offline"));

    await expect(refreshAndMergeProviderUsage("codex")).resolves.toBeUndefined();
  });
});
