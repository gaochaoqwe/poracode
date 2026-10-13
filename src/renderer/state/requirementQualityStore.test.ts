import { beforeEach, describe, expect, it } from "vitest";
import { useRequirementQualityStore } from "./requirementQualityStore";

const store = useRequirementQualityStore;

beforeEach(() => {
  store.setState({ decisionsByThread: {} });
});

describe("requirementQualityStore", () => {
  it("records a decision under the thread and fingerprint", () => {
    store.getState().setDecision("t1", "ambiguity|item|req-1", {
      status: "confirmed",
      note: "accepted",
      updatedAt: "2026-09-30T00:00:00.000Z",
    });

    expect(store.getState().decisionsByThread["t1"]?.["ambiguity|item|req-1"]).toEqual({
      status: "confirmed",
      note: "accepted",
      updatedAt: "2026-09-30T00:00:00.000Z",
    });
  });

  it("replaces a prior decision for the same issue", () => {
    store.getState().setDecision("t1", "f", { status: "confirmed", updatedAt: "a" });
    store.getState().setDecision("t1", "f", { status: "rejected", updatedAt: "b" });

    expect(store.getState().decisionsByThread["t1"]?.["f"]?.status).toBe("rejected");
  });

  it("clears a decision and drops the thread once empty", () => {
    store.getState().setDecision("t1", "f", { status: "confirmed", updatedAt: "a" });
    store.getState().setDecision("t1", "f", null);

    expect(store.getState().decisionsByThread["t1"]).toBeUndefined();
  });

  it("keeps decisions isolated per thread", () => {
    store.getState().setDecision("t1", "f", { status: "confirmed", updatedAt: "a" });
    store.getState().setDecision("t2", "f", { status: "rejected", updatedAt: "b" });

    expect(store.getState().decisionsByThread["t1"]?.["f"]?.status).toBe("confirmed");
    expect(store.getState().decisionsByThread["t2"]?.["f"]?.status).toBe("rejected");
  });

  it("tolerates a malformed persisted blob on migrate", async () => {
    const migrate = store.persist.getOptions().migrate!;
    const migrated = await migrate(
      {
        decisionsByThread: {
          t1: { good: { status: "confirmed", updatedAt: "a" }, bad: { status: 5 } },
          broken: "not-an-object",
        },
      },
      1,
    );

    expect(migrated).toEqual({
      decisionsByThread: { t1: { good: { status: "confirmed", updatedAt: "a" } } },
    });
  });
});
