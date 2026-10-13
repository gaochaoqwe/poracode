/**
 * Drag bookkeeping for the collapsed floating ball.
 *
 * The ball used to be moved by the OS through `-webkit-app-region: drag`. A
 * drag region is treated as window chrome (non-client area), so the OS consumed
 * every mouse event over it — including the click that restores the panel, which
 * is why the ball could never be expanded again. The drag now runs in the
 * renderer (main nudges the frameless window by the pointer delta), which keeps
 * the same surface draggable *and* clickable.
 *
 * The arithmetic is deliberately pure so it can be unit-tested without a DOM:
 * the caller owns the listeners and the IPC, this module only decides whether a
 * press is still a click or has become a drag, and by how much the window should
 * move.
 */

/**
 * Screen-pixel travel that promotes a press into a drag. Anything below it is
 * treated as a click — a real mouse never holds perfectly still while pressing,
 * so without a slop every attempt to click the ball would risk moving it (and
 * every attempt to drag it would risk restoring the panel).
 */
export const PET_BALL_DRAG_SLOP_PX = 4;

export interface PetBallDragState {
  /** Where the press started; the slop is measured from here. */
  readonly originX: number;
  readonly originY: number;
  /** Where the last reported move ended; each delta is measured from here. */
  readonly lastX: number;
  readonly lastY: number;
  /** True once the press travelled past the slop: it is a drag, not a click. */
  readonly moved: boolean;
}

export interface PetBallDragStep {
  readonly drag: PetBallDragState;
  /** Screen-pixel nudge for main, or null while the press is still a click. */
  readonly move: { readonly dx: number; readonly dy: number } | null;
}

export function beginPetBallDrag(x: number, y: number): PetBallDragState {
  return { originX: x, originY: y, lastX: x, lastY: y, moved: false };
}

/**
 * Fold one pointer position into the drag. Below the slop nothing is reported
 * and `lastX/lastY` stay put, so the first reported nudge carries the whole
 * distance travelled instead of dropping the pixels spent crossing the slop.
 */
export function advancePetBallDrag(drag: PetBallDragState, x: number, y: number): PetBallDragStep {
  if (!drag.moved && Math.hypot(x - drag.originX, y - drag.originY) < PET_BALL_DRAG_SLOP_PX) {
    return { drag, move: null };
  }
  const dx = x - drag.lastX;
  const dy = y - drag.lastY;
  const next: PetBallDragState = { ...drag, lastX: x, lastY: y, moved: true };
  return { drag: next, move: dx === 0 && dy === 0 ? null : { dx, dy } };
}
