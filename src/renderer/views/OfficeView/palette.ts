/**
 * Color + shape palettes for the top-down office floor.
 *
 * `default` is the munder App-端 pixel world (DESIGN.md §3): wood wall band,
 * grass checkerboard floor, cream-100 desks, ink-900 outlines, hard 4/4 shadows.
 * `brutalist` is the retained optional neo-brutalist variant (thick borders,
 * saturated tiles) — the theme toggle keeps both.
 */

export type OfficeThemeId = "default" | "brutalist";

export interface OfficePalette {
  id: OfficeThemeId;
  /** Outer wall band. */
  wall: number;
  /** Floor base fill inside the wall. */
  floor: number;
  /** Light checkerboard tile. */
  tile: number;
  /** Dark checkerboard tile (pixel world only; falls back to tileLine when unused). */
  tileDark: number;
  /** Tile grid line color. */
  tileLine: number;
  /** Near-black ink — borders, shadows, text. */
  ink: number;
  /** Desk top fill. */
  desk: number;
  /** Hard offset shadow color. */
  deskShadow: number;
  /** Border width in px. */
  borderWidth: number;
  /** Hard offset shadow distance in px (square corners, no blur). */
  shadowOffset: number;
  /** Default monitor fill when a desk has no accent color. */
  monitorFallback: number;
  /** Optional thick strip across the top of the wall (brutalist chrome). */
  wallBar: number | undefined;
}

export const OFFICE_PALETTES: Record<OfficeThemeId, OfficePalette> = {
  // Munder App pixel world: §3.5 grass checkerboard + wood wall, §6.4 4/4 shadow.
  default: {
    id: "default",
    wall: 0xc9a66b,
    floor: 0xd4eab0,
    tile: 0xd4eab0,
    tileDark: 0xb5d589,
    tileLine: 0xb5d589,
    ink: 0x1a1320,
    desk: 0xfff8e7,
    deskShadow: 0x1a1320,
    borderWidth: 2,
    shadowOffset: 4,
    monitorFallback: 0x4ecdc4,
    wallBar: undefined,
  },
  // Retained neo-brutalist option: warm yellow wall, sky tiles, 4px ink frame.
  brutalist: {
    id: "brutalist",
    wall: 0xffca54,
    floor: 0xfffdf7,
    tile: 0x72c2df,
    tileDark: 0x1b1b1b,
    tileLine: 0x1b1b1b,
    ink: 0x1b1b1b,
    desk: 0xffffff,
    deskShadow: 0x1b1b1b,
    borderWidth: 4,
    shadowOffset: 12,
    monitorFallback: 0xb23a4e,
    wallBar: 0x1b1b1b,
  },
};

/** Accent rotation for desks without a user-set accent color (§3.3 agent accents). */
export const DESK_ACCENT_CYCLE: readonly number[] = [
  0x4ecdc4, 0xffd93d, 0xff6b6b, 0x6bcf7f, 0xb197fc, 0xffa07a,
];

/** Parse a "#rrggbb" / "#rgb" CSS hex string into a pixi color number. */
export function parseHexColor(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return undefined;
  let hex = match[1]!;
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  return Number.parseInt(hex, 16);
}
