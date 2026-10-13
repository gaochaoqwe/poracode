import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { normalizeTaskCategory, type TaskDraft } from "@/shared/contracts";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useTaskDraftsStore } from "@/renderer/state/taskDraftsStore";
import {
  createTaskDraft,
  deleteTaskDraft,
  reorderTaskDrafts,
  updateTaskDraft,
} from "@/renderer/actions/taskDraftActions";
import { applyOptimisticDraftReorder, type BoardProjectFilter } from "./boardOrdering";
import type { DraftCardHandlers } from "./parts/DraftCard";
import type { DraftEditorTarget } from "./parts/DraftEditorDialog";

/**
 * Owns the board's draft lane: the shared-visibility toggle, the lane's rows,
 * the editor/delete dialogs, and the reorder round-trip. Extracted so the
 * TasksView stays about layout rather than lane bookkeeping.
 */
export function useTaskDrafts(options: {
  projectFilter: BoardProjectFilter;
  /** Called when a draft is promoted; the view opens the task editor. */
  onPromoteDraft: (draft: TaskDraft) => void;
}) {
  const { t } = useLingui();
  const drafts = useTaskDraftsStore((state) => state.drafts);
  const showDrafts = useSharedSettings((state) => state.showTaskDraftColumn);
  const setShowDrafts = useSharedSettings((state) => state.setShowTaskDraftColumn);

  const [editor, setEditor] = useState<DraftEditorTarget>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<TaskDraft | null>(null);

  async function act(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      await useTaskDraftsStore.getState().refresh();
    }
  }

  function handlersFor(draft: TaskDraft): DraftCardHandlers {
    return {
      onPromote: () => options.onPromoteDraft(draft),
      onEdit: () => setEditor({ kind: "edit", draft }),
      onDelete: () => setDeleteTarget(draft),
    };
  }

  async function saveEditor(input: {
    title: string;
    note: string;
    category: string;
    employeeId: string;
  }): Promise<void> {
    const target = editor;
    if (!target) return;
    const payload = {
      title: input.title,
      note: input.note ? input.note : null,
      category: normalizeTaskCategory(input.category),
      employeeId: input.employeeId ? input.employeeId : null,
      projectId: options.projectFilter,
    };
    await act(async () => {
      if (target.kind === "edit") await updateTaskDraft(target.draft.id, payload);
      else await createTaskDraft(payload);
    });
    setEditor(null);
  }

  // Optimistic: the lane reorders immediately, then main's dense order (or the
  // rejection, when the board changed mid-drag) is reconciled.
  async function reorder(orderedIds: string[]): Promise<void> {
    const projectId = options.projectFilter;
    if (projectId == null) return;
    const store = useTaskDraftsStore.getState();
    store.setDrafts(applyOptimisticDraftReorder(store.drafts, orderedIds));
    try {
      useTaskDraftsStore.getState().setDrafts(await reorderTaskDrafts(projectId, orderedIds));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await useTaskDraftsStore.getState().refresh();
    }
  }

  return {
    drafts,
    showDrafts,
    setShowDrafts,
    editor,
    openNew: () => setEditor({ kind: "new" }),
    closeEditor: () => setEditor(null),
    saveEditor,
    deleteTarget,
    closeDelete: () => setDeleteTarget(null),
    confirmDelete: () => {
      const id = deleteTarget?.id;
      setDeleteTarget(null);
      if (id) void act(() => deleteTaskDraft(id));
    },
    handlersFor,
    reorder,
    busy,
    error,
    clearError: () => setError(""),
    /** Removes a draft after it was successfully promoted into a task. */
    removeDraft: (id: string) => useTaskDraftsStore.getState().remove(id),
    emptyLabel: t`No ideas parked`,
  };
}
