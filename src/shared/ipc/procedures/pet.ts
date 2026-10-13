import { z } from "zod";
import { defineNoArgProcedure, definePayloadProcedure } from "../core";

/**
 * The desktop pet window asks main to focus the main window and navigate it to
 * a surface (tasks board, office floor, home). The pet itself is the chief
 * steward avatar; its task list is rendered in-window, and this IPC is the
 * "take me there" bridge to the full main-window surface.
 */
export const petNavigateMainTargetSchema = z.enum(["home", "tasks", "office"]);
export type PetNavigateMainTarget = z.infer<typeof petNavigateMainTargetSchema>;

export const petNavigateMainPayloadSchema = z.object({
  target: petNavigateMainTargetSchema,
});
export type PetNavigateMainPayload = z.infer<typeof petNavigateMainPayloadSchema>;

/**
 * The pet window can collapse into a resident floating ball (and expand back).
 * The renderer is the source of truth for the mode; main resizes the window to
 * the matching bounds so the transparent window never blocks clicks it does not
 * render.
 */
export const petSetCollapsedPayloadSchema = z.object({ collapsed: z.boolean() });
export type PetSetCollapsedPayload = z.infer<typeof petSetCollapsedPayloadSchema>;

/**
 * Native context menu for the collapsed ball: the 64px ball window cannot fit a
 * DOM menu, so main pops a native menu whose labels are localized by the
 * renderer and sent here.
 */
export const petShowBallMenuPayloadSchema = z.object({
  expandLabel: z.string(),
  hideLabel: z.string(),
});
export type PetShowBallMenuPayload = z.infer<typeof petShowBallMenuPayloadSchema>;

/**
 * The collapsed ball is draggable. The drag runs in the renderer rather than in
 * the OS (`-webkit-app-region: drag`), because a drag region is window chrome and
 * swallows the click that restores the panel; main just nudges the frameless
 * window by the pointer delta and remembers where it landed, so
 * collapsing/expanding returns the ball to the same spot. Deltas are screen
 * pixels.
 */
export const petMoveBallPayloadSchema = z.object({
  dx: z.number().int(),
  dy: z.number().int(),
});
export type PetMoveBallPayload = z.infer<typeof petMoveBallPayloadSchema>;

/**
 * Absolute screen-pixel drop position, for callers that want to report a
 * position without a real drag (the window's own `moved` event covers the
 * OS-driven path).
 */
export const petSaveBallPositionPayloadSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});
export type PetSaveBallPositionPayload = z.infer<typeof petSaveBallPositionPayloadSchema>;

/** Chosen action echoed back to the pet renderer after a native menu click. */
export const petBallMenuActionSchema = z.object({
  action: z.enum(["expand", "hide"]),
});
export type PetBallMenuAction = z.infer<typeof petBallMenuActionSchema>;

export const petProcedures = {
  petNavigateMain: definePayloadProcedure<PetNavigateMainPayload, void, "main-local">(
    "petNavigateMain",
    "main-local",
    petNavigateMainPayloadSchema,
  ),
  petSetCollapsed: definePayloadProcedure<PetSetCollapsedPayload, void, "main-local">(
    "petSetCollapsed",
    "main-local",
    petSetCollapsedPayloadSchema,
  ),
  /** Nudge the collapsed ball by a pointer delta (the renderer drives the drag). */
  petMoveBall: definePayloadProcedure<PetMoveBallPayload, void, "main-local">(
    "petMoveBall",
    "main-local",
    petMoveBallPayloadSchema,
  ),
  /** Remember where the user dragged the ball so collapse/expand keeps it there. */
  petSaveBallPosition: definePayloadProcedure<PetSaveBallPositionPayload, void, "main-local">(
    "petSaveBallPosition",
    "main-local",
    petSaveBallPositionPayloadSchema,
  ),
  /** Hide the collapsed ball entirely; the tray menu restores it. */
  petHideBall: defineNoArgProcedure<void, "main-local">("petHideBall", "main-local"),
  petShowBallMenu: definePayloadProcedure<PetShowBallMenuPayload, void, "main-local">(
    "petShowBallMenu",
    "main-local",
    petShowBallMenuPayloadSchema,
  ),
} as const;
