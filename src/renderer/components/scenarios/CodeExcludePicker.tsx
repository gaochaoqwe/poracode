import { useEffect, useState } from "react";
import { Button, Popover } from "@heroui/react";
import { FolderX } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ProjectLocation } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";

interface CodeExcludePickerProps {
  projectLocation: ProjectLocation;
  /** Absolute project root; the chosen dir is a path under it. */
  projectRoot: string;
  /** Absolute directory the user picked for the `code` input. */
  dir: string;
  /** Subdirectory names currently marked as excluded (third-party/library). */
  selected: readonly string[];
  onToggle: (name: string) => void;
}

/** Normalize to forward slashes with no trailing slash. */
function normalize(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Path of `dir` relative to the project root, or "" when `dir` is the root. */
function toProjectRelative(projectRoot: string, dir: string): string {
  const root = normalize(projectRoot);
  const path = normalize(dir);
  if (path === root) return "";
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : "";
}

/**
 * Picks which of the chosen code directory's immediate subdirectories are
 * third-party/library code (no requirements or design items written for them).
 * Kept inside a popover so a folder-heavy directory never stretches the input
 * card vertically — the trigger stays a single row.
 */
export function CodeExcludePicker(props: CodeExcludePickerProps) {
  const { t } = useLingui();
  const requestKey = `${props.projectRoot}\u0000${props.dir}`;
  const [result, setResult] = useState<{ key: string; folders: string[] }>({
    key: "",
    folders: [],
  });
  // Null while the listing for the current request is still in flight.
  const folders = result.key === requestKey ? result.folders : null;

  useEffect(() => {
    let cancelled = false;
    const directoryPath = toProjectRelative(props.projectRoot, props.dir);
    readBridge()
      .listProjectTree({ projectLocation: props.projectLocation, directoryPath })
      .then((listed) => {
        if (cancelled) return;
        setResult({
          key: requestKey,
          folders: listed.entries
            .filter((entry) => entry.type === "directory")
            .map((entry) => entry.name),
        });
      })
      .catch(() => {
        if (!cancelled) setResult({ key: requestKey, folders: [] });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requestKey encodes root+dir
  }, [requestKey, props.projectLocation]);

  const count = props.selected.length;

  return (
    <Popover>
      <Popover.Trigger>
        <Button variant="secondary" size="sm" className="self-start px-2 text-xs">
          <FolderX aria-hidden className="size-3.5" />
          <Trans>Excluded folders</Trans>
          {count > 0 ? ` (${count})` : null}
        </Button>
      </Popover.Trigger>
      <Popover.Content placement="bottom start" className="w-[min(300px,calc(100vw-2rem))] p-0">
        <Popover.Dialog className="!p-0">
          <div className="border-b border-[var(--hairline)] px-3 py-2">
            <p className="text-xs font-medium text-foreground">
              <Trans>Third-party / library folders to exclude</Trans>
            </p>
          </div>
          <div className="max-h-[240px] overflow-y-auto p-2">
            {folders === null ? null : folders.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted">
                <Trans>No subfolders</Trans>
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {folders.map((name) => {
                  const isSelected = props.selected.includes(name);
                  return (
                    <Button
                      key={name}
                      size="sm"
                      variant={isSelected ? "primary" : "secondary"}
                      aria-pressed={isSelected}
                      aria-label={t`Exclude ${name}`}
                      className="h-7 min-w-0 px-2 text-xs"
                      onPress={() => props.onToggle(name)}
                    >
                      {name}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
