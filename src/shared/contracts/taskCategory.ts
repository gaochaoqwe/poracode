import { MAX_TASK_CATEGORY_LENGTH } from "./task";
import type { Task } from "./task";
import type { TaskDraft } from "./taskDrafts";

/**
 * Normalize a raw category input into its canonical form (trimmed, capped), or
 * `null` when it carries nothing. Used by the services and by the editor form so
 * a trailing space or an over-long paste can never create a second, "identical"
 * category on the board.
 */
export function normalizeTaskCategory(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_TASK_CATEGORY_LENGTH);
}

/**
 * Distinct categories currently in use, sorted for a stable, locale-neutral
 * presentation (case-insensitive). The board feeds these back to the task
 * editor as suggestions, which is what makes categories feel "custom" without a
 * separate management screen.
 */
export function collectTaskCategories(sources: readonly (Task | TaskDraft)[]): string[] {
  const seen = new Map<string, string>();
  for (const source of sources) {
    const category = normalizeTaskCategory(source.category ?? null);
    if (category && !seen.has(category.toLowerCase())) seen.set(category.toLowerCase(), category);
  }
  return [...seen.values()].sort((left, right) => left.localeCompare(right));
}
