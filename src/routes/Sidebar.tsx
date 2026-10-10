import { type ReactNode, useState } from "react";
import { Link, NavLink, useLocation, useMatch } from "react-router";
import { customerSummaries } from "../app/customers.ts";
import { asObj, text } from "../app/editor/json.ts";
import type { EditTarget } from "../app/editor/target.ts";
import { entryStatus, entryTitle, joinParts } from "../app/entries.ts";
import { isOverdue, owedMinor, todayKey } from "../app/overview.ts";
import {
  DocumentIcon,
  HomeIcon,
  iconButton,
  PaymentBadge,
  PeopleIcon,
  PlusIcon,
  SearchIcon,
  SlidersIcon,
} from "../app/ui.tsx";
import type { InvoiceEntry } from "../invoice/types.ts";
import type { Workspace } from "./Layout.tsx";
import { customerPath, editPath, invoicePath } from "./paths.ts";

const SECTIONS = [
  { name: "overview", label: "Overview", icon: <HomeIcon /> },
  { name: "invoices", label: "Invoices", icon: <DocumentIcon /> },
  { name: "customers", label: "Customers", icon: <PeopleIcon /> },
  { name: "editor", label: "Editor", icon: <SlidersIcon /> },
] as const;

type InvoiceFilter = "all" | "unpaid" | "overdue" | "draft";
const FILTER_LABELS: Record<InvoiceFilter, string> = { all: "All", unpaid: "Unpaid", overdue: "Overdue", draft: "Drafts" };

/** What the invoice list is narrowed to. Kept by the sidebar so it survives switching tabs. */
interface InvoiceQuery {
  text: string;
  filter: InvoiceFilter;
}

export function Sidebar({ snapshot, entries }: Workspace) {
  const { pathname } = useLocation();
  const inEditor = useMatch("/edit/*");
  const inCustomers = useMatch("/customers/*");
  const section = pathname === "/" ? "overview" : inEditor ? "editor" : inCustomers ? "customers" : "invoices";
  // Each tab reopens its section where it was left. The invoices tab starts on the latest invoice.
  const [lastPath, setLastPath] = useState({
    invoices: invoicePath(entries[0]?.id ?? "latest"),
    customers: "/customers",
    editor: editPath({ kind: "invoice" }),
  });
  if (section !== "overview" && lastPath[section] !== pathname) setLastPath({ ...lastPath, [section]: pathname });
  const [query, setQuery] = useState<InvoiceQuery>({ text: "", filter: "all" });

  const business = asObj(snapshot.raw.business);
  const businessName = text(business.name) || "Your business";

  return (
    <aside className="flex shrink-0 flex-col border-b border-line bg-white md:w-72 md:border-r md:border-b-0">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <span
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink text-[13px] font-semibold text-white"
          aria-hidden
        >
          {businessName.trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold">{businessName}</div>
          <div className="text-[11px] text-muted">Invoicing</div>
        </div>
        <Link
          to={editPath({ kind: "invoice" })}
          aria-label="New invoice"
          title="New invoice"
          className={`${iconButton} border border-black/10`}
        >
          <PlusIcon />
        </Link>
      </div>
      <nav aria-label="Sections" className="grid grid-cols-4 gap-0.5 px-3 pb-3 md:flex md:flex-col">
        {SECTIONS.map(({ name, label, icon }) => (
          <Link
            key={name}
            to={name === "overview" ? "/" : lastPath[name]}
            aria-current={section === name ? "page" : undefined}
            className="flex items-center justify-center gap-2.5 rounded-md px-1 py-1.5 text-[13px] font-medium max-md:[&_svg]:hidden md:justify-start md:px-2.5 text-muted transition-colors hover:bg-canvas hover:text-ink aria-[current]:bg-canvas aria-[current]:text-ink [&_svg]:opacity-70 aria-[current]:[&_svg]:opacity-100"
          >
            {icon}
            {label}
          </Link>
        ))}
      </nav>
      <div className="mx-4 border-t border-line" />
      <nav
        aria-label={section === "customers" ? "Customers" : section === "editor" ? "Records" : "Invoices"}
        className="flex-1 overflow-y-auto px-3 pb-3 [scrollbar-width:thin] max-md:max-h-72"
      >
        {section === "invoices" || section === "overview" ? (
          <InvoiceNav entries={entries} query={query} onQueryChange={setQuery} />
        ) : section === "customers" ? (
          <CustomerNav snapshot={snapshot} entries={entries} />
        ) : (
          <EditorNav snapshot={snapshot} entries={entries} />
        )}
      </nav>
    </aside>
  );
}

function NavGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-3">
      <h2 className="px-2 pb-1 text-[11px] font-medium tracking-wider text-muted/80 uppercase">{title}</h2>
      <ul>{children}</ul>
    </section>
  );
}

