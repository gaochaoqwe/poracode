import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { SCENARIOS } from "@/renderer/scenarios/catalog";
import { ScenarioGuideCard } from "./ScenarioGuideCard";

const scenario = SCENARIOS.find((item) => item.id === "write-requirements")!;

describe("ScenarioGuideCard", () => {
  it("renders the scenario title and every step in order", () => {
    render(<ScenarioGuideCard scenario={scenario} onDismiss={() => {}} />);

    expect(screen.getByText(scenario.title.message ?? "")).toBeInTheDocument();
    for (const step of scenario.steps) {
      expect(screen.getByText(step.message ?? "")).toBeInTheDocument();
    }
  });

  it("dismisses when the close button is pressed", () => {
    const onDismiss = vi.fn<() => void>();
    render(<ScenarioGuideCard scenario={scenario} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
