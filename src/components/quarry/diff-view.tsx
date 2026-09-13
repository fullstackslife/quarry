import { cn } from "@/lib/utils";
import { diffRows } from "@/lib/workspace/patch";
import type { DraftFile } from "@/lib/workspace/buffer";

export function DiffView({ draft }: { draft: DraftFile }) {
  const rows = diffRows(draft.original.split(/\r?\n/), draft.proposed.split(/\r?\n/));
  return (
    <pre className="overflow-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-5">
      {rows.map((row, i) => (
        <div
          key={`${i}-${row.type}`}
          className={cn(
            "whitespace-pre-wrap",
            row.type === "add" && "bg-ok/15 text-foreground",
            row.type === "del" && "bg-danger/15 text-foreground",
            row.type === "ctx" && "text-muted-foreground",
          )}
        >
          {row.type === "add" ? "+" : row.type === "del" ? "-" : " "}
          {row.text}
        </div>
      ))}
    </pre>
  );
}
