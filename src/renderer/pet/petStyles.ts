/**
 * Floating-pet appearance presets. The pet is the chief-steward avatar; the user
 * picks a look from a small switcher pinned to the top of the window. The choice
 * lives in localStorage on purpose: it is a view preference with no persisted
 * state, cache, or protocol boundary behind it, so it deliberately avoids the
 * zustand persist version machinery (and its migration surface).
 */
export const PET_STYLE_IDS = ["sphere", "pixel-cube", "owl"] as const;
export type PetStyleId = (typeof PET_STYLE_IDS)[number];

const STORAGE_KEY = "agentemployee-pet-style";

/** The style used until the user picks one. */
export const DEFAULT_PET_STYLE: PetStyleId = "sphere";

function isPetStyleId(value: unknown): value is PetStyleId {
  return typeof value === "string" && (PET_STYLE_IDS as readonly string[]).includes(value);
}

export function readPetStylePreference(): PetStyleId {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (isPetStyleId(raw)) return raw;
  } catch {
    // Storage can be unavailable (private mode, quota) — fall through to default.
  }
  return DEFAULT_PET_STYLE;
}

export function writePetStylePreference(style: PetStyleId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, style);
  } catch {
    // A failed preference write must not break the pet; the default simply wins.
  }
}
