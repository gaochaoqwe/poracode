import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { ScenarioOutputMode } from "@/renderer/scenarios/catalog";
import { ScenarioOutputModePicker } from "./ScenarioOutputModePicker";

const modes: ScenarioOutputMode[] = [
  {
    id: "reuse",
    label: { id: "reuse.label", message: "Based on reference code" },
    hint: { id: "reuse.hint", message: "Copy it into src-new/ and adapt." },
    agentInstruction: { id: "reuse.instruction", message: "Reuse it." },
    recommendedWhenReferenceSelected: true,
  },
  {
    id: "scratch",
    label: { id: "scratch.label", message: "From scratch" },
    hint: { id: "scratch.hint", message: "Create an empty src-new/." },
    agentInstruction: { id: "scratch.instruction", message: "Start fresh." },
    recommendedWhenReferenceSelected: false,
  },
];

describe("ScenarioOutputModePicker", () => {
  it("renders every mode and marks the selected one", () => {
    render(
      <ScenarioOutputModePicker modes={modes} selectedMode="scratch" onSelectMode={() => {}} />,
    );

    const reuse = screen.getByRole("radio", { name: "Based on reference code" });
    const scratch = screen.getByRole("radio", { name: "From scratch" });
    expect(reuse).toBeInTheDocument();
    expect(scratch).toBeChecked();
  });

  it("reports the picked mode", () => {
    const onSelectMode = vi.fn<(modeId: string) => void>();
    render(
      <ScenarioOutputModePicker modes={modes} selectedMode="scratch" onSelectMode={onSelectMode} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Based on reference code" }));

    expect(onSelectMode).toHaveBeenCalledWith("reuse");
  });
});
