import { ChevronRight, FileCode, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildFileTree,
  filterTree,
  flattenVisible,
  type TreeNode,
} from "@/lib/workspace/tree";

export function FileTree({
  paths,
  query,
  expanded,
  onToggleDir,
  activePath,
  dirty,
  loaded,
  onOpen,
}: {
  paths: string[];
  query: string;
  expanded: Set<string>;
  onToggleDir: (path: string) => void;
  activePath: string | null;
  dirty: Set<string>;
  loaded: Set<string>;
  onOpen: (path: string) => void;
}) {
  const tree = filterTree(buildFileTree(paths), query);
  const rows = flattenVisible(tree, query.trim() ? expandAll(tree) : expanded);

  return (
    <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto scroll-thin pr-1">
      {rows.map(({ node, depth }) => (
        <li key={node.path}>
          {node.kind === "dir" ? (
            <button
              type="button"
              className="flex min-h-9 w-full items-center gap-1 rounded-md px-1.5 text-left text-xs hover:bg-muted"
              style={{ paddingLeft: 6 + depth * 12 }}
              onClick={() => onToggleDir(node.path)}
            >
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform",
                  expanded.has(node.path) || query.trim() ? "rotate-90" : "",
                )}
              />
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{node.name}</span>
            </button>
          ) : (
            <button
              type="button"
              className={cn(
                "flex min-h-9 w-full items-center gap-1.5 rounded-md px-1.5 text-left font-mono text-xs hover:bg-muted",
                activePath === node.path ? "bg-secondary/80" : "",
              )}
              style={{ paddingLeft: 6 + depth * 12 }}
              onClick={() => onOpen(node.path)}
            >
              <FileCode className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{node.name}</span>
              {dirty.has(node.path) ? (
                <span className="ml-auto text-[10px] text-warn">draft</span>
              ) : loaded.has(node.path) ? (
                <span className="ml-auto text-[10px] text-ok">loaded</span>
              ) : null}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function expandAll(nodes: TreeNode[]): Set<string> {
  const out = new Set<string>();
  function walk(list: TreeNode[]) {
    for (const node of list) {
      if (node.kind === "dir") {
        out.add(node.path);
        if (node.children) walk(node.children);
      }
    }
  }
  walk(nodes);
  return out;
}
