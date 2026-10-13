import { createProviderIcon } from "../common/createProviderIcon";

// Official compact Pi badge mark from https://pi.dev/press-kit.
const PI_MAIN_PATH =
  "M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z";
const PI_DOT_PATH = "M517.36 400H634.72V634.72H517.36Z";
// The badge is one color throughout — mark and dot share the brand paint.
const PI_BRAND = { light: "#0D9488", dark: "#2DD4BF" };

export const PiIcon = createProviderIcon({
  cssPrefix: "agentemployee-pi-icon",
  path: PI_MAIN_PATH,
  secondaryPath: PI_DOT_PATH,
  fillRule: "evenodd",
  viewBox: "0 0 800 800",
  brand: PI_BRAND,
  secondaryBrand: PI_BRAND,
});
