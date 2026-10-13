export * from "./DshAgentIcon";

import { DshAgentIcon } from "./DshAgentIcon";
import providerManifest from "./manifest";
import { standardPlanApprovalControls } from "../composerControlBuilders";
import { registerProviderIcon } from "../ProviderIcon";
import { registerComposerControls } from "../providerComposer";
import { registerCommitGenDefaults } from "../commitGen";
import { registerConflictResolverDefaults } from "../conflictResolver";
import { registerTitleGenDefaults } from "../titleGen";

const PROVIDER_KIND = providerManifest.kind;

registerProviderIcon(PROVIDER_KIND, DshAgentIcon);
// One-shot utility defaults are placeholders — they get superseded by the
// real model list when the supervisor's capabilitiesProbe returns from a
// live install. They exist today so dshAgent shows up in the renderer
// even before the first detection pass completes.
registerCommitGenDefaults(PROVIDER_KIND, {
  label: "dshAgent",
  hint: "DeepSeek V4",
  model: "deepseek-v4-flash",
  effort: "",
});
registerTitleGenDefaults(PROVIDER_KIND, {
  label: "dshAgent",
  hint: "DeepSeek V4",
  model: "deepseek-v4-flash",
  effort: "",
});
registerConflictResolverDefaults(PROVIDER_KIND, {
  label: "dshAgent",
  hint: "DeepSeek V4",
  model: "deepseek-v4-flash",
  effort: "",
});

registerComposerControls(PROVIDER_KIND, (input) => standardPlanApprovalControls(input));
