/**
 * The AgentEmployee wordmark — "Agent" set in bold and "Employee" in semibold,
 * so the lockup reads as one word with a subtle weight break rather than two.
 *
 * Pair with {@link AgentEmployeeMark} where an icon is wanted (the app header
 * and the welcome splash). Reads as "AgentEmployee" to assistive tech.
 */
export function BrandWordmark({ className }: { className?: string | undefined }) {
  return (
    <span className={className} aria-label="AgentEmployee">
      <span className="font-bold" aria-hidden="true">
        Agent
      </span>
      <span className="font-semibold" aria-hidden="true">
        Employee
      </span>
    </span>
  );
}
