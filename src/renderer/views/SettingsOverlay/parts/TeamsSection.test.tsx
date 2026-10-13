import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { Team } from "@/shared/contracts";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { TeamsSection } from "./TeamsSection";

vi.mock("@/renderer/bridge", () => ({
  isRemoteSession: () => false,
}));

const team: Team = {
  id: "t-mgmt",
  name: "mgmt-team",
  memberEmployeeIds: ["ws-1"],
  dispatchPolicy: "round-robin",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function currentTeam(): Team {
  const found = useSharedSettings.getState().teams[0];
  if (!found) throw new Error("Expected a team in shared settings");
  return found;
}

beforeEach(() => {
  useSharedSettings.setState({ teams: [team], workspaces: [] });
});

describe("TeamsSection visibility toggle", () => {
  it("hides a visible team from navigation on click", () => {
    render(<TeamsSection />);

    fireEvent.click(screen.getByRole("button", { name: "Hide team mgmt-team from navigation" }));

    expect(currentTeam().hiddenInNav).toBe(true);
  });

  it("shows a hidden team again", () => {
    useSharedSettings.setState({ teams: [{ ...team, hiddenInNav: true }] });
    render(<TeamsSection />);

    fireEvent.click(screen.getByRole("button", { name: "Show team mgmt-team in navigation" }));

    expect(currentTeam().hiddenInNav).toBe(false);
  });
});
