import type { JobListItem } from "@/lib/github/jobs";
import type { ReviewJob } from "@/lib/github/jobs";
import { Button } from "@/components/ui/button";

export function JobPicker({
  job,
  pulls,
  branches,
  issues,
  loading,
  onDefault,
  onSelect,
}: {
  job: ReviewJob;
  pulls: JobListItem[];
  branches: JobListItem[];
  issues: JobListItem[];
  loading: boolean;
  onDefault: () => void;
  onSelect: (item: JobListItem) => void;
}) {
  return (
    <section className="rounded-2xl bg-card p-5 shadow-[var(--shadow-border)]">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Review job
      </p>
      <h2 className="mt-1 font-display text-xl tracking-tight">{job.title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {job.kind === "default"
          ? "Default branch HEAD. Pick a PR, branch, or issue to review that instead."
          : `${job.kind} · ${job.head || job.base} · ${job.sha.slice(0, 8)}`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={job.kind === "default" ? "secondary" : "ghost"}
          onClick={onDefault}
          disabled={loading}
        >
          Default
        </Button>
      </div>
      <JobGroup
        label="Pull requests"
        items={pulls}
        current={job}
        loading={loading}
        onSelect={onSelect}
      />
      <JobGroup
        label="Branches"
        items={branches.slice(0, 40)}
        current={job}
        loading={loading}
        onSelect={onSelect}
      />
      <JobGroup
        label="Issues"
        items={issues}
        current={job}
        loading={loading}
        onSelect={onSelect}
      />
    </section>
  );
}

function JobGroup({
  label,
  items,
  current,
  loading,
  onSelect,
}: {
  label: string;
  items: JobListItem[];
  current: ReviewJob;
  loading: boolean;
  onSelect: (item: JobListItem) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="mt-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto scroll-thin">
        {items.map((item) => {
          const active =
            (item.kind === "pull" && current.kind === "pull" && current.number === item.number) ||
            (item.kind === "branch" && current.kind === "branch" && current.head === item.head) ||
            (item.kind === "issue" && current.kind === "issue" && current.number === item.number);
          return (
            <li key={item.id}>
              <button
                type="button"
                disabled={loading}
                onClick={() => onSelect(item)}
                className={`flex min-h-10 w-full truncate rounded-lg px-2 py-1.5 text-left text-sm ${
                  active ? "bg-secondary" : "hover:bg-muted"
                }`}
              >
                {item.number ? `#${item.number} ` : ""}
                {item.title}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
