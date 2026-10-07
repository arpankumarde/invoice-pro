import { useState } from "react";
import { Link, Navigate, useNavigate, useOutletContext, useParams } from "react-router";
import { DATA_FOLDER } from "../app/api.ts";
import type { Snapshot } from "../app/data.ts";
import { entryTitle, paymentTitle } from "../app/entries.ts";
import { downloadPdf } from "../app/generate.ts";
import { PdfPreview } from "../app/PdfPreview.tsx";
import {
  Code,
  DownloadIcon,
  Errors,
  PageSkeleton,
  PencilIcon,
  primaryButton,
  secondaryButton,
  StatusBadge,
} from "../app/ui.tsx";
import { usePdf } from "../app/usePdf.ts";
import type { InvoiceEntry, PaymentEntry } from "../invoice/types.ts";
import type { Workspace } from "./Layout.tsx";
import { customerPath, invoicePath, receiptPath } from "./paths.ts";
import { PaymentDialog } from "./PaymentDialog.tsx";

/** "/receipts/:receiptId": a payment's receipt as the finished PDF, with links to the invoices it pays. */
export function ReceiptPage() {
  const { snapshot, entries } = useOutletContext<Workspace>();
  const { receiptId } = useParams();
  const payment = snapshot.payments.find((candidate) => candidate.id === receiptId);
  // Receipts that no longer exist land on the latest invoice.
  if (!payment) return <Navigate to="/" replace />;
  return <ReceiptView snapshot={snapshot} entries={entries} payment={payment} />;
}

function ReceiptView({ snapshot, entries, payment }: { snapshot: Snapshot; entries: InvoiceEntry[]; payment: PaymentEntry }) {
  const navigate = useNavigate();
  const receipt = payment.ok ? payment.receipt : undefined;
  const pdf = usePdf(receipt, snapshot.images);
  const [editing, setEditing] = useState(false);
  const invoices = payment.invoiceIds.map((id) => {
    const entry = entries.find((candidate) => candidate.id === id);
    return { id, title: entry ? entryTitle(entry) : id, exists: Boolean(entry) };
  });
  const customer = receipt?.billTo?.name;

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-[880px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="truncate text-lg font-semibold">Receipt {paymentTitle(payment)}</h2>
              {!receipt ? (
                <StatusBadge status="draft" invalid />
              ) : (
                receipt.status === "draft" && <StatusBadge status="draft" />
              )}
            </div>
            <p className="mt-0.5 truncate text-[13px] text-muted">
              {receipt ? (
                <>
                  {payment.customerId && customer ? (
                    <Link to={customerPath(payment.customerId)} className="hover:text-ink hover:underline">
                      {customer}
                    </Link>
                  ) : (
                    customer
                  )}
                  {customer && " · "}
                  {receipt.headline}
                </>
              ) : (
                payment.file
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setEditing(true)} className={secondaryButton}>
              <PencilIcon className="shrink-0" />
              Edit payment
            </button>
            <button
              type="button"
              disabled={!pdf.bytes}
              onClick={() => receipt && pdf.bytes && downloadPdf(pdf.bytes, receipt.fileName)}
              className={primaryButton}
            >
              <DownloadIcon />
              {receipt?.status === "draft" ? "Download draft" : "Download PDF"}
            </button>
          </div>
        </div>
      </header>

      {editing && (
        <PaymentDialog
          snapshot={snapshot}
          file={payment.file}
          onClose={() => setEditing(false)}
          // Stay on the receipt; after a delete, go to the customer, or the invoice it paid.
          onSaved={(paymentId) => {
            setEditing(false);
            if (paymentId) return void navigate(receiptPath(paymentId));
            const invoice = invoices.find((candidate) => candidate.exists);
            void navigate(payment.customerId ? customerPath(payment.customerId) : invoice ? invoicePath(invoice.id) : "/");
          }}
        />
      )}

      <div className="mx-auto max-w-[880px] px-4 py-6 sm:px-8">
        {!payment.ok && (
          <div className="mb-6">
            <Errors
              title="This receipt can't be generated yet"
              intro={
                <>
                  Fix the following in <Code>{`${DATA_FOLDER}/${payment.file}`}</Code>, or with Edit payment:
                </>
              }
              errors={payment.errors}
            />
          </div>
        )}
        {pdf.error && (
          <p className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-800">Could not build the PDF: {pdf.error}</p>
        )}
        {invoices.length > 0 && (
          <nav className="mb-4 flex flex-wrap items-center gap-2 text-[13px]" aria-label="Invoices paid">
            <span className="text-muted">Pays</span>
            {invoices.map((invoice) =>
              invoice.exists ? (
                <Link
                  key={invoice.id}
                  to={invoicePath(invoice.id)}
                  className="rounded-md border border-black/10 bg-white px-2.5 py-1 font-medium hover:bg-black/[0.03]"
                >
                  {invoice.title}
                </Link>
              ) : (
                <span key={invoice.id} className="rounded-md bg-red-50 px-2.5 py-1 font-medium text-red-800">
                  {invoice.title}
                </span>
              ),
            )}
          </nav>
        )}
        {receipt &&
          (pdf.previewBytes ? (
            <PdfPreview bytes={pdf.previewBytes} label={`Receipt ${paymentTitle(payment)}`} />
          ) : (
            !pdf.error && <PageSkeleton />
          ))}
      </div>
    </>
  );
}
