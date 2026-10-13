import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { TOKENS } from "./tokens";
import {
  isBottleneckNode,
  phaseProgress,
  phaseStallMinutes,
  TEST_PIPELINE_PHASES,
  type OrgFlowData,
  type OrgFlowEmployeeNode,
  type OrgFlowPhaseNode,
} from "@/renderer/state/orgFlow";
import { PixelPanel } from "./pixel";

const css = (hex: number): string => `#${hex.toString(16).padStart(6, "0")}`;

/**
 * Org-flow swimlane: one lane per level-1 container, one pixel card per
 * employee. Capability dots per card: solid green = configured+implemented
 * ("have"), hollow red = configured-but-unimplemented ("missing", pure
 * visual + title text), dim gray = unconfigured. Cards with ≥2 missing
 * capabilities get a red dashed bottleneck border. Pure presentational —
 * all data comes from buildOrgFlow selectors.
 */

function CapabilityDots({ data }: { data: Pick<OrgFlowEmployeeNode, "capabilities"> }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1" aria-hidden="true">
      {data.capabilities.map((cap) => {
        if (cap.configured && cap.implemented) {
          return (
            <span
              key={cap.id}
              title={cap.label}
              style={{
                width: 8,
                height: 8,
                backgroundColor: "#6BCF7F",
                border: "1px solid #1A1320",
              }}
            />
          );
        }
        if (cap.configured) {
          return (
            <span
              key={cap.id}
              title={cap.unknown ? `${cap.label} (unknown)` : cap.label}
              style={{
                width: 8,
                height: 8,
                backgroundColor: "#FFF8E7",
                border: "2px dashed #FF6B6B",
              }}
            />
          );
        }
        return (
          <span
            key={cap.id}
            style={{
              width: 8,
              height: 8,
              backgroundColor: css(TOKENS.cream300),
              border: "1px solid #6B5878",
            }}
          />
        );
      })}
    </div>
  );
}

function EmployeeCard({ emp }: { emp: OrgFlowEmployeeNode }) {
  const blocked = isBottleneckNode(emp);
  return (
    <PixelPanel
      style={{
        border: blocked ? "2px dashed #FF6B6B" : undefined,
        width: "100%",
      }}
    >
      <div className="flex items-center gap-2" style={{ fontFamily: "monospace" }}>
        <span style={{ fontSize: 13, color: css(TOKENS.ink900) }}>{emp.name}</span>
        {emp.rank !== undefined ? (
          <span className="flex gap-0.5" aria-label={`rank ${emp.rank}`}>
            {Array.from({ length: emp.rank }, (_, i) => (
              <span key={i} style={{ width: 5, height: 4, backgroundColor: css(TOKENS.ink900) }} />
            ))}
          </span>
        ) : null}
        {blocked ? (
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#FF6B6B" }}>
            <Trans>Bottleneck</Trans>
          </span>
        ) : null}
      </div>
      <CapabilityDots data={emp} />
    </PixelPanel>
  );
}

const PHASE_TITLES: Record<string, string> = {
  planning: "Planning",
  requirements: "Requirements",
  dynamic: "Dynamic",
  report: "Report",
  done: "Done",
};

