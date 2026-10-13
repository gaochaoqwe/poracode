import { create } from "zustand";
import type { Task } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";

interface TasksState {
  tasks: Task[];
  loading: boolean;
  /**
   * Reloads the board from main. Fire-and-refetch throughout: main owns the
   * scheduler and the runs, so every mutation is followed by a refresh.
   */
  refresh: () => Promise<void>;
  /** Patch one task in place (no refetch) for an immediate local update. */
  upsert: (task: Task) => void;
  remove: (id: string) => void;
  /** Replace the whole board (e.g. with the list a mutation returned). */
  setTasks: (tasks: Task[]) => void;
}

function replaceTask(tasks: Task[], next: Task): Task[] {
  const index = tasks.findIndex((task) => task.id === next.id);
  if (index === -1) return [...tasks, next];
  const copy = tasks.slice();
  copy[index] = next;
  return copy;
}

export const useTasksStore = create<TasksState>((set) => ({
  tasks: [],
  loading: true,
  refresh: async () => {
    try {
      const tasks = await readBridge().getTasks();
      set({ tasks, loading: false });
    } catch {
      // A transient read failure must not blank the board; keep the last list.
      set({ loading: false });
    }
  },
  upsert: (task) => set((state) => ({ tasks: replaceTask(state.tasks, task) })),
  remove: (id) => set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) })),
  setTasks: (tasks) => set({ tasks, loading: false }),
}));
