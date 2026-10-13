import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RequirementQualityDecision } from "@/shared/contracts";
import { createDbStorage } from "./dbStorage";

/**
 * The user's disposition of each requirement-quality issue, keyed by
 * `threadId → issueFingerprint → decision`.
 *
 * The guarantee that a re-run never overwrites a settled decision lives in how
 * this is written, not in the storage tier: only an explicit user action calls
 * {@link RequirementQualityStore.setDecision}, and a freshly parsed report is
 * only ever *read* against these keys (`issueFingerprint` is stable across
 * re-runs by construction). A new review therefore cannot resurrect or clobber
 * a confirmed/revised/rejected issue.
 */
interface RequirementQualityStore {
  decisionsByThread: Record<string, Record<string, RequirementQualityDecision>>;
  /** Record a decision, or clear it when `decision` is null. */
  setDecision: (
    threadId: string,
    fingerprint: string,
    decision: RequirementQualityDecision | null,
  ) => void;
}

/** Tolerant reader for persisted state — a bad entry degrades to empty. */
function normalizeDecisions(
  value: unknown,
): Record<string, Record<string, RequirementQualityDecision>> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, Record<string, RequirementQualityDecision>> = {};
  for (const [threadId, byFingerprint] of Object.entries(value as Record<string, unknown>)) {
    if (!byFingerprint || typeof byFingerprint !== "object") continue;
    const entries: Record<string, RequirementQualityDecision> = {};
    for (const [fingerprint, decision] of Object.entries(
      byFingerprint as Record<string, unknown>,
    )) {
      if (
        decision &&
        typeof decision === "object" &&
        typeof (decision as RequirementQualityDecision).status === "string" &&
        typeof (decision as RequirementQualityDecision).updatedAt === "string"
      ) {
        entries[fingerprint] = decision as RequirementQualityDecision;
      }
    }
    if (Object.keys(entries).length > 0) out[threadId] = entries;
  }
  return out;
}

export const useRequirementQualityStore = create<RequirementQualityStore>()(
  persist(
    (set) => ({
      decisionsByThread: {},
      setDecision: (threadId, fingerprint, decision) =>
        set((state) => {
          const current = state.decisionsByThread[threadId] ?? {};
          if (decision === null) {
            if (!(fingerprint in current)) return state;
            const { [fingerprint]: _removed, ...rest } = current;
            const decisionsByThread = { ...state.decisionsByThread };
            if (Object.keys(rest).length > 0) decisionsByThread[threadId] = rest;
            else delete decisionsByThread[threadId];
            return { decisionsByThread };
          }
          return {
            decisionsByThread: {
              ...state.decisionsByThread,
              [threadId]: { ...current, [fingerprint]: decision },
            },
          };
        }),
    }),
    {
      name: "agentemployee-requirement-quality-v1",
      version: 1,
      storage: createDbStorage(),
      // First version, but normalize on read so a hand-edited or partial blob
      // never crashes the store — the same tolerance the version field buys.
      migrate: (persistedState) => ({
        decisionsByThread: normalizeDecisions(
          (persistedState as { decisionsByThread?: unknown } | undefined)?.decisionsByThread,
        ),
      }),
      partialize: (state) => ({ decisionsByThread: state.decisionsByThread }),
    },
  ),
);

/** The decision recorded for one issue, or undefined when still open. */
export function useRequirementQualityDecision(
  threadId: string,
  fingerprint: string,
): RequirementQualityDecision | undefined {
  return useRequirementQualityStore((state) => state.decisionsByThread[threadId]?.[fingerprint]);
}
