import { describe, expect, it } from "vitest";
import type { ThreadConfig } from "@/shared/contracts";
import { applyAcpModeUpdateToConfig, resolveAcpMode } from "./sessionConfig";

const base: ThreadConfig = { model: "model-a", mode: "agent", approvalPolicy: "never" };

describe("resolveAcpMode", () => {
  // Cline advertises plan/act; "act" is its plain work mode. A Work config
  // (mode "agent") must resolve to it even when the approval policy names
  // something else (e.g. the auto-approve switch's "never") — otherwise no
  // `session/set_mode` is sent and the agent stays in plan mode.
  it("resolves the Work mode to a non-canonical work-mode id", () => {
    expect(resolveAcpMode(base, ["plan", "act"])).toBe("act");
  });

  it("resolves Work with no approval policy to the non-canonical work mode", () => {
    expect(resolveAcpMode({ ...base, approvalPolicy: "" }, ["plan", "act"])).toBe("act");
  });

  it("still prefers canonical ids and approval-policy modes when advertised", () => {
    expect(resolveAcpMode({ ...base, approvalPolicy: "default" }, ["default", "plan"])).toBe(
      "default",
    );
    expect(resolveAcpMode({ ...base, approvalPolicy: "yolo" }, ["yolo", "act"])).toBe("yolo");
    expect(resolveAcpMode({ ...base, mode: "plan" }, ["plan", "act"])).toBe("plan");
  });

  it("returns undefined when the agent offers only plan", () => {
    expect(resolveAcpMode(base, ["plan"])).toBeUndefined();
  });
});

describe("applyAcpModeUpdateToConfig", () => {
  it("treats a plain work mode as agent without touching the approval policy", () => {
    expect(applyAcpModeUpdateToConfig({ ...base, mode: "plan" }, "act")).toEqual(base);
  });

  it("keeps mapping the canonical agent id to the default posture (unchanged)", () => {
    expect(applyAcpModeUpdateToConfig({ ...base, mode: "plan" }, "agent")).toEqual({
      ...base,
      mode: "agent",
      approvalPolicy: "default",
    });
  });
});
