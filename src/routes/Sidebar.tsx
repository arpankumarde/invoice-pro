import { type ReactNode, useState } from "react";
import { Link, NavLink, useLocation, useMatch } from "react-router";
import { customerSummaries } from "../app/customers.ts";
import type { EditTarget } from "../app/editor/target.ts";
import { entryStatus, entryTitle, joinParts } from "../app/entries.ts";
import { PaymentBadge, PlusIcon } from "../app/ui.tsx";
import type { Workspace } from "./Layout.tsx";
import { customerPath, documentPath, editPath } from "./paths.ts";

const TAB_LABELS = { invoices: "Invoices", customers: "Customers", editor: "Editor" };

export function Sidebar({ snapshot, entries }: Workspace) {
  const { pathname } = useLocation();
  const inEditor = useMatch("/edit/*");
  const inCustomers = useMatch("/customers/*");
  const section = inEditor ? "editor" : inCustomers ? "customers" : "invoices";
  // Each tab reopens its section where it was left.
  const [lastPath, setLastPath] = useState({ invoices: "/", customers: "/customers", editor: editPath({ kind: "invoice" }) });
  if (lastPath[section] !== pathname) setLastPath({ ...lastPath, [section]: pathname });

  return (
    <aside className="flex shrink-0 flex-col border-b border-line bg-white md:w-72 md:border-r md:border-b-0">
      <div className="px-4 pt-4 pb-2">
        <div className="grid grid-cols-3 rounded-md bg-black/[0.05] p-0.5 text-[13px] font-medium" role="tablist">
          {(["invoices", "customers", "editor"] as const).map((name) => (
            <Link
              key={name}
              to={lastPath[name]}
              role="tab"
              aria-selected={section === name}
              className="rounded py-1.5 text-center text-muted aria-selected:bg-white aria-selected:text-ink aria-selected:shadow-sm"
            >
              {TAB_LABELS[name]}
            </Link>
          ))}
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-3 max-md:max-h-72">
        {section === "invoices" ? (
          <InvoiceNav entries={entries} />
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
      <h2 className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">{title}</h2>
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

function InvoiceNav({ entries }: Pick<Workspace, "entries">) {
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
                to={documentPath(entry.id)}
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
