import { useState } from "react";
import { Tabs } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { SettingsPage } from "@/renderer/views/SettingsOverlay/parts/SettingsForm";
import { PluginsPanel } from "./PluginsPanel";
import { McpServersPanel } from "./McpServersPanel";

type ConnectorKind = "plugins" | "mcp";

function isConnectorKind(key: unknown): key is ConnectorKind {
  return key === "plugins" || key === "mcp";
}

/**
 * Connectors owns every way AgentEmployee reaches an external service: plugin
 * packages (which bundle skills and MCP servers) and raw MCP server configs.
 * The two keep their own managers — the tab is only the switch between them.
 */
export function ConnectorsPanel() {
  const { t } = useLingui();
  const [kind, setKind] = useState<ConnectorKind>("plugins");

  return (
    <SettingsPage
      title={t`Connectors`}
      description={t`Connect AgentEmployee to external services. Plugins bundle skills and MCP servers; MCP Servers wire up individual tool providers.`}
      bodyClassName="space-y-5"
    >
      <Tabs
        className="w-full"
        variant="secondary"
        selectedKey={kind}
        onSelectionChange={(key) => {
          if (isConnectorKind(key)) setKind(key);
        }}
      >
        <Tabs.ListContainer className="w-fit">
          <Tabs.List aria-label={t`Connector type`}>
            <Tabs.Tab id="plugins">
              {t`Plugins`}
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="mcp">
              {t`MCP Servers`}
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel className="pt-5" id="plugins">
          <PluginsPanel />
        </Tabs.Panel>
        <Tabs.Panel className="pt-5" id="mcp">
          <McpServersPanel />
        </Tabs.Panel>
      </Tabs>
    </SettingsPage>
  );
}
