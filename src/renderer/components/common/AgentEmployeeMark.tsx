/**
 * The AgentEmployee app mark — a bold geometric "A" whose crossbar is drawn in
 * the brand accent, optionally set on a rounded tile.
 *
 * This replaces the legacy Pora "P." glyph: the "A" stands for *Agent*, and the
 * accent crossbar keeps the single-cool-accent identity (indigo `#8B7BFF`) that
 * the product has always used. It pairs with {@link BrandWordmark} in the app
 * header and the welcome splash.
 *
 * Drawn inline (never a bitmap) so it stays crisp from the ~20px header lockup
 * up to the 80px splash, and so the tile colour can be a theme-independent
 * brand constant rather than one raster per channel.
 */
export function AgentEmployeeMark({
  className,
  tile = true,
}: {
  className?: string | undefined;
  /** Draw the app-tile plate behind the glyph. The bare glyph (`false`)
   * inherits `currentColor` for monochrome contexts. */
  tile?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      role="img"
      aria-label="AgentEmployee"
      className={className}
      fill="none"
    >
      {tile ? <rect width="1024" height="1024" rx="232" fill="#0E0E14" /> : null}
      {/* Legs of the "A" — round joins so the apex and feet read as one bold
          letterform down to favicon sizes. */}
      <path
        d="M312 780 L512 244 L712 780"
        stroke={tile ? "#EAF0FB" : "currentColor"}
        strokeWidth="112"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The crossbar carries the brand accent — the single chromatic element
          in an otherwise moonlight/ink composition. It spans just past the
          legs' inner edges so it merges into the letterform without a seam. */}
      <path d="M400 608 H624" stroke="#8B7BFF" strokeWidth="112" />
    </svg>
  );
}
