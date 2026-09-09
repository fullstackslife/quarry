import { FileCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FileEntry } from "@/lib/github/types";
import { cn } from "@/lib/utils";

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileList({
  files,
  selected,
  contents,
  onToggle,
  onSmart,
  onSelectAll,
  listedTruncated,
}: {
  files: FileEntry[];
  selected: string[];
  contents: Record<string, string>;
  onToggle: (path: string) => void;
  onSmart: () => void;
  onSelectAll: () => void;
  listedTruncated: boolean;
}) {
  const selectedSet = new Set(selected);
  const allOn = files.length > 0 && files.every((file) => selectedSet.has(file.path));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 px-1 pb-3">
        <div>
          <p className="text-sm font-medium">Files</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {selected.length} selected · {files.length} listed
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={onSelectAll}>
            {allOn ? "Clear" : "Select all"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onSmart}>
            Smart set
          </Button>
        </div>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto scroll-thin pr-1">
        {files.map((file) => {
          const on = selectedSet.has(file.path);
          const loaded = Boolean(contents[file.path]);
          return (
            <li key={file.path}>
              <label
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition-colors duration-150",
                  on ? "bg-secondary/80" : "hover:bg-muted",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggle(file.path)}
                  className="mt-1 size-4 shrink-0 accent-primary"
                />
                <FileCode className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs text-foreground">
                    {file.path}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                    {formatSize(file.size)}
                    {on && !loaded ? <span>will fetch</span> : null}
                    {loaded ? <span className="text-ok">loaded</span> : null}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {listedTruncated ? (
        <p className="px-1 pt-3 text-xs text-muted-foreground">
          Showing a filtered slice of the tree. Binaries and vendor folders are
          omitted.
        </p>
      ) : null}
    </div>
  );
}
