import { create } from "zustand";
import type { TaskDraft } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";

interface TaskDraftsState {
  drafts: TaskDraft[];
  loading: boolean;
  /** Reloads the draft lane from main. */
  refresh: () => Promise<void>;
  /** Patch one draft in place (no refetch) for an immediate local update. */
  upsert: (draft: TaskDraft) => void;
  remove: (id: string) => void;
  /** Replace the whole lane (e.g. with the list a mutation returned). */
  setDrafts: (drafts: TaskDraft[]) => void;
}

function replaceDraft(drafts: TaskDraft[], next: TaskDraft): TaskDraft[] {
  const index = drafts.findIndex((draft) => draft.id === next.id);
  if (index === -1) return [...drafts, next];
  const copy = drafts.slice();
  copy[index] = next;
  return copy;
}

export const useTaskDraftsStore = create<TaskDraftsState>((set) => ({
  drafts: [],
  loading: true,
  refresh: async () => {
    try {
      const drafts = await readBridge().getTaskDrafts();
      set({ drafts, loading: false });
    } catch {
      // A transient read failure must not blank the lane; keep the last list.
      set({ loading: false });
    }
  },
  upsert: (draft) => set((state) => ({ drafts: replaceDraft(state.drafts, draft) })),
  remove: (id) => set((state) => ({ drafts: state.drafts.filter((draft) => draft.id !== id) })),
  setDrafts: (drafts) => set({ drafts, loading: false }),
}));
