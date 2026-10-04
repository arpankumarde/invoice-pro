import type { ReactNode } from "react";
import type { InvoiceStatus } from "../invoice/types.ts";

export function StatusBadge({ status, invalid }: { status: InvoiceStatus; invalid?: boolean }) {
  const [label, tone] = invalid
    ? ["Invalid", "bg-red-50 text-red-800 ring-red-200"]
    : status === "draft"
      ? ["Draft", "bg-amber-50 text-amber-800 ring-amber-200"]
      : ["Final", "bg-emerald-50 text-emerald-800 ring-emerald-200"];
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone}`}>{label}</span>;
}

export function Errors({ title, intro, errors }: { title: string; intro?: ReactNode; errors: string[] }) {
  return (
    <div className="rounded-lg border border-red-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-red-800">{title}</h3>
      {intro && <p className="mt-1 text-[13px] text-muted">{intro}</p>}
      <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-ink">
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-black/[0.05] px-1 py-px font-mono text-[12px] text-ink">{children}</code>;
}

export function PageSkeleton() {
  return <div className="mx-auto aspect-[612/792] w-full max-w-[816px] animate-pulse rounded-[3px] bg-white/70" />;
}

export const buttonClass =
  "inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";
export const primaryButton = `${buttonClass} bg-ink text-white shadow-sm hover:bg-black`;
export const secondaryButton = `${buttonClass} border border-black/10 bg-white text-ink hover:bg-black/[0.03]`;

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function DownloadIcon() {
  return (
    <svg {...iconProps}>
      <path d="M8 2.5v8m0 0L4.75 7.25M8 10.5l3.25-3.25M3 13.5h10" />
    </svg>
  );
}

export function PencilIcon({ className = "mt-0.5 shrink-0" }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M10.5 3.5l2 2L6 12l-2.75.75L4 10l6.5-6.5z" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg {...iconProps}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg {...iconProps}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.1" />
    </svg>
  );
}
