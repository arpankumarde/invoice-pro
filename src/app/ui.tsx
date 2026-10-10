import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { InvoiceStatus, PaymentStatus, ResolvedInvoice } from "../invoice/types.ts";

/** The bar at the top of every page: what it shows on the left, what you can do with it on the right. */
export function PageHeader({
  title,
  badges,
  subtitle,
  actions,
  wide,
}: {
  title: ReactNode;
  badges?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Spans the whole page instead of the centred column, for the editor. */
  wide?: boolean;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur">
      <div
        className={`mx-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-8 ${wide ? "" : "max-w-[880px]"}`}
      >
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-lg font-semibold tracking-tight">{title}</h2>
            {badges}
          </div>
          {subtitle && <p className="mt-0.5 text-[13px] text-pretty text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

const NOTICE_TONES = {
  error: "bg-red-50 text-red-800 ring-red-200/70",
  warning: "bg-amber-50 text-amber-900 ring-amber-200/70",
  info: "bg-white text-ink ring-black/[0.08]",
};

/** A one-line message above the page content. */
export function Notice({
  tone,
  children,
  action,
  onDismiss,
}: {
  tone: keyof typeof NOTICE_TONES;
  children: ReactNode;
  /** Buttons at the end of the message. */
  action?: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-4 py-3 text-[13px] leading-relaxed ring-1 ring-inset ${NOTICE_TONES[tone]}`}
      role={tone === "info" ? "status" : "alert"}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {action}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-my-1 -mr-1.5 grid size-7 shrink-0 place-items-center rounded-md opacity-60 hover:bg-black/[0.05] hover:opacity-100"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

/** A short confirmation floating at the bottom of the screen, e.g. "Copied". Nothing while `message` is empty. */
export function Toast({ message }: { message?: string }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      {message && (
        <div className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-white shadow-lg">
          <CheckIcon />
          {message}
        </div>
      )}
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  /** A link instead of an action. */
  to?: string;
  onSelect?: () => void;
  disabled?: boolean;
  title?: string;
}

/** A "⋯" button that opens the less common actions, so the header only shows the main ones. */
export function MoreMenu({ label = "More actions", items }: { label?: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const options = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not(:disabled)") ?? [])];
    const at = options.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    options[(at + step + options.length) % options.length]?.focus();
  };

  const itemClass =
    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-ink outline-none hover:bg-black/[0.04] focus-visible:bg-black/[0.05] disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:text-muted";

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`${iconButton} border border-black/10 bg-white aria-expanded:bg-black/[0.04]`}
      >
        <MoreIcon />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          className="absolute top-full right-0 z-30 mt-1.5 min-w-52 rounded-lg border border-black/[0.08] bg-white p-1 shadow-[0_4px_24px_rgba(0,0,0,0.1)]"
        >
          {items.map((item) =>
            item.to && !item.disabled ? (
              <Link
                key={item.label}
                to={item.to}
                role="menuitem"
                title={item.title}
                onClick={() => setOpen(false)}
                className={itemClass}
              >
                {item.icon}
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                title={item.title}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
                className={itemClass}
              >
                {item.icon}
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function StatusBadge({ status, invalid }: { status: InvoiceStatus; invalid?: boolean }) {
  const [label, tone] = invalid
    ? ["Invalid", "bg-red-50 text-red-800 ring-red-200"]
    : status === "draft"
      ? ["Draft", "bg-amber-50 text-amber-800 ring-amber-200"]
      : ["Final", "bg-emerald-50 text-emerald-800 ring-emerald-200"];
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone}`}>{label}</span>;
}

const PAYMENT_LABELS: Record<PaymentStatus, string | undefined> = {
  unpaid: undefined,
  partial: "Partly paid",
  paid: "Paid",
};

export function PaymentBadge({ payment }: { payment: PaymentStatus }) {
  const label = PAYMENT_LABELS[payment];
  if (!label) return null;
  const tone = payment === "paid" ? "bg-sky-50 text-sky-800 ring-sky-200" : "bg-violet-50 text-violet-800 ring-violet-200";
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset ${tone}`}>
      {label}
    </span>
  );
}

/** Switches between an invoice and its receipts. Shows nothing until there is a receipt. */
export function DocumentTabs({
  invoice,
  selectedId,
  onSelect,
}: {
  invoice: ResolvedInvoice;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (invoice.receipts.length === 0) return null;
  return (
    <div className="mb-4 flex w-fit flex-wrap rounded-md bg-black/[0.05] p-0.5 text-[13px] font-medium" role="tablist">
      {[invoice, ...invoice.receipts].map((doc, i) => (
        <button
          key={doc.id}
          type="button"
          role="tab"
          aria-selected={doc.id === selectedId}
          onClick={() => onSelect(doc.id)}
          className="rounded px-3 py-1 text-muted aria-selected:bg-white aria-selected:text-ink aria-selected:shadow-sm"
        >
          {doc.kind === "invoice" ? "Invoice" : `Receipt ${doc.number ?? i}`}
        </button>
      ))}
    </div>
  );
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
/** Quiet actions, e.g. Delete, that shouldn't compete with the main ones. */
export const ghostButton = `${buttonClass} text-muted hover:bg-black/[0.04] hover:text-ink`;
export const iconButton =
  "inline-grid size-9 shrink-0 place-items-center rounded-md text-ink transition hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-40";

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

export function MailIcon() {
  return (
    <svg {...iconProps}>
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="M2.5 5l5.5 4 5.5-4" />
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

export function ReceiptIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3.5 2.5h9v11l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1v-11zM6 6h4M6 8.5h4" />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg {...iconProps} strokeWidth={2.25}>
      <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M6 3.5L10.5 8 6 12.5" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg {...iconProps} width={12} height={12}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.5v3.5M8 5h.01" />
    </svg>
  );
}

export function SearchIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps} width={14} height={14} className={className}>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" />
    </svg>
  );
}

export function HomeIcon() {
  return (
    <svg {...iconProps}>
      <path d="M2.5 7L8 2.5 13.5 7v6a.5.5 0 0 1-.5.5h-3v-4H6v4H3a.5.5 0 0 1-.5-.5V7z" />
    </svg>
  );
}

export function DocumentIcon() {
  return (
    <svg {...iconProps}>
      <path d="M9.5 2H4.5A1 1 0 0 0 3.5 3v10a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5L9.5 2z" />
      <path d="M9.5 2v3h3M6 8.5h4M6 11h2.5" />
    </svg>
  );
}

export function PeopleIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="6" cy="5.5" r="2.25" />
      <path d="M2 13c.4-2.2 2-3.5 4-3.5s3.6 1.3 4 3.5M10.5 3.4a2.25 2.25 0 0 1 0 4.2M12 9.8c1 .5 1.7 1.6 2 3.2" />
    </svg>
  );
}

export function SlidersIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 4.5h6M12 4.5h1M3 11.5h1M7 11.5h6" />
      <circle cx="10.5" cy="4.5" r="1.5" />
      <circle cx="5.5" cy="11.5" r="1.5" />
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
