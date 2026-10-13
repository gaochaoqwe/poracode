import type { PetStyleId } from "./petStyles";

/**
 * The pet, drawn as inline SVG pixel art so it needs no image assets and stays
 * crisp at any size. Each look is a small sprite grid rendered through one
 * shared painter, which keeps the "chunky pixels" look consistent and makes a
 * new style a matter of adding a few rows of characters.
 *
 * Palette tokens (resolved per-theme via CSS variables):
 *   `.` transparent   `o` outline (dark)   `a` accent (body)
 *   `A` accent shade  `h` highlight        `e` eye white   `p` pupil
 */
const PALETTE: Record<string, string> = {
  o: "#15151a",
  a: "var(--pet-accent)",
  A: "color-mix(in srgb, var(--pet-accent) 62%, #15151a)",
  h: "color-mix(in srgb, var(--pet-accent) 45%, white)",
  e: "#f4f6ff",
  p: "#15151a",
};

export function PetAvatar(props: { styleId: PetStyleId; size?: number }) {
  const size = props.size ?? 48;
  if (props.styleId === "pixel-cube") {
    return <PixelSprite size={size} rows={KNIGHT_ROWS} className="pet-avatar-pixel-knight" />;
  }
  if (props.styleId === "owl") {
    return <PixelSprite size={size} rows={MAGE_ROWS} className="pet-avatar-pixel-mage" />;
  }
  return <PixelSprite size={size} rows={SLIME_ROWS} className="pet-avatar-pixel-slime" />;
}

/**
 * Paints a sprite grid. `viewBox` is the grid size, so one unit == one pixel-art
 * cell; only non-transparent cells emit a rect, which keeps the DOM small.
 */
function PixelSprite(props: { size: number; rows: readonly string[]; className: string }) {
  const rows = props.rows;
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const cells: { x: number; y: number; fill: string }[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const token = row[x] as string;
      const fill = PALETTE[token];
      if (fill) cells.push({ x, y, fill });
    }
  });
  return (
    <svg
      width={props.size}
      height={props.size}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-hidden="true"
      className={`pet-avatar ${props.className}`}
      shapeRendering="crispEdges"
    >
      {cells.map((cell) => (
        <rect
          key={`${cell.x}-${cell.y}`}
          x={cell.x}
          y={cell.y}
          width={1}
          height={1}
          fill={cell.fill}
        />
      ))}
    </svg>
  );
}

/** Slime knight: a blobby body with a helm crest and stubby legs. */
const SLIME_ROWS = [
  "......hhhh......",
  ".....oooooo.....",
  "....oaaaaaao....",
  "...oaaaaaaaaao..",
  "..oaaoaaaaooao..",
  "..oaooaaaaooao..",
  "..oaaaaeaeaao...",
  "..oaaaapapaao...",
  "..oaaaaaaaaao...",
  ".oaAaaaaaaaAao..",
  ".oaAaaaaaaaAao..",
  "..oAAaaaaaAAo...",
  "...ooooooooo....",
  "...oo.....oo....",
  "..ooo.....ooo...",
  "................",
];

/** Owl mage: a pointed hat, round eyes, and a beak. */
const MAGE_ROWS = [
  ".......oo.......",
  "......oAAo......",
  ".....oAAAAo.....",
  "....oAAAAAAo....",
  "....oohhhhoo....",
  "...oaaaaaaaaao..",
  "..oaaeaaaaaeaao.",
  "..oaaeaaaaaeaao.",
  "..oaapaaaaapaao.",
  "..oaaapaaaapao..",
  "..oaAAapappaao..",
  "..oaAAaaaaAAao..",
  "...oAaaaaaaAao..",
  "...oAao..oAao...",
  "....oo....oo....",
  "................",
];

/** Sphere sentinel: a round orb wearing a visored helm. */
const KNIGHT_ROWS = [
  "......oooo......",
  "....oohhhhoo....",
  "...oaaaaaaaaao..",
  "..oaaaaaaaaaaao.",
  "..oaoaaaaaaaoao.",
  ".oaoooooooooooao",
  ".oaoeppeaaeppao.",
  ".oaoooooooooooao",
  "..oaaaaaaaaaaao.",
  "..oaAaaaaaaAao..",
  "...oAaaaaaaAo...",
  "....oooooooo....",
  "...oo......oo...",
  "...oo......oo...",
  "................",
  "................",
];
