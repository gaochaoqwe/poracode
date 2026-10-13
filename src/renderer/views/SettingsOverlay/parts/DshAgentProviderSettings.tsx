import { useState } from "react";
import { Button, toast } from "@heroui/react";
import { FileSearch, Save } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Input } from "@/renderer/components/common";
import { readBridge } from "@/renderer/bridge";
import { flushSharedSettings, useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { friendlyError } from "@/shared/messages";
import type { NativeAgentSettingsPanelProps } from "./agentRegistryNative";

/**
 * dshAgent (DeepSeek Harness) provider settings panel.
 *
 * AgentEmployee models dshAgent (via the portable `dshAgent.exe` ACP launcher)
 * as a single OpenAI-compatible endpoint, so this panel exposes the launcher
 * path, model, API key, and base URL. The values land in
 * `agentSettings.dsh-agent.{binaryPath,model,apiKey,baseUrl}` and the supervisor
 * merges them into the ACP spawn env on the next launch as `DSH_MODEL` /
 * `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` — the exact vars the bundled DeepSeek
 * Harness reads. Empty values are persisted as empty strings (not stripped) so
 * an "unset" write is explicit and survives the round-trip; the supervisor's
 * `resolveDshAgentEnv` drops empty strings and omits the env entry.
 *
 * Unlike gdsAgent's offline copy-into-data-dir install, dshAgent is a portable
 * bundle: `dshAgent.exe` carries its node-runtime + node_modules beside it, so
 * it runs in place from any folder. The user just points `binaryPath` at the
 * launcher (via Browse) and no copy is needed — which is why there is no
 * "Offline install…" step here.
 */
export function DshAgentProviderSettings(props: NativeAgentSettingsPanelProps) {
  const { t } = useLingui();
  const { agentKind, wslDistros } = props;
  const stored = useSharedSettings((state) => state.agentSettings[agentKind]) ?? {};
  const setAgentSetting = useSharedSettings((state) => state.setAgentSetting);

  // `agentSettings[agentKind]` is `Record<string, boolean | string>` so every
  // saved value is `string | boolean | undefined`. Narrow to string before
  // handing the field to HeroUI's Input — its `value` prop rejects booleans.
  const storedString = (key: string): string => {
    const raw = (stored as Record<string, unknown>)[key];
    return typeof raw === "string" ? raw : "";
  };
  const [binaryPath, setBinaryPath] = useState(storedString("binaryPath"));
  const [model, setModel] = useState(storedString("model"));
  const [apiKey, setApiKey] = useState(storedString("apiKey"));
  const [baseUrl, setBaseUrl] = useState(storedString("baseUrl"));
  const [pending, setPending] = useState(false);

  const hasChanges =
    binaryPath !== (stored.binaryPath ?? "") ||
    model !== (stored.model ?? "") ||
    apiKey !== (stored.apiKey ?? "") ||
    baseUrl !== (stored.baseUrl ?? "");

  const onBrowse = async () => {
    try {
      const picked = await readBridge().pickFiles({
        title: t`Select dshAgent.exe`,
        filters: [{ name: "dshAgent.exe", extensions: ["exe"] }],
      });
      const sourcePath = picked?.[0];
      if (!sourcePath) return;
      setBinaryPath(sourcePath);
    } catch (error) {
      toast.danger(friendlyError(error));
    }
  };

  const onSave = async () => {
    setPending(true);
    const previous = { ...stored };
    try {
      setAgentSetting(agentKind, "binaryPath", binaryPath);
      setAgentSetting(agentKind, "model", model);
      setAgentSetting(agentKind, "apiKey", apiKey);
      setAgentSetting(agentKind, "baseUrl", baseUrl);
      await flushSharedSettings();
      await readBridge().refreshAgentStatuses(wslDistros, { agentKinds: [agentKind] });
    } catch (error) {
      // Roll back to the last good values so a failed save doesn't leave the
      // UI out of sync with what the supervisor actually sees.
      setAgentSetting(agentKind, "binaryPath", previous.binaryPath ?? "");
      setAgentSetting(agentKind, "model", previous.model ?? "");
      setAgentSetting(agentKind, "apiKey", previous.apiKey ?? "");
      setAgentSetting(agentKind, "baseUrl", previous.baseUrl ?? "");
      toast.danger(friendlyError(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="border-t border-border/10 pt-3">
      <div className="mb-3">
        <p className="text-sm font-medium text-foreground">
          <Trans>dshAgent credentials</Trans>
        </p>
        <p className="text-xs text-muted">
          <Trans>
            Point at your portable <code>dshAgent.exe</code> (the DeepSeek Harness launcher) and
            configure the OpenAI-compatible endpoint it uses. Leave a field empty to fall back to
            whatever login the harness holds on disk.
          </Trans>
        </p>
      </div>

      <div className="grid gap-3">
        <label className="flex flex-col gap-1" htmlFor="dsh-agent-settings-binary">
          <span className="text-xs text-muted">
            <Trans>Launcher path</Trans>
          </span>
          <div className="flex gap-1.5">
            <Input
              id="dsh-agent-settings-binary"
              aria-label={t`dshAgent launcher path`}
              className="h-8 min-h-8"
              placeholder={t`e.g. C:/deepseek-harness/dshAgent.exe`}
              value={binaryPath}
              disabled={pending}
              onChange={(event) => setBinaryPath(event.currentTarget.value)}
            />
            <Button
              size="sm"
              variant="secondary"
              className="h-8 min-h-8 shrink-0 gap-1 px-2.5 text-[11px]"
              aria-label={t`Browse for dshAgent.exe`}
              isDisabled={pending}
              onPress={() => void onBrowse()}
            >
              <FileSearch className="size-3" />
              <Trans>Browse…</Trans>
            </Button>
          </div>
        </label>

        <label className="flex flex-col gap-1" htmlFor="dsh-agent-settings-model">
          <span className="text-xs text-muted">
            <Trans>Model</Trans>
          </span>
          <Input
            id="dsh-agent-settings-model"
            aria-label={t`dshAgent model`}
            className="h-8 min-h-8"
            placeholder={t`e.g. deepseek-v4-pro`}
            value={model}
            disabled={pending}
            onChange={(event) => setModel(event.currentTarget.value)}
          />
        </label>

        <label className="flex flex-col gap-1" htmlFor="dsh-agent-settings-api-key">
          <span className="text-xs text-muted">
            <Trans>API key</Trans>
          </span>
          <Input
            id="dsh-agent-settings-api-key"
            aria-label={t`dshAgent API key`}
            className="h-8 min-h-8"
            placeholder={t`Paste your provider API key`}
            type="password"
            value={apiKey}
            disabled={pending}
            onChange={(event) => setApiKey(event.currentTarget.value)}
          />
        </label>

        <label className="flex flex-col gap-1" htmlFor="dsh-agent-settings-base-url">
          <span className="text-xs text-muted">
            <Trans>Base URL</Trans>
          </span>
          <Input
            id="dsh-agent-settings-base-url"
            aria-label={t`dshAgent base URL`}
            className="h-8 min-h-8"
            placeholder={t`e.g. https://api.deepseek.com`}
            value={baseUrl}
            disabled={pending}
            onChange={(event) => setBaseUrl(event.currentTarget.value)}
          />
        </label>
      </div>

      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          variant="tertiary"
          className="h-8 min-h-8 gap-1 px-2.5 text-[11px]"
          aria-label={t`Save dshAgent settings`}
          isDisabled={pending || !hasChanges}
          isPending={pending}
          onPress={() => void onSave()}
        >
          <Save className="size-3" />
          <Trans>Save</Trans>
        </Button>
      </div>
    </div>
  );
}
