import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTaskPollScheduler,
  STEWARD_POLL_PROMPT,
  type TaskPollSchedulerDeps,
} from "./taskPollScheduler";

let settings: { taskPollEnabled?: boolean; taskPollIntervalMinutes?: number };
let chiefThreadId: string | undefined;
const sent: Array<{ threadId: string; prompt: string }> = [];
const logs: unknown[][] = [];

function makeDeps(overrides: Partial<TaskPollSchedulerDeps> = {}): TaskPollSchedulerDeps {
  return {
    getSettings: () => settings,
    getChiefStewardThreadId: () => chiefThreadId,
    sendThreadInput: (payload) => {
      sent.push(payload);
    },
    log: (...args: unknown[]) => logs.push(args),
    ...overrides,
  };
}

afterEach(() => {
  settings = {};
  chiefThreadId = undefined;
  sent.length = 0;
  logs.length = 0;
  vi.useRealTimers();
});

describe("taskPollScheduler", () => {
  it("skips when disabled", () => {
    settings = { taskPollEnabled: false };
    chiefThreadId = "steward-1";
    const scheduler = createTaskPollScheduler(makeDeps());
    scheduler.tickNow();
    expect(sent).toHaveLength(0);
  });

  it("skips when no steward thread exists", () => {
    chiefThreadId = undefined;
    const scheduler = createTaskPollScheduler(makeDeps());
    scheduler.tickNow();
    expect(sent).toHaveLength(0);
    expect(logs.flat().join(" ")).toContain("no chief steward thread");
  });

  it("sends the poll prompt to the steward thread", () => {
    chiefThreadId = "steward-1";
    const scheduler = createTaskPollScheduler(makeDeps());
    scheduler.tickNow();
    expect(sent).toEqual([{ threadId: "steward-1", prompt: STEWARD_POLL_PROMPT }]);
  });

  it("skips a busy steward thread", () => {
    chiefThreadId = "steward-1";
    const scheduler = createTaskPollScheduler(
      makeDeps({ isThreadBusy: (id) => id === "steward-1" }),
    );
    scheduler.tickNow();
    expect(sent).toHaveLength(0);
  });

  it("reschedules when the interval changes", () => {
    vi.useFakeTimers();
    settings = { taskPollIntervalMinutes: 60 };
    chiefThreadId = "steward-1";
    const scheduler = createTaskPollScheduler(makeDeps());
    scheduler.start();
    vi.advanceTimersByTime(60 * 60_000);
    expect(sent).toHaveLength(1);

    // A tick observes the new interval and reschedules to 10 min.
    settings = { taskPollIntervalMinutes: 10 };
    scheduler.tickNow();
    expect(sent).toHaveLength(2);
    vi.advanceTimersByTime(10 * 60_000);
    expect(sent).toHaveLength(3);
    scheduler.stop();
  });

  it("stops after stop()", () => {
    vi.useFakeTimers();
    chiefThreadId = "steward-1";
    const scheduler = createTaskPollScheduler(makeDeps());
    scheduler.start();
    scheduler.stop();
    vi.advanceTimersByTime(10 * 60_000);
    expect(sent).toHaveLength(0);
  });

  it("a throwing tick does not escape", () => {
    const badDeps = makeDeps({
      getSettings: () => {
        throw new Error("settings gone");
      },
    });
    expect(() => createTaskPollScheduler(badDeps).tickNow()).not.toThrow();
  });
});
