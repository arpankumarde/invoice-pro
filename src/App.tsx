import { type ReactNode, useEffect, useState } from "react";
import { API_BASE, DATA_FOLDER } from "./app/api.ts";
import { refresh, type Snapshot, useInvoiceData } from "./app/data.ts";
import { Editor } from "./app/editor/Editor.tsx";
import { type EditTarget, parseTargetKey, targetKey } from "./app/editor/target.ts";
import { downloadPdf } from "./app/generate.ts";
import { PdfPreview } from "./app/PdfPreview.tsx";
import {
  Code,
  DownloadIcon,
  Errors,
  PageSkeleton,
  PencilIcon,
  PlusIcon,
  primaryButton,
  secondaryButton,
  StatusBadge,
} from "./app/ui.tsx";
import { usePdf } from "./app/usePdf.ts";
import type { InvoiceEntry, InvoiceStatus } from "./invoice/types.ts";

type Mode = "invoices" | "editor";
interface Route {
  mode: Mode;
  invoiceId?: string;
  editTarget: EditTarget;
}

const EDIT_PREFIX = "edit/";

function readHash(): Route {
  const value = decodeURIComponent(window.location.hash.slice(1));
  const target = value.startsWith(EDIT_PREFIX) ? parseTargetKey(value.slice(EDIT_PREFIX.length)) : undefined;
  return target
    ? { mode: "editor", editTarget: target }
    : { mode: "invoices", invoiceId: value || undefined, editTarget: { kind: "invoice" } };
}

function writeHash(route: Route) {
  const hash =
    route.mode === "editor" ? `${EDIT_PREFIX}${targetKey(route.editTarget)}` : (route.invoiceId ?? "");
  window.history.replaceState(null, "", hash ? `#${encodeURIComponent(hash)}` : window.location.pathname);
}

const entryStatus = (entry: InvoiceEntry): InvoiceStatus => (entry.ok ? entry.invoice.status : (entry.status ?? "draft"));
const entryTitle = (entry: InvoiceEntry) => (entry.ok ? entry.invoice.number : entry.number) ?? entry.id;
const sortKey = (entry: InvoiceEntry) => (entry.ok ? entry.invoice.summary.sortKey : `0000 ${entry.id}`);
const joinParts = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" · ");

