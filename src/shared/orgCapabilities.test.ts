import { describe, expect, it } from "vitest";
import {
  IMPLEMENTED_CAPABILITY_IDS,
  KNOWN_CAPABILITY_IDS,
  ORG_CAPABILITIES,
  ORG_CAPABILITY_BY_ID,
  UNIMPLEMENTED_CAPABILITY_IDS,
  isImplementedCapability,
} from "./orgCapabilities";

describe("orgCapabilities registry", () => {
  it("has unique ids", () => {
    expect(new Set(KNOWN_CAPABILITY_IDS).size).toBe(KNOWN_CAPABILITY_IDS.length);
  });

  it("splits implemented / unimplemented and covers the whole catalog", () => {
    // The task brief listed 22 implemented ids but actually enumerated 23 —
    // keep the enumerated set, assert against the registry as built.
    expect(IMPLEMENTED_CAPABILITY_IDS).toHaveLength(23);
    expect(UNIMPLEMENTED_CAPABILITY_IDS).toHaveLength(6);
    expect(KNOWN_CAPABILITY_IDS).toHaveLength(29);
    expect([...IMPLEMENTED_CAPABILITY_IDS, ...UNIMPLEMENTED_CAPABILITY_IDS].sort()).toEqual(
      [...KNOWN_CAPABILITY_IDS].sort(),
    );
  });

  it("exposes every entry through the by-id map", () => {
    for (const entry of ORG_CAPABILITIES) {
      expect(ORG_CAPABILITY_BY_ID.get(entry.id)).toEqual(entry);
    }
  });

  it("isImplementedCapability matches the flags", () => {
    expect(isImplementedCapability("doc-generation")).toBe(true);
    expect(isImplementedCapability("task-poll")).toBe(true);
    expect(isImplementedCapability("report-engine-link")).toBe(false);
    expect(isImplementedCapability("enterprise-knowledge")).toBe(false);
    expect(isImplementedCapability("does-not-exist")).toBe(false);
  });

  it("keeps unimplemented ids inside the known catalog", () => {
    for (const id of UNIMPLEMENTED_CAPABILITY_IDS) {
      expect(KNOWN_CAPABILITY_IDS).toContain(id);
      expect(ORG_CAPABILITY_BY_ID.get(id)?.implemented).toBe(false);
    }
  });
});
