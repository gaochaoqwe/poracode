import { describe, expect, it } from "vitest";
import { normalizeAppView } from "./appView";

describe("normalizeAppView", () => {
  it("maps the legacy tasks/office kinds onto the workbench tabs", () => {
    expect(normalizeAppView({ kind: "tasks" })).toEqual({ kind: "workbench", tab: "tasks" });
    expect(normalizeAppView({ kind: "office" })).toEqual({ kind: "workbench", tab: "office" });
  });

  it("clamps an unknown workbench tab to the first tab", () => {
    expect(normalizeAppView({ kind: "workbench", tab: "nope" })).toEqual({
      kind: "workbench",
      tab: "tasks",
    });
  });

  it("passes a current view through untouched", () => {
    expect(normalizeAppView({ kind: "workbench", tab: "approvals" })).toEqual({
      kind: "workbench",
      tab: "approvals",
    });
    expect(normalizeAppView({ kind: "home" })).toEqual({ kind: "home" });
    expect(normalizeAppView({ kind: "thread", panes: ["t1"] })).toEqual({
      kind: "thread",
      panes: ["t1"],
    });
  });

  it("falls back to home for a missing or malformed payload", () => {
    expect(normalizeAppView(null)).toEqual({ kind: "home" });
    expect(normalizeAppView(undefined)).toEqual({ kind: "home" });
    expect(normalizeAppView("bogus")).toEqual({ kind: "home" });
  });
});
