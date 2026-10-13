import { describe, expect, it } from "vitest";
import { taskColumn, taskStatusSchema, type TaskStatus } from "./task";

describe("taskColumn", () => {
  it("files every status into a lane, in board order", () => {
    const expected: Record<TaskStatus, string> = {
      todo: "todo",
      cancelled: "todo",
      in_progress: "inProgress",
      awaiting_input: "attention",
      failed: "attention",
      done: "done",
    };
    for (const status of taskStatusSchema.options) {
      expect(taskColumn(status)).toBe(expected[status]);
    }
  });

  it("keeps a stopped run restartable in Todo rather than calling it done", () => {
    expect(taskColumn("cancelled")).toBe("todo");
  });
});
