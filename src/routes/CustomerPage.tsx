import { type ReactNode, useState } from "react";
import { Link, Navigate, useNavigate, useOutletContext, useParams } from "react-router";
import { DATA_FOLDER } from "../app/api.ts";
import type { Snapshot } from "../app/data.ts";
import { customerDetails, type CustomerSummary, customerSummaries } from "../app/customers.ts";
import { entryStatus, entryTitle, paymentTitle } from "../app/entries.ts";
import {
  Code,
  Notice,
  PageHeader,
  PaymentBadge,
  PencilIcon,
  PlusIcon,
  primaryButton,
  ReceiptIcon,
  secondaryButton,
  StatusBadge,
} from "../app/ui.tsx";
import type { InvoiceEntry } from "../invoice/types.ts";
import type { Workspace } from "./Layout.tsx";
import { customerPath, editPath, invoicePath, receiptPath } from "./paths.ts";
import { PaymentDialog } from "./PaymentDialog.tsx";

/** "/customers/:customerId?": a customer's details and every invoice billed to them. */
export function CustomerPage() {
  const { snapshot, entries } = useOutletContext<Workspace>();
  const { customerId } = useParams();
  const customers = customerSummaries(snapshot, entries);
  const customer = customers.find((candidate) => candidate.id === customerId);
  if (customer) return <CustomerView snapshot={snapshot} entries={entries} customer={customer} />;
  // "/customers" and customers that no longer exist land on the first one.
  if (customers[0]) return <Navigate to={customerPath(customers[0].id)} replace />;

  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <h2 className="text-lg font-semibold">No customers yet</h2>
      <p className="mt-2 text-sm text-muted">Add one, then bill invoices to them.</p>
      <Link to={editPath({ kind: "customer" })} className={`${primaryButton} mt-6`}>
        <PlusIcon />
        New customer
      </Link>
    </div>
  );
}

function CustomerView({
  snapshot,
  entries,
  customer,
}: {
  snapshot: Snapshot;
  entries: InvoiceEntry[];
  customer: CustomerSummary;
}) {
  const navigate = useNavigate();
  const details = customerDetails(snapshot, customer.id);
  const drafts = customer.entries.filter((entry) => entryStatus(entry) === "draft").length;
  // The payment dialog: a new payment, or the payment file being edited.
  const [paymentDialog, setPaymentDialog] = useState<{ file?: string }>();
  const invoiceTitle = (id: string) => {
    const entry = entries.find((candidate) => candidate.id === id);
    return entry ? entryTitle(entry) : id;
  };

  return (
    <>
      <PageHeader
        title={customer.name ?? customer.id}
        subtitle={`${customer.id} · ${plural(customer.entries.length, "invoice")}`}
        actions={
          <>
            {customer.defined && (
              <Link to={editPath({ kind: "customer", id: customer.id })} className={secondaryButton}>
                <PencilIcon className="shrink-0" />
                Edit customer
              </Link>
            )}
            <button
              type="button"
              disabled={customer.entries.length === 0}
              onClick={() => setPaymentDialog({})}
              className={primaryButton}
            >
              <ReceiptIcon />
              Record payment
            </button>
          </>
        }
      />

      {paymentDialog && (
        <PaymentDialog
          snapshot={snapshot}
          file={paymentDialog.file}
          customerId={customer.id}
          onClose={() => setPaymentDialog(undefined)}
          // Show the new receipt; after a delete, stay on the customer.
          onSaved={(paymentId) => {
            setPaymentDialog(undefined);
            if (paymentId) void navigate(receiptPath(paymentId));
          }}
        />
      )}

      <div className="mx-auto max-w-[880px] space-y-6 px-4 py-6 sm:px-8">
        {!customer.defined && (
          <Notice tone="error">
            These invoices bill <Code>{customer.id}</Code>, which isn't defined in{" "}
            <Code>{`${DATA_FOLDER}/customers.json`}</Code>.
          </Notice>
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
                  <th className="w-0 px-2 py-2.5">
                    <span className="sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {customer.entries.map((entry) => {
                  const to = invoicePath(entry.id);
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
                      <td className="px-2 py-1.5">
                        <Link
                          to={editPath({ kind: "invoice", file: entry.file })}
                          aria-label={`Edit invoice ${entryTitle(entry)}`}
                          title="Edit invoice"
                          className="grid size-8 place-items-center rounded-md text-muted hover:bg-black/[0.04] hover:text-ink"
                        >
                          <PencilIcon className="shrink-0" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {customer.payments.length > 0 && (
          <section>
            <h3 className="mb-2 text-[13px] font-semibold">Payments</h3>
            <div className="overflow-hidden rounded-lg border border-line bg-white">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-line text-[11px] font-medium tracking-wide text-muted uppercase">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Receipt</th>
                    <th className="px-4 py-2.5 font-medium max-sm:hidden">Paid</th>
                    <th className="px-4 py-2.5 font-medium">Invoices</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                    <th className="w-0 px-2 py-2.5">
                      <span className="sr-only">Edit</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {customer.payments.map((payment) => {
                    const to = payment.ok ? receiptPath(payment.id) : undefined;
                    // Valid payments link to their receipt; only the first cell takes keyboard focus.
                    const cell = (children: ReactNode, focusable = false) =>
                      to ? (
                        <Link to={to} className="block px-4 py-3" tabIndex={focusable ? undefined : -1}>
                          {children}
                        </Link>
                      ) : (
                        <div className="px-4 py-3">{children}</div>
                      );
                    return (
                      <tr key={payment.file} className="hover:bg-canvas/60">
                        <td className="p-0 font-medium">{cell(paymentTitle(payment), true)}</td>
                        <td className="p-0 text-muted max-sm:hidden">
                          {cell((payment.ok && payment.receipt.summary.date) || "—")}
                        </td>
                        <td className="p-0 text-muted">{cell(payment.invoiceIds.map(invoiceTitle).join(", ") || "—")}</td>
                        <td className="p-0 text-right tabular-nums">
                          {cell(payment.ok ? payment.receipt.summary.amount : <span className="text-red-700">Needs fixing</span>)}
                        </td>
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => setPaymentDialog({ file: payment.file })}
                            aria-label={`Edit payment ${paymentTitle(payment)}`}
                            title="Edit payment"
                            className="grid size-8 place-items-center rounded-md text-muted hover:bg-black/[0.04] hover:text-ink"
                          >
                            <PencilIcon className="shrink-0" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

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
