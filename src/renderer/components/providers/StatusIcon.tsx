import { useId, type CSSProperties } from "react";
import type { StatusTone } from "./statusTone";
import { syncMaskScanPhase } from "./syncMaskScanPhase";

/**
 * Light/dark pair of paint values for a brand mark. `dark` falls back to
 * `light`, so a brand that reads the same in both themes declares one value.
 */
export interface ProviderBrandPaint {
  light: string;
  dark?: string;
}

/** Linear gradient paint, e.g. Codex's violet→blue or Gemini's sparkle. */
export interface ProviderBrandGradient {
  from: string;
  via?: string;
  to: string;
}

export function StatusIcon(props: {
  tone: StatusTone;
  path: string;
  viewBox: string;
  fillRule?: "evenodd" | "nonzero";
  cssPrefix: string;
  className?: string | undefined;
  title?: string | undefined;
  /**
   * Optional second path rendered behind `path` at reduced opacity. Useful
   * for two-region brand marks (e.g. OpenCode's frame + inner panel) where
   * a single fill would lose the brand's tonal contrast.
   */
  secondaryPath?: string | undefined;
  /**
   * Inline `mask-image` data URL of the primary brand path, baked by
   * `createProviderIcon` once per provider. Used to clip the working-state
   * shine overlay to the brand outline. Optional so direct callers without a
   * factory still render (they just won't show a shine in `working`).
   */
  maskUrl?: string | undefined;
  /**
   * Brand paint for the mark's neutral tones (inactive/active), so pickers and
   * settings show the product's real colors. Status tones (working/error/
   * attention/finished/done) keep their semantic colors and ignore it.
   */
  brand?: ProviderBrandPaint | undefined;
  /** Brand paint for {@link secondaryPath}, rendered solid instead of the 32% shell. */
  secondaryBrand?: ProviderBrandPaint | undefined;
  /** Gradient paint for the primary path; wins over {@link brand} when both are set. */
  brandGradient?: ProviderBrandGradient | undefined;
}) {
  const {
    tone,
    path,
    viewBox,
    fillRule,
    cssPrefix,
    className,
    title,
    secondaryPath,
    maskUrl,
    brand,
    secondaryBrand,
    brandGradient,
  } = props;

  // Gradient ids must be valid fragment references — `useId()` returns a value
  // with colons, which `url(#…)` cannot address — and unique per instance, so
  // several icons of one provider can live on the same page.
  const gradientId = `${cssPrefix}-brand-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const brandVars = {
    ...(brandGradient
      ? { "--lc-brand": `url(#${gradientId})`, "--lc-brand-dark": `url(#${gradientId})` }
      : brand
        ? { "--lc-brand": brand.light, "--lc-brand-dark": brand.dark ?? brand.light }
        : {}),
    ...(secondaryBrand
      ? {
          "--lc-brand-2": secondaryBrand.light,
          "--lc-brand-2-dark": secondaryBrand.dark ?? secondaryBrand.light,
          "--lc-brand-2-opacity": "1",
        }
      : {}),
  } as CSSProperties;

  const [, , vbW, vbH] = viewBox.split(" ").map(Number);
  const viewBoxWidth = vbW ?? 16;
  const viewBoxHeight = vbH ?? 16;

  const pathProps = fillRule ? ({ clipRule: fillRule, fillRule } as const) : {};

  return (
    <span
      className={`agentemployee-provider-icon agentemployee-provider-icon--${tone} ${cssPrefix} ${cssPrefix}--${tone}${className ? ` ${className}` : ""}`}
      style={brandVars}
    >
      <svg
        aria-hidden={title ? undefined : true}
        className="agentemployee-provider-icon__svg"
        role={title ? "img" : undefined}
        viewBox={viewBox}
      >
        {title ? <title>{title}</title> : null}
        {brandGradient ? (
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={brandGradient.from} />
              {brandGradient.via ? <stop offset="50%" stopColor={brandGradient.via} /> : null}
              <stop offset="100%" stopColor={brandGradient.to} />
            </linearGradient>
          </defs>
        ) : null}
        {tone === "working" ? (
          <path className="agentemployee-provider-icon__shell" d={path} {...pathProps} />
        ) : null}
        {secondaryPath ? (
          <path className="agentemployee-provider-icon__shell" d={secondaryPath} {...pathProps} />
        ) : null}
        <path
          className={`agentemployee-provider-icon__fill${tone === "done" ? " opacity-40" : ""}`}
          d={path}
          {...pathProps}
        />
        {tone === "done" ? (
          <svg
            viewBox="0 0 24 24"
            x={viewBoxWidth * 0.15}
            y={viewBoxHeight * 0.15}
            width={viewBoxWidth * 0.7}
            height={viewBoxHeight * 0.7}
            className="text-success"
          >
            <path
              d="M5 13l4 4L19 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </svg>
      {tone === "working" && maskUrl ? (
        <span
          ref={syncMaskScanPhase}
          className="agentemployee-provider-icon__mask-scan"
          aria-hidden="true"
          style={{ WebkitMaskImage: maskUrl, maskImage: maskUrl }}
        />
      ) : null}
    </span>
  );
}
