import { describe, expect, it } from "vitest";
import type { ThreadConfig } from "@/shared/contracts";
import { applyAutoApproveToConfig, resolveAutoApproveTarget } from "./sessionAutoApprove";

const supervised: ThreadConfig = {
  model: "model-a",
  mode: "agent",
  approvalPolicy: "default",
};

describe("resolveAutoApproveTarget", () => {
  it("is true for a full-bypass policy outside plan mode", () => {
    for (const approvalPolicy of ["bypassPermissions", "yolo", "never", "dontAsk"]) {
      expect(resolveAutoApproveTarget({ ...supervised, approvalPolicy })).toBe(true);
    }
  });

  it("is false for an ordinary policy or an unknown one", () => {
    expect(resolveAutoApproveTarget(supervised)).toBe(false);
    expect(resolveAutoApproveTarget({ ...supervised, approvalPolicy: "act" })).toBe(false);
    expect(resolveAutoApproveTarget({ ...supervised, approvalPolicy: undefined })).toBe(false);
  });

  it("is false in plan mode even with a full-bypass policy", () => {
    expect(
      resolveAutoApproveTarget({ ...supervised, mode: "plan", approvalPolicy: "never" }),
    ).toBe(false);
  });
});

describe("applyAutoApproveToConfig", () => {
  it("asserts the full-bypass policy when enabling from a supervised posture", () => {
    expect(applyAutoApproveToConfig(supervised, true)).toEqual({
      ...supervised,
      approvalPolicy: "never",
    });
    expect(applyAutoApproveToConfig({ ...supervised, approvalPolicy: "act" }, true)).toEqual({
      ...supervised,
      approvalPolicy: "never",
    });
  });

  it("is a no-op when enabling from an already-bypassed or plan posture", () => {
    expect(applyAutoApproveToConfig({ ...supervised, approvalPolicy: "yolo" }, true)).toBeUndefined();
    expect(
      applyAutoApproveToConfig({ ...supervised, mode: "plan", approvalPolicy: "default" }, true),
    ).toBeUndefined();
  });

  it("rewrites a full-bypass policy back to the supervised default when disabling", () => {
    for (const approvalPolicy of ["bypassPermissions", "yolo", "never", "dontAsk"]) {
      expect(applyAutoApproveToConfig({ ...supervised, approvalPolicy }, false)).toEqual({
        ...supervised,
        approvalPolicy: "default",
      });
    }
  });

  it("never clobbers a non-bypass policy when disabling", () => {
    expect(applyAutoApproveToConfig(supervised, false)).toBeUndefined();
    expect(applyAutoApproveToConfig({ ...supervised, approvalPolicy: "act" }, false)).toBeUndefined();
  });
});
