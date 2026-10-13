import { describe, expect, it } from "vitest";
import {
  deskMotionForStatus,
  munderStatusForThread,
  STATUS_COLORS,
  statusBadgeLabel,
} from "./status";
import { computeDeskSlots } from "./layout";
import { DESK_ACCENT_CYCLE, OFFICE_PALETTES, parseHexColor } from "./palette";
import { easeOutCubic, lerpPoint } from "./envelope";
import { TEAM_COLOR_CYCLE, teamColorForWorkspace, teamForWorkspace } from "./teams";
import { latestRunningToolName, toolTokenForToolName } from "./tools";
import { contextProgressSegments } from "./AgentCardStrip";
import {
  employeeWorkspaces,
  isEmployeeWorkspace,
  rankDotCount,
  regionColorForIndex,
  regionKeyForEmployee,
  UNRANKED_REGION_KEY,
} from "./hierarchy";

describe("munderStatusForThread", () => {
  it("folds real ThreadStatus into the full munder status set", () => {
    expect(munderStatusForThread("working")).toBe("working");
    expect(munderStatusForThread("launching")).toBe("thinking");
    expect(munderStatusForThread("needs_approval")).toBe("blocked");
    expect(munderStatusForThread("needs_reply")).toBe("blocked");
    expect(munderStatusForThread("error")).toBe("blocked");
    expect(munderStatusForThread("finished")).toBe("success");
    expect(munderStatusForThread("idle")).toBe("idle");
    expect(munderStatusForThread("inactive")).toBe("ghost");
  });

  it("maps statuses to the munder §3.4 token colors", () => {
    expect(STATUS_COLORS.blocked).toBe(0xff6b6b);
    expect(STATUS_COLORS.thinking).toBe(0x4ecdc4);
    expect(STATUS_COLORS.working).toBe(0xffd93d);
    expect(STATUS_COLORS.success).toBe(0x6bcf7f);
    expect(STATUS_COLORS.ghost).toBe(0xd9cfe0);
  });

  it("uses user-facing badge labels, not token names", () => {
    expect(statusBadgeLabel("blocked")).toBe("needs you");
    expect(statusBadgeLabel("waiting")).toBe("waiting");
    expect(statusBadgeLabel("typing")).toBe("your draft");
    expect(statusBadgeLabel("success")).toBe("done");
    expect(statusBadgeLabel("ghost")).toBe("away");
    expect(statusBadgeLabel("looping")).toBe("runaway");
  });
});

describe("parseHexColor", () => {
  it("parses 6-digit and 3-digit hex", () => {
    expect(parseHexColor("#FFCA54")).toBe(0xffca54);
    expect(parseHexColor("#fff")).toBe(0xffffff);
  });
  it("rejects non-hex input", () => {
    expect(parseHexColor(undefined)).toBeUndefined();
    expect(parseHexColor("red")).toBeUndefined();
    expect(parseHexColor("#12")).toBeUndefined();
  });
});

describe("office palettes", () => {
  it("ships pixel default + brutalist option", () => {
    expect(OFFICE_PALETTES.default.tile).not.toBe(OFFICE_PALETTES.default.tileDark);
    expect(OFFICE_PALETTES.default.wall).toBe(0xc9a66b);
    expect(OFFICE_PALETTES.brutalist.borderWidth).toBeGreaterThan(
      OFFICE_PALETTES.default.borderWidth,
    );
    expect(OFFICE_PALETTES.brutalist.shadowOffset).toBeGreaterThan(
      OFFICE_PALETTES.default.shadowOffset,
    );
    expect(OFFICE_PALETTES.brutalist.wallBar).toBeDefined();
    expect(OFFICE_PALETTES.default.wallBar).toBeUndefined();
    expect(DESK_ACCENT_CYCLE.length).toBeGreaterThan(0);
  });
});

describe("computeDeskSlots", () => {
  it("returns nothing for empty or degenerate floors", () => {
    expect(computeDeskSlots(0, 800, 600)).toEqual([]);
    expect(computeDeskSlots(3, 0, 600)).toEqual([]);
  });

  it("packs desks inside the padding band without overlap", () => {
    const slots = computeDeskSlots(4, 800, 600, 48);
    expect(slots).toHaveLength(4);
    for (const slot of slots) {
      expect(slot.x).toBeGreaterThanOrEqual(48);
      expect(slot.y).toBeGreaterThanOrEqual(48);
      expect(slot.x + slot.size).toBeLessThanOrEqual(800 - 48);
      expect(slot.y + slot.size).toBeLessThanOrEqual(600 - 48);
    }
    const keys = new Set(slots.map((slot) => `${slot.x},${slot.y}`));
    expect(keys.size).toBe(4);
  });
});

describe("envelope tween", () => {
  it("eases from 0 to 1 and moves points linearly", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(1 - 0.5 ** 3);
    expect(lerpPoint({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 });
  });
});

describe("deskMotionForStatus", () => {
  it("maps munder statuses to subtle per-desk motions", () => {
    expect(deskMotionForStatus("working")).toBe("working");
    expect(deskMotionForStatus("blocked")).toBe("awaiting");
    expect(deskMotionForStatus("looping")).toBe("error");
    expect(deskMotionForStatus("idle")).toBe("idle");
    expect(deskMotionForStatus("success")).toBe("idle");
  });
});

