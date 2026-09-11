import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  listRepoOwners,
  parseOwnerRepoName,
  slugifyRepoName,
  type RepoOwnerOption,
} from "@/lib/github/create";
import type { OnboardKind } from "@/lib/github/onboard";

export type OnboardFormValues = {
  kind: OnboardKind;
  title: string;
  name: string;
  owner: string;
  brief: string;
  private: boolean;
};

export function OnboardPanel({
  tokenReady,
  token,
  defaultOwner,
  busy,
  error,
  onCreate,
  onOpenSettings,
}: {
  tokenReady: boolean;
  token: string;
  defaultOwner: string | null;
  busy: boolean;
  error: string | null;
  onCreate: (values: OnboardFormValues) => void;
  onOpenSettings: () => void;
}) {
  const [kind, setKind] = useState<OnboardKind>("client");
  const [title, setTitle] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [owner, setOwner] = useState("");
  const [brief, setBrief] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [owners, setOwners] = useState<RepoOwnerOption[]>([]);

  useEffect(() => {
    if (!tokenReady) {
      setOwners([]);
      return;
    }
    const controller = new AbortController();
    void listRepoOwners({ token, signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted || !res.ok) return;
        setOwners(res.data);
        setOwner((current) => current || res.data[0]?.login || "");
      })
      .catch(() => {});
    return () => controller.abort();
  }, [token, tokenReady]);

  useEffect(() => {
    if (owner || !defaultOwner) return;
    setOwner(defaultOwner);
  }, [defaultOwner, owner]);

  const slug = useMemo(() => {
    if (nameTouched) return slugifyRepoName(name);
    return slugifyRepoName(title);
  }, [name, nameTouched, title]);

  if (!tokenReady) return null;

  return (
    <div className="mt-8 rounded-2xl bg-card p-5 shadow-[var(--shadow-border)]">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        New workspace
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Create a GitHub repo for a client engagement or an idea, seed an intake
        kit, and open it here.
      </p>

      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = parseOwnerRepoName(nameTouched ? name : title);
          onCreate({
            kind,
            title: title.trim() || slug,
            name: parsed.name || slug,
            owner: parsed.owner || owner,
            brief: brief.trim(),
            private: isPrivate,
          });
        }}
      >
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["client", "Client"],
              ["idea", "Idea"],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant={kind === id ? "secondary" : "ghost"}
              onClick={() => setKind(id)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="onboard-title">
              {kind === "client" ? "Client or engagement" : "Idea name"}
            </Label>
            <Input
              id="onboard-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                kind === "client" ? "Northwind ordering desk" : "Local agent mesh"
              }
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="onboard-owner">Owner</Label>
            {owners.length > 0 ? (
              <select
                id="onboard-owner"
                className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
              >
                {owners.map((item) => (
                  <option key={item.login} value={item.login}>
                    {item.login}
                    {item.kind === "org" ? " (org)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id="onboard-owner"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="github-user-or-org"
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="onboard-name">Repo name</Label>
            <Input
              id="onboard-name"
              value={nameTouched ? name : slug}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
              placeholder="northwind-ordering"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="onboard-brief">Brief</Label>
          <textarea
            id="onboard-brief"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="What this is, who it is for, and what good looks like."
            rows={4}
            className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-[var(--shadow-border)] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <Switch
              checked={isPrivate}
              onCheckedChange={setIsPrivate}
              aria-label="Private repository"
            />
            Private
          </label>
          <Button type="submit" disabled={busy || !slug}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            Create and open
          </Button>
        </div>
      </form>

      {error ? (
        <p className="mt-3 text-sm text-danger">
          {error}{" "}
          {/token|scope|cannot create/i.test(error) ? (
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={onOpenSettings}
            >
              Open Settings
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
