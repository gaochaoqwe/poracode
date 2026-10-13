import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { usePlugins } from "@/renderer/state/pluginsStore";
import { pluginFixture, seedBuiltInPlugins } from "@/renderer/testUtils/plugins";
import { PluginsPanel } from "./PluginsPanel";

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({ platform: "win32" }),
}));

/**
 * A package the user added themselves. Bundled ones only expose an enable
 * switch (`canUninstallPlugin` reserves removal for the opt-in sources), so a
 * user-scoped copy of the same manifest is what reaches the uninstall path.
 * The bundled copy is dropped alongside it so the catalog holds one "GitHub".
 */
function removablePlugin() {
  const bundled = pluginFixture("github");
  return {
    ...bundled,
    source: "user" as const,
    root: "/home/test/.agentemployee/plugins/github",
  };
}

describe("PluginsPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    const bundled = seedBuiltInPlugins().filter((plugin) => plugin.name !== "github");
    usePlugins.setState({ pluginsByScope: { "": [...bundled, removablePlugin()] } });
    useSharedSettings.setState({ installedPlugins: {} });
  });

  it("moves focus into plugin detail and restores it to the marketplace card", () => {
    useSharedSettings.getState().installPlugin(pluginFixture("browser-tools"));
    render(<PluginsPanel />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search plugins" }), {
      target: { value: "browser" },
    });
    const card = screen.getByText("Browser").closest<HTMLElement>("[class*='min-h-40']")!;
    fireEvent.click(within(card).getByRole("button", { name: "Browser" }));

    expect(screen.getByRole("button", { name: "Back to plugins" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Back to plugins" }));

    expect(
      within(screen.getByText("Browser").closest<HTMLElement>("[class*='min-h-40']")!).getByRole(
        "button",
        { name: "Browser" },
      ),
    ).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Search plugins" })).toHaveValue("browser");
  });

  it("restores focus to the card, not the installed shortcut, with no search query", () => {
    // The installed strip renders before the card grid. Both used to carry
    // `data-plugin-id`, so focus restore landed on the strip and jumped the user
    // to the top of the page. Neither other focus test covers this: one types a
    // query (hiding the strip) and the other uninstalls first (emptying it).
    useSharedSettings.getState().installPlugin(pluginFixture("browser-tools"));
    render(<PluginsPanel />);

    const card = screen.getByText("Browser").closest<HTMLElement>("[class*='min-h-40']")!;
    fireEvent.click(within(card).getByRole("button", { name: "Browser" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to plugins" }));

    const restored = screen.getByText("Browser").closest<HTMLElement>("[class*='min-h-40']")!;
    expect(within(restored).getByRole("button", { name: "Browser" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Open Browser" })).not.toHaveFocus();
  });

  it("keeps focus on the card after uninstalling from the detail page", () => {
    render(<PluginsPanel />);

    const card = screen.getByText("GitHub").closest<HTMLElement>("[class*='min-h-40']")!;
    fireEvent.click(within(card).getByRole("button", { name: "GitHub Install" }));
    fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to plugins" }));

    // The card stays in the marketplace after uninstalling; only its action flips.
    const restored = screen.getByText("GitHub").closest<HTMLElement>("[class*='min-h-40']")!;
    expect(within(restored).getByRole("button", { name: "GitHub" })).toHaveFocus();
    expect(within(restored).getByRole("button", { name: "GitHub Install" })).toBeVisible();
  });
});
