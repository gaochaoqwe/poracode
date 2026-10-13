import { create } from "zustand";

/**
 * Open/close state for the floating top-right task panel. Session-scoped to a
 * single thread: only one thread's task panel is open at a time, mirroring the
 * panel-surface convention used across the rest of the app.
 */
interface ThreadDocksOverlayStore {
  /** Thread id whose task panel is open, or null when none is. */
  openThreadId: string | null;
  toggle: (threadId: string) => void;
  open: (threadId: string) => void;
  close: () => void;
}

export const useThreadDocksOverlayStore = create<ThreadDocksOverlayStore>((set) => ({
  openThreadId: null,
  toggle: (threadId) =>
    set((state) => ({
      openThreadId: state.openThreadId === threadId ? null : threadId,
    })),
  open: (threadId) => set({ openThreadId: threadId }),
  close: () => set({ openThreadId: null }),
}));
