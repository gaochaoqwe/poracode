import { msg } from "@lingui/core/macro";
import type { RendererProviderManifest } from "../providerManifest";

export default {
  kind: "gds-agent",
  label: msg`gdsAgent`,
  // First-class position right after the native gdsAgent CLI, since this is
  // the same product family delivered as an offline ACP harness.
  order: 15,
} satisfies RendererProviderManifest;
