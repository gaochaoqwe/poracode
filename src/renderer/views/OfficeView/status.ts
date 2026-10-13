import type { ThreadStatus } from "@/shared/contracts";

/**
 * Munder App端 status semantics (DESIGN.md §3.4) — the full set, not just the
 * three bubble moods from the marketing skin. Color + icon + position all carry
 * the meaning; color is never the only channel.
 */
export type MunderStatus =
  | "idle"
  | "thinking"
  | "working"
  | "waiting"
  | "blocked"
  | "success"
  | "ghost"
  | "compacting"
  | "looping"
  | "typing";

/** §3.4 status token colors (pix numbers). */
export const STATUS_COLORS: Record<MunderStatus, number> = {
  idle: 0xa899b5,
  thinking: 0x4ecdc4,
  working: 0xffd93d,
  waiting: 0x6c8ef5,
  blocked: 0xff6b6b,
  success: 0x6bcf7f,
  ghost: 0xd9cfe0,
  compacting: 0x9b7ede,
  looping: 0xff9f43,
  typing: 0xe8a33d,
};

/**
 * Fold the app's ThreadStatus into a munder status. blocked ("needs you")
 * covers both approval waits and hard errors — both are user-facing stops.
 */
export function munderStatusForThread(status: ThreadStatus): MunderStatus {
  switch (status) {
    case "working":
      return "working";
    case "launching":
      return "thinking";
    case "needs_approval":
    case "needs_reply":
    case "error":
      return "blocked";
    case "finished":
      return "success";
    case "idle":
      return "idle";
    case "inactive":
      return "ghost";
  }
}

/** User-facing lowercase badge labels (§7.3 — not the token names). */
export function statusBadgeLabel(status: MunderStatus): string {
  switch (status) {
    case "blocked":
      return "needs you";
    case "waiting":
      return "waiting";
    case "thinking":
      return "thinking";
    case "working":
      return "working";
    case "success":
      return "done";
    case "compacting":
      return "compacting";
    case "looping":
      return "runaway";
    case "typing":
      return "your draft";
    case "ghost":
      return "away";
    default:
      return "idle";
  }
}

/** Subtle per-desk motion driven by status (kept a pure switch, unit-tested). */
export type DeskMotion = "idle" | "working" | "awaiting" | "error";

export function deskMotionForStatus(status: MunderStatus): DeskMotion {
  switch (status) {
    case "working":
      return "working";
    case "blocked":
      return "awaiting";
    case "looping":
      return "error";
    default:
      return "idle";
  }
}