export default function App() {
  const data = useInvoiceData();
  if (data.status === "ready") return <Workspace snapshot={data.snapshot} />;
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-6 text-ink">
      {data.status === "loading" ? (
        <p className="text-sm text-muted">Loading invoices…</p>
      ) : (
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold">Can't reach the data server</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The app reads and saves invoices through <Code>{API_BASE}</Code> ({data.message}). Start it from the{" "}
            <Code>server</Code> folder with <Code>pnpm dev</Code>, then try again.
          </p>
          <button type="button" onClick={() => void refresh()} className={`${primaryButton} mt-6`}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function Workspace({ snapshot }: { snapshot: Snapshot }) {
  const [route, setRoute] = useState(readHash);
  useEffect(() => {
    const onHashChange = () => setRoute(readHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const navigate = (next: Partial<Route>) => {
    const merged = { ...route, ...next };
    setRoute(merged);
    writeHash(merged);
  };

  const sorted = [...snapshot.entries].sort((a, b) => sortKey(b).localeCompare(sortKey(a)));

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink md:h-dvh md:flex-row md:overflow-hidden">
      <aside className="flex shrink-0 flex-col border-b border-line bg-white md:w-72 md:border-r md:border-b-0">
        <div className="px-4 pt-4 pb-2">
          <div className="grid grid-cols-2 rounded-md bg-black/[0.05] p-0.5 text-[13px] font-medium" role="tablist">
            {(["invoices", "editor"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={route.mode === mode}
                onClick={() => navigate({ mode })}
                className="rounded py-1.5 text-muted aria-selected:bg-white aria-selected:text-ink aria-selected:shadow-sm"
              >
                {mode === "invoices" ? "Invoices" : "Editor"}
              </button>
            ))}
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-3 max-md:max-h-72">
          {route.mode === "invoices" ? (
            <InvoiceNav entries={sorted} selectedId={route.invoiceId} onSelect={(invoiceId) => navigate({ invoiceId })} />
          ) : (
            <EditorNav
              snapshot={snapshot}
              entries={sorted}
              current={route.editTarget}
              onSelect={(editTarget) => navigate({ editTarget })}
            />
          )}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        {snapshot.problems.length > 0 && (
          <div className="px-4 pt-4 sm:px-8">
            <Errors title="Some data files couldn't be read" errors={snapshot.problems} />
          </div>
        )}
        {route.mode === "editor" ? (
          <Editor
            key={targetKey(route.editTarget)}
            snapshot={snapshot}
            target={route.editTarget}
            onNavigate={(editTarget) => navigate({ editTarget })}
          />
        ) : (
          <InvoiceView
            snapshot={snapshot}
            entry={sorted.find((entry) => entry.id === route.invoiceId) ?? sorted[0]}
            onEdit={(file) => navigate({ mode: "editor", editTarget: { kind: "invoice", file } })}
            onCreate={() => navigate({ mode: "editor", editTarget: { kind: "invoice" } })}
          />
        )}
      </main>
    </div>
  );
}

/* ---------- sidebar ---------- */

function NavGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-3">
      <h2 className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">{title}</h2>
      <ul>{children}</ul>
    </section>
  );
}

function NavItem({
  active,
  onClick,
  title,
  aside,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: ReactNode;
  aside?: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        className="w-full rounded-md px-2 py-2 text-left hover:bg-canvas aria-[current]:bg-canvas"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-center gap-1.5 truncate text-[13px] font-medium">{title}</span>
          {aside && <span className="text-[13px] tabular-nums">{aside}</span>}
        </span>
        {subtitle && <span className="mt-0.5 block truncate text-xs text-muted">{subtitle}</span>}
      </button>
    </li>
  );
}

function InvoiceNav({
  entries,
  selectedId,
  onSelect,
}: {
  entries: InvoiceEntry[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const current = entries.find((entry) => entry.id === selectedId) ?? entries[0];
  return (
    <>
      {(["draft", "final"] as const).map((status) => {
        const group = entries.filter((entry) => entryStatus(entry) === status);
        if (group.length === 0) return null;
        return (
          <NavGroup key={status} title={status === "draft" ? "Drafts" : "Final"}>
            {group.map((entry) => (
              <NavItem
                key={entry.id}
                active={entry === current}
                onClick={() => onSelect(entry.id)}
                title={entryTitle(entry)}
                aside={entry.ok && entry.invoice.summary.amountDue}
                subtitle={
                  entry.ok ? (
                    joinParts(entry.invoice.summary.customer, entry.invoice.summary.issueDate) || " "
                  ) : (
                    <span className="text-red-700">Needs fixing</span>
                  )
                }
              />
            ))}
          </NavGroup>
        );
      })}
    </>
  );
}

function EditorNav({
  snapshot,
  entries,
  current,
  onSelect,
}: {
  snapshot: Snapshot;
  entries: InvoiceEntry[];
  current: EditTarget;
  onSelect: (target: EditTarget) => void;
}) {
  const currentKey = targetKey(current);
  const item = (target: EditTarget, title: ReactNode, subtitle?: string) => (
    <NavItem
      key={targetKey(target)}
      active={targetKey(target) === currentKey}
      onClick={() => onSelect(target)}
      title={title}
      subtitle={subtitle}
    />
  );
  const customers = Object.entries(
    snapshot.raw.customers && typeof snapshot.raw.customers === "object" ? snapshot.raw.customers : {},
  );
  const isNew = (label: string) => (
    <>
      <PlusIcon />
      {label}
    </>
  );
  return (
    <>
      <NavGroup title="Invoices">
        {item({ kind: "invoice" }, isNew("New invoice"))}
        {entries.map((entry) =>
          item({ kind: "invoice", file: entry.file }, entryTitle(entry), entry.ok ? entry.invoice.summary.customer : "Needs fixing"),
        )}
      </NavGroup>
      <NavGroup title="Customers">
        {item({ kind: "customer" }, isNew("New customer"))}
        {customers.map(([id, value]) => {
          const name = (value as { name?: unknown } | null)?.name;
          return item({ kind: "customer", id }, id, typeof name === "string" ? name : undefined);
        })}
      </NavGroup>
      <NavGroup title="You">
        {item({ kind: "business" }, "Your details")}
        {item({ kind: "settings" }, "Settings", "Colours, format, PDF permissions")}
      </NavGroup>
    </>
  );
}

/* ---------- invoice view ---------- */

function InvoiceView({
  snapshot,
  entry,
  onEdit,
  onCreate,
}: {
  snapshot: Snapshot;
  entry?: InvoiceEntry;
  onEdit: (file: string) => void;
  onCreate: () => void;
}) {
  const invoice = entry?.ok ? entry.invoice : undefined;
  const pdf = usePdf(invoice, snapshot.images);

  if (!entry) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <h2 className="text-lg font-semibold">No invoices yet</h2>
        <p className="mt-2 text-sm text-muted">
          Create your first one in the editor.
        </p>
        <button type="button" onClick={onCreate} className={`${primaryButton} mt-6`}>
          <PlusIcon />
          New invoice
        </button>
      </div>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-[880px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="truncate text-lg font-semibold">{entryTitle(entry)}</h2>
              <StatusBadge status={entryStatus(entry)} invalid={!entry.ok} />
            </div>
            <p className="mt-0.5 truncate text-[13px] text-muted">
              {invoice ? joinParts(invoice.summary.customer, invoice.headline) : entry.file}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => onEdit(entry.file)} className={secondaryButton}>
              <PencilIcon className="shrink-0" />
              Edit
            </button>
            <button
              type="button"
              disabled={!pdf.bytes}
              onClick={() => invoice && pdf.bytes && downloadPdf(pdf.bytes, invoice.fileName)}
              className={primaryButton}
            >
              <DownloadIcon />
              {invoice?.status === "draft" ? "Download draft" : "Download PDF"}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[880px] px-4 py-6 sm:px-8">
        {!entry.ok && (
          <Errors
            title="This invoice can't be generated yet"
            intro={
              <>
                Fix the following in <Code>{`${DATA_FOLDER}/${entry.file}`}</Code>, or open it in the editor:
              </>
            }
            errors={entry.errors}
          />
        )}
        {pdf.error && (
          <p className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-800">Could not build the PDF: {pdf.error}</p>
        )}
        {invoice &&
          (pdf.previewBytes ? (
            <PdfPreview bytes={pdf.previewBytes} label={entryTitle(entry)} />
          ) : (
            !pdf.error && <PageSkeleton />
          ))}
      </div>
    </>
  );
}