function PipelineLanes(props: {
  lanes: readonly OrgFlowPhaseNode[];
  employeeName: (id: string) => string | undefined;
  nowMs: number;
}) {
  if (props.lanes.length === 0) return null;
  const now = props.nowMs;
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--hairline)] pt-3">
      <div style={{ fontFamily: "monospace", fontSize: 12, color: css(TOKENS.ink700) }}>
        <Trans>Test project pipeline</Trans>
      </div>
      {props.lanes.map((lane) => {
        const progress = phaseProgress(lane.phase);
        const stall = phaseStallMinutes(lane.enteredAt, now);
        const owner = lane.ownerEmployeeId ? props.employeeName(lane.ownerEmployeeId) : undefined;
        return (
          <div
            key={lane.projectId}
            className="flex items-center gap-2"
            style={{ fontFamily: "monospace" }}
          >
            <span
              style={{
                width: 120,
                fontSize: 12,
                color: css(TOKENS.ink900),
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {lane.projectName ?? lane.projectId}
            </span>
            {TEST_PIPELINE_PHASES.map((phase, index) => {
              const state =
                index < progress.index ? "done" : index === progress.index ? "current" : "todo";
              return (
                <span
                  key={phase}
                  title={PHASE_TITLES[phase]}
                  style={{
                    width: 48,
                    height: 20,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    color: state === "todo" ? css(TOKENS.ink500) : css(TOKENS.ink900),
                    backgroundColor:
                      state === "done"
                        ? "#6BCF7F"
                        : state === "current"
                          ? "#FFD93D"
                          : css(TOKENS.cream300),
                    border: `2px solid ${css(TOKENS.ink900)}`,
                  }}
                >
                  {PHASE_TITLES[phase]}
                </span>
              );
            })}
            <span style={{ fontSize: 11, color: css(TOKENS.ink700) }}>
              {owner ? `${owner}` : null}
              {stall !== undefined ? ` · ${stall}m` : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function OrgFlowPanel(props: { data: OrgFlowData }) {
  const [nowMs] = useState(() => Date.now());
  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3"
      style={{ backgroundColor: css(TOKENS.paper100) }}
    >
      <div className="flex items-center gap-3" style={{ fontFamily: "monospace" }}>
        <span className="text-xs text-muted">
          <Trans>
            Capability map: green = have it, hollow red dashed = configured but not implemented,
            gray = not configured.
          </Trans>
        </span>
        <span className="flex items-center gap-1 text-xs" style={{ color: css(TOKENS.ink700) }}>
          <span
            aria-hidden="true"
            style={{ width: 8, height: 8, backgroundColor: "#6BCF7F", border: "1px solid #1A1320" }}
          />
          <Trans>Have</Trans>
        </span>
        <span className="flex items-center gap-1 text-xs" style={{ color: css(TOKENS.ink700) }}>
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              backgroundColor: "#FFF8E7",
              border: "2px dashed #FF6B6B",
            }}
          />
          <Trans>Missing</Trans>
        </span>
        <span className="flex items-center gap-1 text-xs" style={{ color: css(TOKENS.ink700) }}>
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              backgroundColor: css(TOKENS.cream300),
              border: "1px solid #6B5878",
            }}
          />
          <Trans>Not configured</Trans>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-wrap items-start gap-4">
        {props.data.groups.map((group) => (
          <div
            key={group.id}
            className="flex min-w-60 flex-col gap-2"
            role="group"
            aria-label={group.name}
          >
            <div
              style={{
                padding: "4px 8px",
                backgroundColor: css(TOKENS.cream200),
                border: `2px solid ${css(TOKENS.ink900)}`,
                fontFamily: "monospace",
                fontSize: 12,
                color: css(TOKENS.ink900),
                alignSelf: "flex-start",
              }}
            >
              {group.name}
            </div>
            {group.teams.map((team) => (
              <div
                key={team.id}
                className="flex flex-col gap-1.5 pl-2"
                role="group"
                aria-label={team.name}
              >
                <div
                  style={{
                    padding: "2px 6px",
                    backgroundColor: css(TOKENS.cream50),
                    border: `1.5px solid ${css(TOKENS.ink700)}`,
                    fontFamily: "monospace",
                    fontSize: 11,
                    color: css(TOKENS.ink700),
                    alignSelf: "flex-start",
                  }}
                >
                  {team.name}
                </div>
                {team.employees.map((emp) => (
                  <EmployeeCard key={emp.id} emp={emp} />
                ))}
              </div>
            ))}
            {group.directEmployees.map((emp) => (
              <EmployeeCard key={emp.id} emp={emp} />
            ))}
          </div>
        ))}
        {props.data.unranked.length > 0 ? (
          <div className="flex min-w-60 flex-col gap-2">
            <div
              style={{
                padding: "4px 8px",
                backgroundColor: css(TOKENS.cream200),
                border: `2px solid ${css(TOKENS.ink900)}`,
                fontFamily: "monospace",
                fontSize: 12,
                color: css(TOKENS.ink700),
              }}
            >
              <Trans>Unranked</Trans>
            </div>
            {props.data.unranked.map((emp) => (
              <PixelPanel key={emp.id}>
                <div style={{ fontFamily: "monospace", fontSize: 13, color: css(TOKENS.ink900) }}>
                  {emp.name}
                </div>
                <CapabilityDots data={emp} />
              </PixelPanel>
            ))}
          </div>
        ) : null}
      </div>
      <PipelineLanes
        lanes={props.data.pipelineLanes}
        nowMs={nowMs}
        employeeName={(id) => {
          for (const group of props.data.groups) {
            for (const team of group.teams) {
              const hit = team.employees.find((e) => e.id === id);
              if (hit) return hit.name;
            }
            const direct = group.directEmployees.find((e) => e.id === id);
            if (direct) return direct.name;
          }
          return props.data.unranked.find((e) => e.id === id)?.name;
        }}
      />
    </div>
  );
}
