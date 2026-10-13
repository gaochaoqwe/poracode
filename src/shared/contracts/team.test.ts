import { describe, expect, it } from "vitest";
import { teamListSchema } from "./team";

describe("teamListSchema", () => {
  it("parses a full team", () => {
    const team = {
      id: "t1",
      name: "交付团队",
      memberEmployeeIds: ["w-doc", "w-code"],
      managerEmployeeId: "w-code",
      dispatchPolicy: "round-robin",
      createdAt: "2026-10-10T00:00:00.000Z",
    };
    const parsed = teamListSchema.safeParse([team]);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data[0]!.memberEmployeeIds).toEqual(["w-doc", "w-code"]);
    expect(parsed.data[0]!.managerEmployeeId).toBe("w-code");
    expect(parsed.data[0]!.dispatchPolicy).toBe("round-robin");
  });

  it("defaults missing member ids and dispatch policy", () => {
    const team = {
      id: "t1",
      name: "团队",
      createdAt: "2026-10-10T00:00:00.000Z",
    };
    const parsed = teamListSchema.safeParse([team]);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data[0]!.memberEmployeeIds).toEqual([]);
    expect(parsed.data[0]!.dispatchPolicy).toBe("round-robin");
  });

  it("degrades an unknown dispatch policy to round-robin (default)", () => {
    const team = {
      id: "t1",
      name: "团队",
      memberEmployeeIds: ["w1"],
      dispatchPolicy: "banana",
      createdAt: "2026-10-10T00:00:00.000Z",
    };
    const parsed = teamListSchema.safeParse([team]);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data[0]!.dispatchPolicy).toBe("round-robin");
  });

  it("rejects an invalid team id", () => {
    const team = { id: "", name: "团队", createdAt: "2026-10-10T00:00:00.000Z" };
    const parsed = teamListSchema.safeParse([team]);
    expect(parsed.success).toBe(false);
  });
});