function NavItem({
  to,
  end,
  title,
  aside,
  subtitle,
  badge,
}: {
  to: string;
  /** Highlight on this exact URL only, not on the pages beneath it. */
  end?: boolean;
  title: ReactNode;
  aside?: ReactNode;
  subtitle?: ReactNode;
  /** Shown under `aside`, at the end of the subtitle line. */
  badge?: ReactNode;
}) {
  return (
    <li>
      <NavLink
        to={to}
        end={end}
        caseSensitive
        className="block rounded-md px-2 py-2 hover:bg-canvas aria-[current]:bg-canvas"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-center gap-1.5 truncate text-[13px] font-medium">{title}</span>
          {aside && <span className="text-[13px] tabular-nums">{aside}</span>}
        </span>
        {(subtitle || badge) && (
          <span className="mt-0.5 flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-xs text-muted">{subtitle}</span>
            {badge}
          </span>
        )}
      </NavLink>
    </li>
  );
}

/** Lowercased words the invoice is found by: its number, file name, and customer's name and id. */
const searchText = (entry: InvoiceEntry) =>
  [entryTitle(entry), entry.id, entry.customerId, entry.ok ? entry.invoice.summary.customer : undefined]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

function matchesFilter(entry: InvoiceEntry, filter: InvoiceFilter, today: string) {
  if (filter === "draft") return entryStatus(entry) === "draft";
  if (filter === "unpaid") return owedMinor(entry) > 0;
  if (filter === "overdue") return isOverdue(entry, today);
  return true;
}

function InvoiceNav({
  entries,
  query,
  onQueryChange,
}: Pick<Workspace, "entries"> & { query: InvoiceQuery; onQueryChange: (query: InvoiceQuery) => void }) {
  const today = todayKey();
  // Every word typed must appear somewhere, so "acme 2026" finds Acme's 2026 invoices.
  const words = query.text.toLowerCase().split(/\s+/).filter(Boolean);
  const found = words.length > 0 ? entries.filter((entry) => words.every((word) => searchText(entry).includes(word))) : entries;
  const shown = found.filter((entry) => matchesFilter(entry, query.filter, today));
  const narrowed = words.length > 0 || query.filter !== "all";

  return (
    <>
      <div className="sticky top-0 z-10 -mx-3 bg-white px-3 pt-3 pb-1">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query.text}
            onChange={(event) => onQueryChange({ ...query, text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Escape") onQueryChange({ ...query, text: "" });
            }}
            placeholder="Search number or customer"
            aria-label="Search invoices"
            className="h-8 w-full rounded-md bg-black/[0.04] pr-2.5 pl-8 text-[13px] placeholder:text-muted focus:bg-white focus:ring-1 focus:ring-black/15 focus:outline-none"
          />
        </div>
        <div className="mt-2 grid grid-cols-4 gap-0.5 rounded-md bg-black/[0.04] p-0.5" role="group" aria-label="Show">
          {(Object.keys(FILTER_LABELS) as InvoiceFilter[]).map((filter) => {
            const count = found.filter((entry) => matchesFilter(entry, filter, today)).length;
            return (
              <button
                key={filter}
                type="button"
                aria-pressed={query.filter === filter}
                onClick={() => onQueryChange({ ...query, filter })}
                className="rounded px-1 py-1 text-xs font-medium whitespace-nowrap text-muted transition-colors hover:text-ink aria-pressed:bg-white aria-pressed:text-ink aria-pressed:shadow-sm"
              >
                {FILTER_LABELS[filter]}{" "}
                <span className={`tabular-nums ${filter === "overdue" && count > 0 ? "text-red-700" : "opacity-50"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {shown.length === 0 && (
        <p className="px-2 pt-4 text-[13px] text-muted">
          {entries.length === 0 ? "No invoices yet." : "No invoices match."}{" "}
          {narrowed && entries.length > 0 && (
            <button
              type="button"
              onClick={() => onQueryChange({ text: "", filter: "all" })}
              className="font-medium text-ink underline-offset-2 hover:underline"
            >
              Show all
            </button>
          )}
        </p>
      )}
      {(["draft", "final"] as const).map((status) => {
        const group = shown.filter((entry) => entryStatus(entry) === status);
        if (group.length === 0) return null;
        return (
          <NavGroup key={status} title={status === "draft" ? "Drafts" : "Final"}>
            {group.map((entry) => (
              <NavItem
                key={entry.id}
                to={invoicePath(entry.id)}
                title={entryTitle(entry)}
                aside={entry.ok && entry.invoice.summary.amountDue}
                badge={entry.ok && <PaymentBadge payment={entry.invoice.summary.payment} />}
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

function CustomerNav({ snapshot, entries }: Workspace) {
  const customers = customerSummaries(snapshot, entries);
  if (customers.length === 0) return null;
  return (
    <NavGroup title="Customers">
      {customers.map((customer) => {
        const due = customer.balances.filter((balance) => balance.due);
        return (
          <NavItem
            key={customer.id}
            to={customerPath(customer.id)}
            title={customer.name ?? customer.id}
            aside={customer.entries.length}
            subtitle={
              customer.defined ? (
                joinParts(customer.id, due.length > 0 ? `${due.map((balance) => balance.outstanding).join(" + ")} due` : undefined)
              ) : (
                <span className="text-red-700">Not in customers.json</span>
              )
            }
          />
        );
      })}
    </NavGroup>
  );
}

function EditorNav({ snapshot, entries }: Workspace) {
  const item = (target: EditTarget, title: ReactNode, subtitle?: string) => {
    const to = editPath(target);
    return <NavItem key={to} to={to} end title={title} subtitle={subtitle} />;
  };
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
