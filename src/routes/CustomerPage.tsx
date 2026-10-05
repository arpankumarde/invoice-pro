import type { ReactNode } from "react";
import { Link, Navigate, useOutletContext, useParams } from "react-router";
import { DATA_FOLDER } from "../app/api.ts";
import type { Snapshot } from "../app/data.ts";
import { customerDetails, type CustomerSummary, customerSummaries } from "../app/customers.ts";
import { entryStatus, entryTitle } from "../app/entries.ts";
import { Code, PaymentBadge, PencilIcon, PlusIcon, primaryButton, secondaryButton, StatusBadge } from "../app/ui.tsx";
import type { Workspace } from "./Layout.tsx";
import { customerPath, documentPath, editPath } from "./paths.ts";

/** "/customers/:customerId?": a customer's details and every invoice billed to them. */
export function CustomerPage() {
  const { snapshot, entries } = useOutletContext<Workspace>();
  const { customerId } = useParams();
  const customers = customerSummaries(snapshot, entries);
  const customer = customers.find((candidate) => candidate.id === customerId);
  if (customer) return <CustomerView snapshot={snapshot} customer={customer} />;
  // "/customers" and customers that no longer exist land on the first one.
  if (customers[0]) return <Navigate to={customerPath(customers[0].id)} replace />;

  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <h2 className="text-lg font-semibold">No customers yet</h2>
      <p className="mt-2 text-sm text-muted">Add one in the editor, then bill invoices to them.</p>
      <Link to={editPath({ kind: "customer" })} className={`${primaryButton} mt-6`}>
        <PlusIcon />
        New customer
      </Link>
    </div>
  );
}

function CustomerView({ snapshot, customer }: { snapshot: Snapshot; customer: CustomerSummary }) {
  const details = customerDetails(snapshot, customer.id);
  const drafts = customer.entries.filter((entry) => entryStatus(entry) === "draft").length;

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-[880px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{customer.name ?? customer.id}</h2>
            <p className="mt-0.5 truncate text-[13px] text-muted">
              {customer.id} · {plural(customer.entries.length, "invoice")}
            </p>
          </div>
          {customer.defined && (
            <Link to={editPath({ kind: "customer", id: customer.id })} className={secondaryButton}>
              <PencilIcon className="shrink-0" />
              Edit customer
            </Link>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[880px] space-y-6 px-4 py-6 sm:px-8">
        {!customer.defined && (
          <p className="rounded-lg bg-red-50 p-4 text-sm text-red-800" role="alert">
            These invoices bill <Code>{customer.id}</Code>, which isn't defined in{" "}
            <Code>{`${DATA_FOLDER}/customers.json`}</Code>.
          </p>
        )}

        {customer.balances.length > 0 && (
          <section>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Invoiced" values={customer.balances.map((balance) => balance.invoiced)} />
              <Stat label="Paid" values={customer.balances.map((balance) => balance.paid)} />
              <Stat
                label="Outstanding"
                values={customer.balances.map((balance) => balance.outstanding)}
                highlight={customer.balances.some((balance) => balance.due)}
              />
            </div>
            {drafts > 0 && (
              <p className="mt-2 text-xs text-muted">Totals cover final invoices only, not the {plural(drafts, "draft")}.</p>
            )}
          </section>
        )}

        <section className="overflow-hidden rounded-lg border border-line bg-white">
          {customer.entries.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">No invoices billed to this customer yet.</p>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-line text-[11px] font-medium tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Invoice</th>
                  <th className="px-4 py-2.5 font-medium max-sm:hidden">Issued</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {customer.entries.map((entry) => {
                  const to = documentPath(entry.id);
                  return (
                    <tr key={entry.id} className="hover:bg-canvas/60">
                      <td className="p-0">
                        <Link to={to} className="block px-4 py-3 font-medium">
                          {entryTitle(entry)}
                        </Link>
                      </td>
                      <td className="p-0 text-muted max-sm:hidden">
                        <Link to={to} className="block px-4 py-3" tabIndex={-1}>
                          {(entry.ok && entry.invoice.summary.issueDate) || "—"}
                        </Link>
                      </td>
                      <td className="p-0">
                        <Link to={to} className="flex flex-wrap items-center gap-1.5 px-4 py-3" tabIndex={-1}>
                          <StatusBadge status={entryStatus(entry)} invalid={!entry.ok} />
                          {entry.ok && <PaymentBadge payment={entry.invoice.summary.payment} />}
                        </Link>
                      </td>
                      <td className="p-0 text-right tabular-nums">
                        <Link to={to} className="block px-4 py-3" tabIndex={-1}>
                          {entry.ok ? entry.invoice.summary.amountDue : <span className="text-red-700">Needs fixing</span>}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {customer.defined && (
          <section className="grid gap-x-8 gap-y-4 rounded-lg border border-line bg-white p-5 text-[13px] sm:grid-cols-2">
            <Detail label="Address">
              {details.address.length > 0 ? details.address.map((line) => <div key={line}>{line}</div>) : undefined}
            </Detail>
            <div className="space-y-4">
              <Detail label="Email">
                {details.email && (
                  <a href={`mailto:${details.email}`} className="underline decoration-black/20 underline-offset-2">
                    {details.email}
                  </a>
                )}
              </Detail>
              <Detail label="Phone">{details.phone}</Detail>
              <Detail label="Tax IDs">
                {details.taxIds.length > 0
                  ? details.taxIds.map((taxId) => (
                      <div key={taxId.value}>
                        {taxId.type && <span className="text-muted">{taxId.type} </span>}
                        {taxId.value}
                      </div>
                    ))
                  : undefined}
              </Detail>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** One figure per currency the customer was billed in. */
function Stat({ label, values, highlight }: { label: string; values: string[]; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3">
      <div className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</div>
      {values.map((value) => (
        <div key={value} className={`mt-1 text-lg font-semibold tabular-nums ${highlight ? "text-violet-800" : ""}`}>
          {value}
        </div>
      ))}
    </div>
  );
}

function Detail({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 leading-relaxed">{children ?? <span className="text-muted">—</span>}</div>
    </div>
  );
}
