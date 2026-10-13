/**
 * Munder App端 design tokens (docs/.../munder-difflin/DESIGN.md §3).
 * Pixel-snapped SNES world: cream panels, ink-900 outlines, grass/wood floor,
 * status semantics from §3.4. Distinct from the marketing-site palette in the
 * older munder-DESIGN.md — this file is the authoritative App floor look.
 *
 * Fonts: Press Start 2P / Pixelify Sans / VT323 are not vendored in this repo;
 * we degrade to monospace stacks (noted per component).
 */

export const TOKENS = {
  cream50: 0xfffdf5,
  cream100: 0xfff8e7,
  cream200: 0xf4e9c7,
  cream300: 0xe8d9a0,
  paper100: 0xfcfaf0,
  ink900: 0x1a1320,
  ink700: 0x3d2e4a,
  ink500: 0x6b5878,
  ink300: 0xa899b5,
  grassLight: 0xd4eab0,
  grassDark: 0xb5d589,
  woodLight: 0xe5c896,
  woodDark: 0xc9a66b,
  path: 0xe8d8b0,
  wall: 0x8b6f47,
} as const;

/** §3.3 agent accents (vibrant, warm) — desk monitor colors. */
export const AGENT_ACCENTS = {
  coral: 0xff6b6b,
  mint: 0x6bcf7f,
  sky: 0x4ecdc4,
  lemon: 0xffd93d,
  lilac: 0xb197fc,
  peach: 0xffa07a,
} as const;

export const AGENT_ACCENT_CYCLE: readonly number[] = [
  AGENT_ACCENTS.sky,
  AGENT_ACCENTS.lemon,
  AGENT_ACCENTS.coral,
  AGENT_ACCENTS.mint,
  AGENT_ACCENTS.lilac,
  AGENT_ACCENTS.peach,
];
