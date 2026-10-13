import type { StatusTone } from "../statusTone";
import { StatusIcon, type ProviderBrandGradient, type ProviderBrandPaint } from "../StatusIcon";

interface CreateProviderIconOptions {
  cssPrefix: string;
  path: string;
  viewBox: string;
  fillRule?: "evenodd" | "nonzero";
  secondaryPath?: string;
  defaultTone?: StatusTone;
  /**
   * Brand paint for the mark's neutral tones (inactive/active). Providers whose
   * brand is a black mark pass `{ light: "#000", dark: "#fff" }` so it stays
   * legible on both themes. Status tones ignore it and keep their own colors.
   */
  brand?: ProviderBrandPaint;
  /** Solid paint for {@link secondaryPath}, e.g. Pi's badge behind the mark. */
  secondaryBrand?: ProviderBrandPaint;
  /** Gradient paint for the primary path (Codex, Gemini). Wins over `brand`. */
  brandGradient?: ProviderBrandGradient;
}

interface ProviderIconProps {
  tone?: StatusTone;
  className?: string;
  title?: string;
}

/**
 * Pre-bake a `mask-image` data URL of the brand path. The shine overlay on
 * the working state uses this to clip a CSS-animated band to the brand
 * outline, so the animation runs entirely on the compositor without per-frame
 * SVG paint. Called once per provider at registration time.
 */
function buildMaskUrl(path: string, viewBox: string, fillRule?: "evenodd" | "nonzero"): string {
  const ruleAttr = fillRule ? ` fill-rule='${fillRule}' clip-rule='${fillRule}'` : "";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${viewBox}'><path d='${path}' fill='black'${ruleAttr}/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

export function createProviderIcon(opts: CreateProviderIconOptions) {
  const defaultTone = opts.defaultTone ?? "inactive";
  const maskUrl = buildMaskUrl(opts.path, opts.viewBox, opts.fillRule);
  return function ProviderIcon(props: ProviderIconProps) {
    return (
      <StatusIcon
        cssPrefix={opts.cssPrefix}
        path={opts.path}
        tone={props.tone ?? defaultTone}
        viewBox={opts.viewBox}
        className={props.className}
        maskUrl={maskUrl}
        {...(opts.fillRule ? { fillRule: opts.fillRule } : {})}
        {...(opts.secondaryPath ? { secondaryPath: opts.secondaryPath } : {})}
        {...(opts.brand ? { brand: opts.brand } : {})}
        {...(opts.secondaryBrand ? { secondaryBrand: opts.secondaryBrand } : {})}
        {...(opts.brandGradient ? { brandGradient: opts.brandGradient } : {})}
        {...(props.title ? { title: props.title } : {})}
      />
    );
  };
}
