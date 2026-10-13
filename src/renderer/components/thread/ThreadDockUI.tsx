import {
  createContext,
  forwardRef,
  useContext,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { Tooltip } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { Button } from "@/renderer/components/common";

/**
 * When true, `ThreadDockHeader` renders nothing. The floating task panel wraps
 * its docks in a `DocksGroup` whose own header already names the section, so a
 * dock's inner header would only repeat it. Right-panel and composer placements
 * never mount the provider, so their dock headers are unaffected.
 */
const ThreadDockHeaderSuppressedContext = createContext(false);

export function ThreadDockHeaderSuppressed({ children }: { children: ReactNode }) {
  return (
    <ThreadDockHeaderSuppressedContext.Provider value={true}>
      {children}
    </ThreadDockHeaderSuppressedContext.Provider>
  );
}

export function ThreadDockSection({
  children,
  placement = "overlay",
  collapsed = false,
  className = "",
  ariaLabel,
}: {
  children: ReactNode;
  placement?: "composer" | "right" | "overlay";
  collapsed?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const { t } = useLingui();
  const resolvedAriaLabel = ariaLabel ?? t`Thread dock`;
  // In the right panel the docks tab lays the sections out flush; composer
  // sections carry the bordered strip chrome; the floating overlay is a flat
  // list — rows sit directly in the glass panel, separated by the group
  // headers in `ThreadDocksOverlay`, so a section adds no card of its own.
  const baseClass =
    placement === "composer"
      ? "flex flex-col border-b border-[color:var(--border)] bg-transparent text-xs"
      : placement === "overlay"
        ? "flex flex-col bg-transparent text-xs"
        : collapsed
          ? "flex flex-col rounded-none border-0 bg-[var(--content-background)] text-xs"
          : "flex h-full min-h-0 flex-col rounded-none border-0 bg-[var(--content-background)] text-xs";

  return (
    <section
      aria-label={resolvedAriaLabel}
      className={`${baseClass} ${className}`}
      data-collapsed={collapsed ? "true" : "false"}
      data-placement={placement}
    >
      {children}
    </section>
  );
}

export function ThreadDockHeader({
  icon: Icon,
  iconClassName = "text-foreground-muted",
  title,
  countLabel,
  actions,
  children,
}: {
  icon: React.ElementType<{ className?: string }>;
  iconClassName?: string;
  title: string;
  countLabel?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const suppressed = useContext(ThreadDockHeaderSuppressedContext);
  if (suppressed) return null;
  return (
    <div className="flex h-8 items-center gap-2 px-2 leading-none">
      <Icon className={`size-3.5 shrink-0 ${iconClassName}`} />
      <div className="flex min-w-0 flex-1 items-center gap-2 leading-none">
        <span className="font-semibold text-foreground">{title}</span>
        {countLabel && (
          <span className="flex items-center gap-1 text-[0.85em] text-[color:var(--muted)]">
            {countLabel}
          </span>
        )}
        {children}
      </div>
      {actions}
    </div>
  );
}

export function ThreadDockIconButton({
  label,
  tooltip = label,
  danger = false,
  isDisabled = false,
  isPending = false,
  onMouseDown,
  onPress,
  children,
}: {
  label: string;
  tooltip?: ReactNode;
  danger?: boolean;
  isDisabled?: boolean;
  isPending?: boolean;
  onMouseDown?: MouseEventHandler<HTMLButtonElement>;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip delay={0}>
      <Tooltip.Trigger>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={label}
          className={`h-6 w-6 min-w-0 shrink-0 text-muted/70 ${
            danger
              ? "hover:bg-danger/10 hover:text-danger"
              : "hover:bg-foreground/5 hover:text-foreground"
          }`}
          isDisabled={isDisabled}
          isPending={isPending}
          {...(onMouseDown ? { onMouseDown } : {})}
          onPress={onPress}
        >
          {children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{tooltip}</Tooltip.Content>
    </Tooltip>
  );
}

export function ThreadDockList({
  children,
  placement = "overlay",
  collapsed = false,
  gap = "none",
}: {
  children: ReactNode;
  placement?: "composer" | "right" | "overlay";
  collapsed?: boolean;
  gap?: "none" | "px" | "0.5" | "1";
}) {
  const spacingClass =
    gap === "px"
      ? "space-y-px"
      : gap === "0.5"
        ? "space-y-0.5"
        : gap === "1"
          ? "space-y-1"
          : "space-y-0";
  // Right-panel placement: the wrapper must be a bounded flex child that CLIPS
  // (`min-h-0 flex-1 overflow-hidden`) and the list must fill it (`h-full
  // min-h-0 overflow-y-auto`). Without the clip the <ul> sized to its content,
  // overflowed the panel and spilled past the footer, so the list could not be
  // scrolled at all (the bug this fixes).
  const isRightPanel = placement === "right" && !collapsed;
  return (
    <div className={isRightPanel ? "min-h-0 flex-1 overflow-hidden px-1 pb-1" : "px-1 pb-1"}>
      <ul
        className={
          collapsed || placement === "overlay"
            ? spacingClass
            : placement === "composer"
              ? `max-h-[min(12rem,32vh)] ${spacingClass} overflow-y-auto [scrollbar-gutter:stable]`
              : `h-full min-h-0 ${spacingClass} overflow-y-auto [scrollbar-gutter:stable]`
        }
      >
        {children}
      </ul>
    </div>
  );
}

export const ThreadDockRow = forwardRef<
  HTMLLIElement,
  {
    children: ReactNode;
    isActive?: boolean;
    isDone?: boolean;
    title?: string;
    onClick?: () => void;
    /**
     * Stable identity key for the row (e.g. `${sourceId}:${index}`). Rendered
     * as `data-row-key` so owners can look the row up among its siblings
     * without keeping a ref per row.
     */
    rowKey?: string;
  }
>(function ThreadDockRow({ children, isActive, isDone, title, onClick, rowKey }, ref) {
  const innerClass = `flex items-center gap-2.5 rounded-md px-2 py-1.5 leading-5 ${
    isDone ? "opacity-60" : ""
  } ${isActive && !isDone ? "bg-accent/10" : ""}`;
  const rowKeyAttrs = rowKey ? { "data-row-key": rowKey } : {};

  if (onClick) {
    return (
      <li ref={ref} className="flex" {...rowKeyAttrs}>
        <button
          type="button"
          onClick={onClick}
          className={`group flex min-w-0 flex-1 text-left transition-colors hover:bg-foreground/5 ${innerClass}`}
          aria-label={title}
          title={title}
        >
          {children}
        </button>
      </li>
    );
  }

  return (
    <li
      ref={ref}
      className={innerClass}
      title={title}
      aria-current={isActive ? "step" : undefined}
      {...rowKeyAttrs}
    >
      {children}
    </li>
  );
});

export function ThreadDockActionRow({
  children,
  title,
  onClick,
  className = "",
  action,
  actionLabel,
  actionTitle,
  onAction,
  isActionDisabled = false,
}: {
  children: ReactNode;
  title?: string;
  onClick?: () => void;
  className?: string;
  action: ReactNode;
  actionLabel: string;
  actionTitle?: string;
  onAction: () => void;
  isActionDisabled?: boolean;
}) {
  const contentClass = `agentemployee-subagent-dock-row flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left leading-5 transition-[padding,background-color] duration-150 hover:bg-foreground/5 group-hover:pr-8 ${className}`;

  return (
    <li className="group relative flex">
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className={contentClass}
          aria-label={title}
          title={title}
        >
          {children}
        </button>
      ) : (
        <div className={contentClass} title={title}>
          {children}
        </div>
      )}
      <button
        type="button"
        aria-label={actionLabel}
        title={actionTitle}
        disabled={isActionDisabled}
        onClick={(event) => {
          event.stopPropagation();
          onAction();
        }}
        className="agentemployee-subagent-dismiss absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded p-0.5 text-muted/70 opacity-0 transition-opacity duration-150 hover:bg-danger/10 hover:text-danger focus:opacity-100 group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-40"
      >
        {action}
      </button>
    </li>
  );
}
