import { Button } from "@/components/ui/button";
import type { CampaignGroup } from "@/lib/review/campaigns";

export function CampaignsPanel({
  groups,
  onOpen,
}: {
  groups: CampaignGroup[];
  onOpen: (owner: string, repo: string) => void;
}) {
  if (!groups.length) return null;
  return (
    <div className="mt-8 rounded-2xl bg-card p-5 shadow-[var(--shadow-border)]">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Cross-repo patterns
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Same finding title across more than one repo in History.
      </p>
      <ul className="mt-3 space-y-3">
        {groups.slice(0, 8).map((group) => (
          <li key={group.key}>
            <p className="text-sm font-medium">{group.title}</p>
            <p className="text-xs text-muted-foreground">
              {group.category} · {group.severity} · {group.repos.length} repos
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {group.repos.map((repo) => (
                <Button
                  key={`${repo.owner}/${repo.repo}`}
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onOpen(repo.owner, repo.repo)}
                >
                  {repo.owner}/{repo.repo}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
