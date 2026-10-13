import { describe, expect, it } from "vitest";
import { advancePetBallDrag, beginPetBallDrag, PET_BALL_DRAG_SLOP_PX } from "./petBallDrag";

describe("pet ball drag", () => {
  it("keeps a still press a click", () => {
    const step = advancePetBallDrag(beginPetBallDrag(100, 100), 100, 100);
    expect(step.move).toBeNull();
    expect(step.drag.moved).toBe(false);
  });

  it("ignores travel below the slop so a click is not read as a drag", () => {
    const started = beginPetBallDrag(100, 100);
    const step = advancePetBallDrag(started, 100 + PET_BALL_DRAG_SLOP_PX - 1, 100);
    expect(step.move).toBeNull();
    expect(step.drag.moved).toBe(false);
  });

  it("carries the whole travelled distance into the first nudge", () => {
    const step = advancePetBallDrag(beginPetBallDrag(100, 100), 112, 103);
    expect(step.drag.moved).toBe(true);
    // Nothing was reported while crossing the slop, so the pixels spent there
    // must still move the ball.
    expect(step.move).toEqual({ dx: 12, dy: 3 });
  });

  it("reports the delta between steps once the press is a drag", () => {
    const first = advancePetBallDrag(beginPetBallDrag(0, 0), 10, 0);
    const second = advancePetBallDrag(first.drag, 30, 5);
    expect(second.move).toEqual({ dx: 20, dy: 5 });
  });

  it("stays a drag when the pointer comes back to where it started", () => {
    const started = advancePetBallDrag(beginPetBallDrag(0, 0), 40, 0);
    const back = advancePetBallDrag(started.drag, 0, 0);
    expect(back.drag.moved).toBe(true);
    expect(back.move).toEqual({ dx: -40, dy: 0 });
  });

  it("skips the nudge when the pointer did not actually move", () => {
    const started = advancePetBallDrag(beginPetBallDrag(0, 0), 20, 0);
    const repeat = advancePetBallDrag(started.drag, 20, 0);
    expect(repeat.drag.moved).toBe(true);
    expect(repeat.move).toBeNull();
  });

  it("measures the slop as a distance, not per axis", () => {
    // 3px on each axis is 4.24px of travel: past the slop.
    const step = advancePetBallDrag(beginPetBallDrag(0, 0), 3, 3);
    expect(step.drag.moved).toBe(true);
    expect(step.move).toEqual({ dx: 3, dy: 3 });
  });
});
