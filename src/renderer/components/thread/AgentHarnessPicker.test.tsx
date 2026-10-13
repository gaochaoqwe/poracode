import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentStatus } from "@/shared/contracts";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import "@/renderer/components/providers/bootstrap";
import { AgentHarnessPicker } from "./AgentHarnessPicker";

function makeAgent(kind: string, label: string): AgentStatus {
  return {
    kind,
    label,
    installed: true,
    authState: "authenticated",
    capabilities: {
      models: [{ id: "model-1", label: "Model 1" }],
      efforts: [],
      modelEfforts: {},
      modes: ["agent"],
      approvalPolicies: [],
      sandboxModes: [],
      supportsResume: true,
      supportsDirectInput: true,
      liveInputMode: "terminal",
      presentationMode: "terminal",
      settingDefs: [],
    },
  };
}

const cline = makeAgent("cline", "Cline");
const gdsAgent = makeAgent("gds-agent", "gdsAgent");

describe("AgentHarnessPicker", () => {
  it("renders one radio per agent and marks the selected one", () => {
    render(
      <AgentHarnessPicker agents={[cline, gdsAgent]} selectedKind="cline" onSelect={() => {}} />,
    );

    expect(screen.getByRole("radiogroup", { name: "Agent" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Cline" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Cline" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "gdsAgent" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("radio", { name: "gdsAgent" })).toHaveAttribute("tabindex", "-1");
  });

  it("selects an agent on click and ignores the already selected one", () => {
    const onSelect = vi.fn<(kind: string) => void>();
    render(
      <AgentHarnessPicker agents={[cline, gdsAgent]} selectedKind="cline" onSelect={onSelect} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "gdsAgent" }));
    expect(onSelect).toHaveBeenCalledWith("gds-agent");

    onSelect.mockClear();
    fireEvent.click(screen.getByRole("radio", { name: "Cline" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("moves the selection with the arrow keys, wrapping at the ends", () => {
    const onSelect = vi.fn<(kind: string) => void>();
    render(
      <AgentHarnessPicker
        agents={[cline, gdsAgent]}
        selectedKind="gds-agent"
        onSelect={onSelect}
      />,
    );

    fireEvent.keyDown(screen.getByRole("radio", { name: "gdsAgent" }), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith("cline");

    fireEvent.keyDown(screen.getByRole("radio", { name: "gdsAgent" }), { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenLastCalledWith("cline");

    onSelect.mockClear();
    fireEvent.keyDown(screen.getByRole("radio", { name: "gdsAgent" }), { key: "Home" });
    expect(onSelect).toHaveBeenLastCalledWith("cline");

    onSelect.mockClear();
    fireEvent.keyDown(screen.getByRole("radio", { name: "gdsAgent" }), { key: "End" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps the selected pill named in the row", () => {
    render(
      <AgentHarnessPicker
        agents={[cline, gdsAgent]}
        selectedKind="gds-agent"
        onSelect={() => {}}
      />,
    );

    expect(screen.getByRole("radio", { name: "gdsAgent" })).toHaveTextContent("gdsAgent");
  });
});
