import { describe, expect, it } from "vitest";
import { applySettingsWritePatch } from "./applySettingsWritePatch";
import type { SharedSettings } from "@/shared/settings";

const base = {
  teams: [
    { id: "t1", name: "old", memberEmployeeIds: [], dispatchPolicy: "round-robin", createdAt: "1" },
  ],
  workspaces: [{ id: "w1", name: "old", createdAt: "1", icon: "briefcase" }],
} as unknown as SharedSettings;

describe("applySettingsWritePatch", () => {
  it("overlays arrays and the steward id without touching other keys", () => {
    const next = applySettingsWritePatch(base, {
      teams: [{ id: "t2" } as never],
      chiefStewardWorkspaceId: "w1",
    });
    expect(next.teams).toHaveLength(1);
    expect((next.teams[0] as { id: string }).id).toBe("t2");
    expect(next.workspaces).toBe(base.workspaces);
    expect(next.chiefStewardWorkspaceId).toBe("w1");
  });

  it("null steward id clears the assignment", () => {
    const seeded = { ...base, chiefStewardWorkspaceId: "w1" };
    const next = applySettingsWritePatch(seeded, { chiefStewardWorkspaceId: null });
    expect(next.chiefStewardWorkspaceId).toBeUndefined();
  });

  it("empty patch leaves the settings untouched", () => {
    expect(applySettingsWritePatch(base, {} as never)).toBe(base);
  });
});