describe("teamColorForWorkspace", () => {
  const teams = [
    { id: "t1", memberEmployeeIds: ["w-a", "w-b"] },
    { id: "t2", memberEmployeeIds: ["w-c"] },
  ];
  it("returns undefined when no team contains the workspace", () => {
    expect(teamColorForWorkspace([], "w-a")).toBeUndefined();
    expect(teamColorForWorkspace(teams, "w-zz")).toBeUndefined();
  });
  it("gives each team a stable cycle color and shares it across members", () => {
    expect(teamColorForWorkspace(teams, "w-a")).toBe(TEAM_COLOR_CYCLE[0]);
    expect(teamColorForWorkspace(teams, "w-b")).toBe(TEAM_COLOR_CYCLE[0]);
    expect(teamColorForWorkspace(teams, "w-c")).toBe(TEAM_COLOR_CYCLE[1]);
  });
  it("first containing team wins", () => {
    const overlap = [...teams, { id: "t3", memberEmployeeIds: ["w-a"] }];
    expect(teamForWorkspace(overlap, "w-a")?.id).toBe("t1");
  });
  it("team colors never overlap the desk accent cycle", () => {
    for (const color of TEAM_COLOR_CYCLE) {
      expect(DESK_ACCENT_CYCLE).not.toContain(color);
    }
  });
});

describe("toolTokenForToolName", () => {
  it("maps real tool families to station artifact tokens (§8.8)", () => {
    expect(toolTokenForToolName("Read")).toBe("paper");
    expect(toolTokenForToolName("Edit")).toBe("paper");
    expect(toolTokenForToolName("Write")).toBe("paper");
    expect(toolTokenForToolName("Bash")).toBe("terminal");
    expect(toolTokenForToolName("WebFetch")).toBe("globe");
    expect(toolTokenForToolName("WebSearch")).toBe("globe");
    expect(toolTokenForToolName("Grep")).toBe("magnifier");
    expect(toolTokenForToolName("Glob")).toBe("magnifier");
    expect(toolTokenForToolName("TodoWrite")).toBe("checklist");
    expect(toolTokenForToolName("mcp__github__create_issue")).toBe("diamond");
    expect(toolTokenForToolName("Unknown")).toBeUndefined();
    expect(toolTokenForToolName(undefined)).toBeUndefined();
  });
});

describe("latestRunningToolName", () => {
  it("prefers an in-flight tool over the most recent completed one", () => {
    const thread = {
      itemIds: ["a", "b"],
      items: {
        a: { payload: { name: "Read", status: "success" } },
        b: { payload: { name: "Bash", status: "running" } },
      },
    };
    expect(latestRunningToolName(thread)).toBe("Bash");
  });
  it("falls back to the latest completed tool when nothing is running", () => {
    const thread = {
      itemIds: ["a", "b"],
      items: {
        a: { payload: { name: "Read", status: "success" } },
        b: { payload: { name: "Edit", status: "success" } },
      },
    };
    expect(latestRunningToolName(thread)).toBe("Edit");
    expect(latestRunningToolName({ itemIds: [], items: {} })).toBeUndefined();
  });
});

describe("two-level workspace hierarchy", () => {
  const container = { id: "c1", name: "Coding", agentKind: "openai", accentColor: "#fff" };
  const employeeA = { id: "org-a", name: "Ada", roleRank: 1, parentWorkspaceId: "c1" };
  const employeeB = {
    id: "org-b",
    name: "Bob",
    roleRank: 2,
    parentWorkspaceId: "c1",
    teamId: "t-exec",
  };
  const employeeHidden = {
    id: "org-h",
    name: "Hide",
    roleRank: 1,
    parentWorkspaceId: "c1",
    hiddenInNav: true,
  };
  const legacy = { id: "w-legacy", name: "Legacy" };

  it("treats rankless workspaces as containers, not desks", () => {
    expect(isEmployeeWorkspace(container as never)).toBe(false);
    expect(isEmployeeWorkspace(employeeA as never)).toBe(true);
    expect(isEmployeeWorkspace(legacy as never)).toBe(false);
    expect(
      employeeWorkspaces([container, employeeA, employeeB, employeeHidden, legacy] as never),
    ).toEqual([employeeA, employeeB]);
  });

  it("filters out employees belonging to hidden teams", () => {
    expect(
      employeeWorkspaces([employeeA, employeeB] as never, new Set(["t-exec"])).map((w) => w.id),
    ).toEqual(["org-a"]);
  });

  it("derives regions from teamId first, then container, with an unranked fallback", () => {
    expect(regionKeyForEmployee(employeeA as never)).toBe("c1");
    expect(regionKeyForEmployee(employeeB as never)).toBe("t-exec");
    expect(regionKeyForEmployee(legacy as never)).toBe(UNRANKED_REGION_KEY);
  });

  it("maps rank to a pixel-dot row", () => {
    expect(rankDotCount(1)).toBe(1);
    expect(rankDotCount(2)).toBe(2);
    expect(rankDotCount(3)).toBe(3);
    expect(rankDotCount(undefined)).toBe(0);
    expect(regionColorForIndex(0)).toBe(0x7fb3d5);
  });
});

describe("contextProgressSegments", () => {
  it("bounds the 8-segment fill by real context usage", () => {
    expect(contextProgressSegments({ usedTokens: 0, maxTokens: 1000 })).toBe(0);
    expect(contextProgressSegments({ usedTokens: 500, maxTokens: 1000 })).toBe(4);
    expect(contextProgressSegments({ usedTokens: 10_000, maxTokens: 1000 })).toBe(8);
    expect(contextProgressSegments({ usedTokens: undefined, maxTokens: undefined })).toBe(0);
  });
});
