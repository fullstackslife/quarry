import { useEffect, useState } from "react";
import { Loader2, Wifi, WifiOff } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { LmStatus } from "@/lib/llm/lmstudio";
import { probeLmStudio } from "@/lib/llm/lmstudio";
import type { ProviderId, Settings } from "@/lib/settings";
import { cn } from "@/lib/utils";

const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "lmstudio", label: "LM Studio" },
  { id: "grok", label: "Grok" },
];

export function SettingsSheet({
  open,
  onOpenChange,
  settings,
  onChange,
  lmStatus,
  grokAvailable,
  onLmStatus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onChange: (next: Settings) => void;
  lmStatus: LmStatus;
  grokAvailable: boolean | null;
  onLmStatus: (status: LmStatus) => void;
}) {
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void probeLmStudio(settings.lmStudioUrl).then((status) => {
      if (cancelled) return;
      onLmStatus(status);
      if (status.state === "online" && !settings.lmStudioModel && status.models[0]) {
        onChange({ ...settings, lmStudioModel: status.models[0] });
      }
    });
    return () => {
      cancelled = true;
    };
    // Probe once when the sheet opens; URL changes are covered by Test connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function testConnection() {
    setTesting(true);
    const status = await probeLmStudio(settings.lmStudioUrl);
    onLmStatus(status);
    if (status.state === "online" && !settings.lmStudioModel && status.models[0]) {
      onChange({ ...settings, lmStudioModel: status.models[0] });
    }
    setTesting(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="inset-y-0 right-0 left-auto flex h-dvh w-full max-w-md flex-col rounded-none border-y-0 border-r-0 p-0 data-[state=open]:slide-in-from-right">
        <div className="safe-px safe-pt flex items-start justify-between gap-4 pb-4 pt-6">
          <div>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription className="mt-1 max-w-sm">
              Quarry calls LM Studio through this app with LM_API_TOKEN. Grok is
              the hosted fallback.
            </DialogDescription>
          </div>
          <DialogClose />
        </div>
        <div className="safe-px safe-pb flex-1 space-y-7 overflow-y-auto scroll-thin pb-10">
          <section className="space-y-3">
            <Label>Model source</Label>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
              {PROVIDERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChange({ ...settings, provider: item.id })}
                  className={cn(
                    "h-10 rounded-lg text-sm font-medium transition-colors duration-150",
                    settings.provider === item.id
                      ? "bg-card text-foreground shadow-[var(--shadow-border)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Auto uses LM Studio after a successful connection test, otherwise Grok
              {grokAvailable === false ? " (hosted model unavailable here)" : ""}.
            </p>
          </section>

          <Separator />

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="lm-url">LM Studio server</Label>
              {lmStatus.state === "online" ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-ok">
                  <Wifi className="size-3.5" />
                  Connected
                </span>
              ) : lmStatus.state === "offline" ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-warn">
                  <WifiOff className="size-3.5" />
                  Offline
                </span>
              ) : null}
            </div>
            <Input
              id="lm-url"
              value={settings.lmStudioUrl}
              onChange={(e) =>
                onChange({ ...settings, lmStudioUrl: e.target.value })
              }
              placeholder="http://127.0.0.1:1234/v1"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="space-y-2">
              <Label htmlFor="lm-model">Loaded model</Label>
              {lmStatus.state === "online" && lmStatus.models.length > 0 ? (
                <select
                  id="lm-model"
                  value={settings.lmStudioModel}
                  onChange={(e) =>
                    onChange({ ...settings, lmStudioModel: e.target.value })
                  }
                  className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {lmStatus.models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id="lm-model"
                  value={settings.lmStudioModel}
                  onChange={(e) =>
                    onChange({ ...settings, lmStudioModel: e.target.value })
                  }
                  placeholder="Model id from LM Studio"
                  autoCapitalize="off"
                  spellCheck={false}
                />
              )}
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void testConnection()}
              disabled={testing}
            >
              {testing ? <Loader2 className="animate-spin" /> : null}
              Test connection
            </Button>
            {lmStatus.state === "offline" ? (
              <p className="text-sm text-muted-foreground">{lmStatus.reason}</p>
            ) : null}
            <ol className="list-decimal space-y-1.5 pl-4 text-sm text-muted-foreground">
              <li>Start the server in LM Studio (Developer page).</li>
              <li>Load a model (Ctrl+L). Reviews fail until one is loaded.</li>
              <li>
                Put <code>LM_API_TOKEN</code> and optionally{" "}
                <code>LM_STUDIO_URL</code> in <code>.env</code>.
              </li>
              <li>
                Tailscale and LAN addresses work. Paste the Developer page URL
                above if it is not already set.
              </li>
            </ol>
          </section>

          <Separator />

          <section className="space-y-3">
            <Label htmlFor="gh-token">GitHub token</Label>
            <Input
              id="gh-token"
              type="password"
              value={settings.githubToken}
              onChange={(e) =>
                onChange({ ...settings, githubToken: e.target.value })
              }
              placeholder="ghp_…  Contents + Pull requests"
              autoComplete="off"
            />
            <p className="text-sm text-muted-foreground">
              Needed for listing the private repos you can access, a higher
              public rate limit, and applying fixes on a new{" "}
              <code>quarry/*</code> branch. Fine-grained: Metadata read, Contents
              read and write, plus Pull requests write, on those repositories.
              Classic: the repo scope. Stays on this device. Quarry never
              commits to the default branch.
            </p>
          </section>

          <Separator />

          <section className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="max-files">Smart-set files</Label>
              <Input
                id="max-files"
                type="number"
                min={4}
                max={24}
                value={settings.maxFiles}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    maxFiles: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-chars">Char budget</Label>
              <Input
                id="max-chars"
                type="number"
                min={8000}
                max={160000}
                step={4000}
                value={settings.maxChars}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    maxChars: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label htmlFor="temp">Temperature ({settings.temperature})</Label>
              <input
                id="temp"
                type="range"
                min={0}
                max={1.2}
                step={0.05}
                value={settings.temperature}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    temperature: Number(e.target.value),
                  })
                }
                className="w-full accent-primary"
              />
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
