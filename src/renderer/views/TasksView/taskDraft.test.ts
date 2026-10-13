import { describe, expect, it } from "vitest";
import type { EmployeeBinding } from "./employeeBinding";
import { newTaskDraft, taskDraftIsValid } from "./taskDraft";

const EMPLOYEE_ID = "emp-1";
const employees = new Map<string, EmployeeBinding>([
  [EMPLOYEE_ID, { agentKind: "gdsAgent:home", model: "gdsAgent-fable-5", effort: "", fast: false }],
]);

function validDraft() {
  return {
    ...newTaskDraft({ employeeId: EMPLOYEE_ID }),
    title: "Ship it",
    prompt: "Do the thing",
    category: "Billing",
  };
}

describe("taskDraftIsValid", () => {
  it("accepts a draft with a title, prompt, category and a resolvable employee", () => {
    expect(taskDraftIsValid(validDraft(), employees)).toBe(true);
  });

  it("requires a category that survives normalization", () => {
    expect(taskDraftIsValid({ ...validDraft(), category: "" }, employees)).toBe(false);
    expect(taskDraftIsValid({ ...validDraft(), category: "   " }, employees)).toBe(false);
    expect(taskDraftIsValid({ ...validDraft(), category: "  Billing  " }, employees)).toBe(true);
  });
});
