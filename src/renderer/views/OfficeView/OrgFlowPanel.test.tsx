import { describe, expect, it } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { OrgFlowPanel } from "./OrgFlowPanel";
import { buildOrgFlow } from "@/renderer/state/orgFlow";

const workspaces = [
  { id: "c-test", name: "Software testing", agentKind: "openai", accentColor: "#fff" },
  {
    id: "org-a",
    name: "Ada",
    agentKind: "openai",
    accentColor: "#fff",
    roleRank: 1,
    parentWorkspaceId: "c-test",
    capabilityIds: ["code-review"],
  },
  {
    id: "org-b",
    name: "Ben",
    agentKind: "openai",
    accentColor: "#fff",
    roleRank: 2,
    parentWorkspaceId: "c-test",
    teamId: "t-exec",
    capabilityIds: ["cross-role-handoff", "site-replay-skill"],
  },
] as const;

const teams = [{ id: "t-exec", name: "Test execution team" }] as const;

const lanes = [
  { projectId: "p1", projectName: "M100", phase: "dynamic" as const, ownerEmployeeId: "org-b" },
] as const;

describe("OrgFlowPanel", () => {
  it("renders group lanes, team sub-lanes, employee cards and the bottleneck marker", () => {
    const data = buildOrgFlow(workspaces as never, teams as never, lanes as never);
    render(<OrgFlowPanel data={data} />);
    // Pipeline section.
    expect(document.body).toHaveTextContent("Test project pipeline");
    expect(document.body).toHaveTextContent("M100");
    expect(document.body).toHaveTextContent("Dynamic");
    // Group lane header.
    expect(document.body).toHaveTextContent("Software testing");
    // Team sub-lane header.
    expect(document.body).toHaveTextContent("Test execution team");
    // Both employees present.
    expect(document.body).toHaveTextContent("Ada");
    expect(document.body).toHaveTextContent("Ben");
    // Ben has two missing configured capabilities → bottleneck badge.
    expect(document.body).toHaveTextContent("Bottleneck");
    // Legend rows.
    expect(document.body).toHaveTextContent("Have");
    expect(document.body).toHaveTextContent("Missing");
    expect(document.body).toHaveTextContent("Not configured");
  });
});
