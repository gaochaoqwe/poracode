import type { SettingsWritePatch } from "@/shared/contracts";
import type { SharedSettings } from "@/shared/settings";

/**
 * Pure apply step for supervisor-originated settings writes (chief steward
 * tools). Kept out of main.ts so the write policy stays unit-testable: the
 * supervisor ships a partial patch, main reads the current file, overlays the
 * patch, and persists — this is the overlay. Arrays are wholesale
 * replacements; the steward always read-modify-writes the full list first.
 */
export function applySettingsWritePatch(
  current: SharedSettings,
  patch: SettingsWritePatch,
): SharedSettings {
  if (
    patch.teams === undefined &&
    patch.workspaces === undefined &&
    patch.chiefStewardWorkspaceId === undefined
  ) {
    return current;
  }
  return {
    ...current,
    ...(patch.teams !== undefined ? { teams: patch.teams as SharedSettings["teams"] } : {}),
    ...(patch.workspaces !== undefined
      ? { workspaces: patch.workspaces as SharedSettings["workspaces"] }
      : {}),
    // `null` clears the chief steward assignment; undefined means "no change".
    ...(patch.chiefStewardWorkspaceId !== undefined
      ? {
          chiefStewardWorkspaceId:
            patch.chiefStewardWorkspaceId === null ? undefined : patch.chiefStewardWorkspaceId,
        }
      : {}),
  };
}
