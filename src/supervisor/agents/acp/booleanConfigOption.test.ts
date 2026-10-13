import { describe, expect, it } from "vitest";
import { findBooleanConfigOption, readBooleanConfigValue } from "./booleanConfigOption";

const autoApprove = {
  id: "auto_approve",
  name: "Auto-approve tools",
  type: "boolean",
  currentValue: true,
};

describe("findBooleanConfigOption", () => {
  it("returns the boolean option matching the declared id", () => {
    expect(findBooleanConfigOption([autoApprove], "auto_approve")).toBe(autoApprove);
  });

  it("ignores a select option that reuses the id", () => {
    const selectOption = { id: "auto_approve", type: "select", currentValue: "on", options: [] };
    expect(findBooleanConfigOption([selectOption], "auto_approve")).toBeUndefined();
  });

  it("returns undefined for a missing or blank id", () => {
    expect(findBooleanConfigOption([autoApprove], undefined)).toBeUndefined();
    expect(findBooleanConfigOption([autoApprove], "")).toBeUndefined();
  });

  it("returns undefined for non-array input", () => {
    expect(findBooleanConfigOption(undefined, "auto_approve")).toBeUndefined();
    expect(findBooleanConfigOption({ invalid: true }, "auto_approve")).toBeUndefined();
  });

  it("returns the first match when ids are duplicated", () => {
    const first = { id: "auto_approve", type: "boolean", currentValue: false };
    const second = { id: "auto_approve", type: "boolean", currentValue: true };
    expect(findBooleanConfigOption([first, second], "auto_approve")).toBe(first);
  });
});

describe("readBooleanConfigValue", () => {
  it("reads the current boolean value", () => {
    expect(readBooleanConfigValue([autoApprove], "auto_approve")).toBe(true);
  });

  it("returns undefined when the option is absent", () => {
    expect(readBooleanConfigValue([autoApprove], "missing")).toBeUndefined();
  });

  it("returns undefined when the value is not a boolean", () => {
    const stringValue = { id: "auto_approve", type: "boolean", currentValue: "yes" };
    const noValue = { id: "auto_approve", type: "boolean" };
    expect(readBooleanConfigValue([stringValue], "auto_approve")).toBeUndefined();
    expect(readBooleanConfigValue([noValue], "auto_approve")).toBeUndefined();
  });
});
