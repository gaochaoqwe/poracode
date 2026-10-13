import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import {
  REQUIREMENT_QUALITY_ISSUE_TYPES,
  REQUIREMENT_QUALITY_SEVERITIES,
  REQUIREMENT_QUALITY_STATUSES,
  type RequirementQualityIssueType,
  type RequirementQualitySeverity,
  type RequirementQualityStatus,
} from "@/shared/contracts";

/**
 * Localized labels for the fixed requirement-quality catalog. The ids live in
 * `@/shared/contracts/requirementQuality`; keeping the copy here (not in shared)
 * lets Lingui extract it and mirrors the scenario id/copy split. A test asserts
 * every shared id has a label, so a new issue type cannot ship unlabeled.
 */
export const ISSUE_TYPE_LABELS: Record<RequirementQualityIssueType, MessageDescriptor> = {
  ambiguity: msg`Ambiguous wording`,
  incompleteness: msg`Incomplete expression`,
  unverifiable: msg`Not verifiable`,
  "missing-metric": msg`Missing metric`,
  "missing-source": msg`Missing source`,
  duplication: msg`Duplicate`,
  conflict: msg`Conflict`,
  "metric-value-conflict": msg`Inconsistent metric value`,
  "term-inconsistency": msg`Inconsistent terminology`,
  "interface-field-inconsistency": msg`Inconsistent interface field`,
};

export const SEVERITY_LABELS: Record<RequirementQualitySeverity, MessageDescriptor> = {
  high: msg`High`,
  medium: msg`Medium`,
  low: msg`Low`,
};

export const STATUS_LABELS: Record<RequirementQualityStatus, MessageDescriptor> = {
  open: msg`Open`,
  confirmed: msg`Confirmed`,
  revised: msg`Revised`,
  rejected: msg`Rejected`,
};

/** Sort rank per severity: high first. */
export const SEVERITY_RANK: Record<RequirementQualitySeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export const SEVERITY_VALUES = REQUIREMENT_QUALITY_SEVERITIES;
export const STATUS_VALUES = REQUIREMENT_QUALITY_STATUSES;
export const ISSUE_TYPE_VALUES = REQUIREMENT_QUALITY_ISSUE_TYPES;
