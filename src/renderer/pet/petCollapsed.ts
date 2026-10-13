/**
 * Floating-pet window mode. The pet panel can collapse into a resident ball;
 * the mode is a view preference with no persisted protocol behind it, so it
 * deliberately avoids the zustand persist version machinery — mirroring the
 * pet style preference.
 */
const STORAGE_KEY = "agentemployee-pet-collapsed";

/** The mode used until the user picks one: the full panel. */
export const DEFAULT_PET_COLLAPSED = false;

export function readPetCollapsedPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // Storage can be unavailable (private mode, quota) — fall through to default.
  }
  return DEFAULT_PET_COLLAPSED;
}

export function writePetCollapsedPreference(collapsed: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "true" : "false");
  } catch {
    // A failed preference write must not break the pet; the default simply wins.
  }
}
