import { createProviderIcon } from "../common/createProviderIcon";

// Placeholder icon: a stylised "C" inside a square viewBox. Replace the path
// with the real Cline brand mark once a vetted SVG is available; the icon
// factory below is the same one every other provider uses, so a swap is a
// one-line change.
const CLINE_PATH = "M32 8a24 24 0 1 0 24 24h-8a16 16 0 1 1-16-16V8z";

export const ClineIcon = createProviderIcon({
  cssPrefix: "agentemployee-cline-icon",
  path: CLINE_PATH,
  viewBox: "0 0 64 64",
  brand: { light: "#6C5CE7", dark: "#9B8CFF" },
});
