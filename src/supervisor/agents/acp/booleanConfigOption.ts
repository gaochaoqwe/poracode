/**
 * Access to boolean ACP `configOptions` entries.
 *
 * ACP session configuration options may be `select` (a list of values, e.g.
 * mode/model/thought-level) or `boolean` (an on/off toggle). The shared config
 * sync consumes the `select` kind; this module is the provider-agnostic access
 * point for the `boolean` kind, keyed by an id an adapter declares (see
 * `autoApproveConfigOptionId` in `session.ts`).
 *
 * Lives in its own file rather than `sessionConfig.ts` so the probe can import
 * it without creating an import cycle — `sessionConfig.ts` already imports from
 * `probe.ts`.
 */

export type AcpBooleanConfigOptionLike = {
  id?: string;
  name?: string;
  type?: string;
  currentValue?: boolean;
  _meta?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Find the boolean config option with the given id. ACP ids are unique within
 * a session, so the first match wins; a missing/blank id or non-array input
 * yields `undefined`, which callers treat as "this agent declares no such
 * switch".
 */
export function findBooleanConfigOption(
  configOptions: unknown,
  id: string | undefined,
): AcpBooleanConfigOptionLike | undefined {
  if (!id || !Array.isArray(configOptions)) return undefined;
  return configOptions.find((candidate) => {
    if (!isRecord(candidate)) return false;
    return candidate.type === "boolean" && candidate.id === id;
  }) as AcpBooleanConfigOptionLike | undefined;
}

/** Read a boolean option's current value, or `undefined` when it is absent. */
export function readBooleanConfigValue(
  configOptions: unknown,
  id: string | undefined,
): boolean | undefined {
  const option = findBooleanConfigOption(configOptions, id);
  return typeof option?.currentValue === "boolean" ? option.currentValue : undefined;
}
