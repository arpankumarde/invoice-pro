import { type ReactNode } from "react";
import { Link, useOutletContext } from "react-router";
import { overview, type CurrencyTotal, todayKey } from "../app/overview.ts";
import { entryTitle, joinParts } from "../app/entries.ts";
import { PageHeader, PlusIcon, primaryButton } from "../app/ui.tsx";
import type { Workspace } from "./Layout.tsx";
import { customerPath, editPath, invoicePath, receiptPath } from "./paths.ts";

/** "/": what is owed, what is late, and how this month is going. */
export function OverviewPage() {
  const { snapshot, entries } = useOutletContext<Workspace>();
  const today = todayKey();
  const data = overview(entries, snapshot.payments, today);
  const month = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(today));

  if (entries.length === 0) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <h2 className="text-lg font-semibold">No invoices yet</h2>
        <p className="mt-2 text-sm text-muted">Create your first one in the editor.</p>
        <Link to={editPath({ kind: "invoice" })} className={`${primaryButton} mt-6`}>
          <PlusIcon />
          New invoice
        </Link>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`Final invoices only${data.drafts > 0 ? `, ${data.drafts} ${data.drafts === 1 ? "draft is" : "drafts are"} not counted` : ""}`}
        actions={
          <Link to={editPath({ kind: "invoice" })} className={primaryButton}>
            <PlusIcon />
            New invoice
          </Link>
        }
      />

      <div className="mx-auto max-w-[880px] space-y-6 px-4 py-6 sm:px-8">
        <section className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Outstanding"
            totals={data.outstanding}
            empty="Nothing owed"
            tone={data.outstanding.length > 0 ? "due" : undefined}
          />
          <Stat
            label="Overdue"
            totals={data.overdueTotals}
            empty="Nothing overdue"
            tone={data.overdueTotals.length > 0 ? "late" : undefined}
            note={data.overdue.length > 0 ? `${data.overdue.length} ${data.overdue.length === 1 ? "invoice" : "invoices"}` : undefined}
          />
          <MonthCard month={month} billed={data.billed} received={data.received} />
        </section>

        <section>
          <SectionTitle>Overdue invoices</SectionTitle>
          <Panel empty={data.overdue.length === 0 ? "No invoice is past its due date." : undefined}>
            <Table headings={["Invoice", "Customer", "Days late", "Owed"]} hideOnSmall={[1]}>
              {data.overdue.map(({ id, invoice, customerId, outstanding, daysLate }) => {
                const to = invoicePath(id);
                return (
                  <tr key={id} className="hover:bg-canvas/60">
                    <td className="p-0">
                      <Link to={to} className="block px-4 py-3 font-medium">
                        {invoice.number ?? id}
                        {invoice.summary.dueDate && (
                          <span className="block text-xs font-normal text-muted">Due {invoice.summary.dueDate}</span>
                        )}
                      </Link>
                    </td>
                    <td className="p-0 text-muted max-sm:hidden">
                      {customerId ? (
                        <Link to={customerPath(customerId)} className="block px-4 py-3 hover:text-ink hover:underline">
                          {invoice.summary.customer ?? customerId}
                        </Link>
                      ) : (
                        <Link to={to} className="block px-4 py-3" tabIndex={-1}>
                          {invoice.summary.customer ?? "—"}
                        </Link>
                      )}
                    </td>
                    <td className="p-0 text-red-700 tabular-nums">
                      <Link to={to} className="block px-4 py-3" tabIndex={-1}>
                        {daysLate} {daysLate === 1 ? "day" : "days"}
                      </Link>
                    </td>
                    <td className="p-0 text-right font-medium tabular-nums">
                      <Link to={to} className="block px-4 py-3" tabIndex={-1}>
                        {outstanding}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </Table>
          </Panel>
        </section>

        <section>
          <SectionTitle>Recent payments</SectionTitle>
          <Panel empty={data.recentPayments.length === 0 ? "No payments recorded yet." : undefined}>
            <Table headings={["Receipt", "Paid", "Invoices", "Amount"]} hideOnSmall={[1]}>
              {data.recentPayments.map(({ id, receipt }) => {
                const to = receiptPath(id);
                const invoiceNames = receipt.summary.invoices.map((invoiceId) => {
                  const entry = entries.find((candidate) => candidate.id === invoiceId);
                  return entry ? entryTitle(entry) : invoiceId;
                });
                return (
                  <tr key={id} className="hover:bg-canvas/60">
                    <td className="p-0 font-medium">
                      <Link to={to} className="block px-4 py-3">
                        {receipt.number ?? id}
                      </Link>
                    </td>
                    <td className="p-0 text-muted max-sm:hidden">
                      <Link to={to} className="block px-4 py-3" tabIndex={-1}>
                        {receipt.summary.date ?? "—"}
                      </Link>
                    </td>
                    <td className="p-0 text-muted">
                      <Link to={to} className="block px-4 py-3" tabIndex={-1}>
                        {joinParts(...invoiceNames.slice(0, 2)) + (invoiceNames.length > 2 ? ` +${invoiceNames.length - 2}` : "")}
                      </Link>
                    </td>
                    <td className="p-0 text-right tabular-nums">
                      <Link to={to} className="block px-4 py-3" tabIndex={-1}>
                        {receipt.summary.amount}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </Table>
          </Panel>
        </section>
      </div>
    </>
  );
}

const toneClass = { due: "text-violet-800", late: "text-red-700" };

function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3">
      <div className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</div>
      {children}
    </div>
  );
}

/** One figure per currency. */
function Stat({
  label,
  totals,
  empty,
  tone,
  note,
}: {
  label: string;
  totals: CurrencyTotal[];
  empty: string;
  tone?: keyof typeof toneClass;
  note?: string;
}) {
  return (
    <Card label={label}>
      {totals.length === 0 ? (
        <div className="mt-1 text-sm text-muted">{empty}</div>
      ) : (
        totals.map((total) => (
          <div key={total.currency} className={`mt-1 text-lg font-semibold tabular-nums ${tone ? toneClass[tone] : ""}`}>
            {total.text}
          </div>
        ))
      )}
      {note && <div className="mt-1 text-xs text-muted">{note}</div>}
    </Card>
  );
}

/** This month's billed and received amounts, side by side for each currency. */
function MonthCard({ month, billed, received }: { month: string; billed: CurrencyTotal[]; received: CurrencyTotal[] }) {
  const currencies = [...new Set([...billed, ...received].map((total) => total.currency))].sort();
  const find = (totals: CurrencyTotal[], currency: string) => totals.find((total) => total.currency === currency)?.text;
  return (
    <Card label={month}>
      {currencies.length === 0 ? (
        <div className="mt-1 text-sm text-muted">Nothing billed or received yet</div>
      ) : (
        <dl className="mt-1 space-y-0.5 text-[13px]">
          {currencies.map((currency) => (
            <div key={currency} className="space-y-0.5">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Billed</dt>
                <dd className="font-semibold tabular-nums">{find(billed, currency) ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Received</dt>
                <dd className="font-semibold tabular-nums">{find(received, currency) ?? "—"}</dd>
              </div>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-[13px] font-semibold">{children}</h3>;
}

function Panel({ empty, children }: { empty?: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      {empty ? <p className="px-5 py-8 text-center text-sm text-muted">{empty}</p> : children}
    </div>
  );
}

/** `hideOnSmall` lists the columns (by index) that drop out on narrow screens. */
function Table({ headings, hideOnSmall, children }: { headings: string[]; hideOnSmall: number[]; children: ReactNode }) {
  return (
    <table className="w-full text-left text-[13px]">
      <thead className="border-b border-line text-[11px] font-medium tracking-wide text-muted uppercase">
        <tr>
          {headings.map((heading, i) => (
            <th
              key={heading}
              className={`px-4 py-2.5 font-medium ${i === headings.length - 1 ? "text-right" : ""} ${hideOnSmall.includes(i) ? "max-sm:hidden" : ""}`}
            >
              {heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">{children}</tbody>
    </table>
  );
}
