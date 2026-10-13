import type { ReactNode } from "react";
import { ChevronRight, FileText, Folder, FolderOpen, Trash2 } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { useKnowledgeBaseStore } from "@/renderer/state/knowledgeBaseStore";
import { deleteKnowledgeEntry } from "@/renderer/actions/knowledgeActions";

/**
 * Lazy knowledge-base tree rooted at a section directory (`raw/sources` or
 * `wiki`). Directories load their children on first expand; clicking a file
 * opens it in the center editor via `onSelectFile` (the KB root location drives
 * the read). Rows expose a hover delete.
 */
export function KnowledgeTree(props: { rootPath: string; onSelectFile: (path: string) => void }) {
  const { t } = useLingui();
  const childrenByPath = useKnowledgeBaseStore((s) => s.childrenByPath);
  const expandedPaths = useKnowledgeBaseStore((s) => s.expandedPaths);
  const selectedPath = useKnowledgeBaseStore((s) => s.selectedPath);
  const toggleDirectory = useKnowledgeBaseStore((s) => s.toggleDirectory);
  const selectPath = useKnowledgeBaseStore((s) => s.selectPath);

  const renderLevel = (directoryPath: string, depth: number): ReactNode =>
    (childrenByPath[directoryPath] ?? []).map((entry) => {
      const isDirectory = entry.type === "directory";
      const isExpanded = expandedPaths.includes(entry.path);
      const isSelected = !isDirectory && selectedPath === entry.path;
      const FolderGlyph = isExpanded ? FolderOpen : Folder;
      return (
        <div key={entry.path}>
          <div
            className={`group flex w-full items-center gap-1.5 rounded-md py-1 pr-1 text-left text-sm ${
              isSelected ? "bg-content2 text-foreground" : "text-muted hover:bg-content2/60"
            }`}
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5"
              onClick={() => {
                if (isDirectory) void toggleDirectory(entry.path);
                else {
                  selectPath(entry.path);
                  props.onSelectFile(entry.path);
                }
              }}
            >
              {isDirectory ? (
                <ChevronRight
                  className={`size-3.5 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                />
              ) : (
                <span className="size-3.5 shrink-0" />
              )}
              {isDirectory ? (
                <FolderGlyph className="size-3.5 shrink-0 text-muted" />
              ) : (
                <FileText className="size-3.5 shrink-0 text-muted" />
              )}
              <span className="truncate">{entry.name}</span>
            </button>
            <button
              type="button"
              aria-label={t`Delete`}
              className="shrink-0 rounded p-0.5 text-muted opacity-0 hover:text-danger group-hover:opacity-100"
              onClick={() => void deleteKnowledgeEntry(entry.path)}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          {isDirectory && isExpanded ? renderLevel(entry.path, depth + 1) : null}
        </div>
      );
    });

  const entries = childrenByPath[props.rootPath] ?? [];
  if (entries.length === 0) {
    return <p className="px-2 py-3 text-xs text-muted">{t`Nothing here yet.`}</p>;
  }
  return <div className="flex flex-col gap-0.5">{renderLevel(props.rootPath, 0)}</div>;
}
