export * from "./GdsAgentIcon";

import { GdsAgentIcon } from "./GdsAgentIcon";
import providerManifest from "./manifest";
import { standardPlanApprovalControls } from "../composerControlBuilders";
import { registerProviderIcon } from "../ProviderIcon";
import { registerComposerControls } from "../providerComposer";
import { registerCommitGenDefaults } from "../commitGen";
import { registerConflictResolverDefaults } from "../conflictResolver";
import { registerTitleGenDefaults } from "../titleGen";

const PROVIDER_KIND = providerManifest.kind;

registerProviderIcon(PROVIDER_KIND, GdsAgentIcon);
// One-shot utility defaults are placeholders — they get superseded by the
// real model list when the supervisor's capabilitiesProbe returns from a
// live install. They exist today so gdsAgent shows up in the renderer
// even before the first detection pass completes.
registerCommitGenDefaults(PROVIDER_KIND, {
  label: "gdsAgent",
  hint: "Sonnet 4.5",
  model: "gdsAgent-sonnet-4.5",
  effort: "",
});
registerTitleGenDefaults(PROVIDER_KIND, {
  label: "gdsAgent",
  hint: "Sonnet 4.5",
  model: "gdsAgent-sonnet-4.5",
  effort: "",
});
registerConflictResolverDefaults(PROVIDER_KIND, {
  label: "gdsAgent",
  hint: "Sonnet 4.5",
  model: "gdsAgent-sonnet-4.5",
  effort: "",
});

registerComposerControls(PROVIDER_KIND, (input) => standardPlanApprovalControls(input));
