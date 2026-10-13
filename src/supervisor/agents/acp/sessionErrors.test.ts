import { describe, expect, it } from "vitest";
import { isSessionGoneError } from "./sessionErrors";

describe("isSessionGoneError", () => {
  it.each([
    "session not found: 1790826183272_pl8F1_cli",
    "Session 1790826183272_pl8F1_cli not found",
    "unknown session",
    "invalid session id",
    "session expired",
    "no such session",
    "This thread does not exist",
    "SESSION_NOT_FOUND",
  ])("treats session-scoped wording as gone: %s", (message) => {
    expect(isSessionGoneError(new Error(message))).toBe(true);
  });

  it.each([
    "file not found: /tmp/x",
    "model not found",
    "MCP server not found",
    "Internal error",
    "network timeout",
  ])("does not treat an unrelated error as a lost session: %s", (message) => {
    expect(isSessionGoneError(new Error(message))).toBe(false);
  });
});
