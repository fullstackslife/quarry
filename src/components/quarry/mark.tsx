import { cn } from "@/lib/utils";

export function QuarryMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("text-primary", className)}
      aria-hidden="true"
    >
      <rect x="4" y="6" width="24" height="5" rx="1" fill="currentColor" />
      <rect
        x="7"
        y="13.5"
        width="18"
        height="5"
        rx="1"
        fill="currentColor"
        opacity="0.7"
      />
      <rect
        x="10"
        y="21"
        width="12"
        height="5"
        rx="1"
        fill="currentColor"
        opacity="0.45"
      />
    </svg>
  );
}
