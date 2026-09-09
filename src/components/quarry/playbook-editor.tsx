import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Playbook } from "@/lib/playbook";
import type { ReviewLens } from "@/lib/review/types";
import { LENSES } from "@/lib/review/types";

export function PlaybookEditor({
  playbook,
  onChange,
  title = "Playbook",
  hint = "Always-include globs, ignore globs, and a default lens for this repo.",
  idPrefix = "playbook",
}: {
  playbook: Playbook;
  onChange: (playbook: Playbook) => void;
  title?: string;
  hint?: string;
  idPrefix?: string;
}) {
  return (
    <section className="rounded-2xl bg-card p-5 shadow-[var(--shadow-border)]">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{hint}</p>
      <div className="mt-3 space-y-3">
        <div>
          <Label htmlFor={`${idPrefix}-lens`}>Default lens</Label>
          <select
            id={`${idPrefix}-lens`}
            className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
            value={playbook.lens ?? ""}
            onChange={(e) =>
              onChange({
                ...playbook,
                lens: (e.target.value || null) as ReviewLens | null,
              })
            }
          >
            <option value="">Use current lens</option>
            {LENSES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-include`}>Always include (one glob per line)</Label>
          <textarea
            id={`${idPrefix}-include`}
            className="mt-1 min-h-20 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
            value={playbook.include.join("\n")}
            onChange={(e) =>
              onChange({
                ...playbook,
                include: e.target.value.split("\n").map((line) => line.trim()).filter(Boolean),
              })
            }
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-ignore`}>Ignore</Label>
          <Input
            id={`${idPrefix}-ignore`}
            value={playbook.ignore.join(", ")}
            onChange={(e) =>
              onChange({
                ...playbook,
                ignore: e.target.value
                  .split(",")
                  .map((line) => line.trim())
                  .filter(Boolean),
              })
            }
            placeholder="dist/**, coverage/**"
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onChange({ lens: null, include: [], ignore: [] })}
        >
          Clear playbook
        </Button>
      </div>
    </section>
  );
}
