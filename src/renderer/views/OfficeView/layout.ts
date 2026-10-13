/** A desk's top-left corner + size on the floor, in CSS/pixi pixels. */
export interface DeskSlot {
  x: number;
  y: number;
  size: number;
}

/**
 * Lay `count` desks out in a centered grid that respects the viewport aspect
 * ratio. Pure function — returns slots for the floor renderer and lets tests
 * assert the packing without a canvas.
 */
export function computeDeskSlots(
  count: number,
  width: number,
  height: number,
  padding = 48,
): DeskSlot[] {
  if (count <= 0 || width <= 0 || height <= 0) return [];
  const innerW = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding * 2);
  // Square-ish cells, more columns when the floor is wide.
  const cols = Math.max(1, Math.round(Math.sqrt((count * innerW) / innerH)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cell = Math.floor(Math.min(innerW / cols, innerH / rows));
  const gridW = cell * cols;
  const gridH = cell * rows;
  const originX = padding + Math.floor((innerW - gridW) / 2);
  const originY = padding + Math.floor((innerH - gridH) / 2);

  const slots: DeskSlot[] = [];
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    slots.push({
      x: originX + col * cell,
      y: originY + row * cell,
      size: cell,
    });
  }
  return slots;
}
