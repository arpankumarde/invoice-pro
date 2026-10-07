import { useState } from "react";
import { Link, Navigate, useNavigate, useOutletContext, useParams } from "react-router";
import { DATA_FOLDER, saveFile } from "../app/api.ts";
import { refresh, type Snapshot } from "../app/data.ts";
import { asObj, isObj, tidy } from "../app/editor/json.ts";
import { entryStatus, entryTitle, paymentTitle } from "../app/entries.ts";
import { downloadPdf } from "../app/generate.ts";
import { PdfPreview } from "../app/PdfPreview.tsx";
import {
  Code,
  DocumentTabs,
  DownloadIcon,
  Errors,
  PageSkeleton,
  PaymentBadge,
  PencilIcon,
  PlusIcon,
  ReceiptIcon,
  primaryButton,
  secondaryButton,
  StatusBadge,
} from "../app/ui.tsx";
import { usePdf } from "../app/usePdf.ts";
import type { InvoiceEntry, InvoiceStatus } from "../invoice/types.ts";
import type { Workspace } from "./Layout.tsx";
import { customerPath, documentPath, editPath } from "./paths.ts";
import { PaymentDialog } from "./PaymentDialog.tsx";

/** "/" and "/invoices/:invoiceId/:receipt?": an invoice, or one of its receipts, as the finished PDF. */
export function InvoicePage() {
  const { snapshot, entries } = useOutletContext<Workspace>();
  const { invoiceId, receipt } = useParams();
  const entry = entries.find((entry) => entry.id === invoiceId);
  if (entry) return <InvoiceView snapshot={snapshot} entry={entry} receipt={receipt} />;
  // "/" and invoices that no longer exist land on the latest one.
  if (entries[0]) return <Navigate to={documentPath(entries[0].id)} replace />;

  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <h2 className="text-lg font-semibold">No invoices yet</h2>
      <p className="mt-2 text-sm text-muted">
        Create your first one in the editor.
      </p>
      <Link to={editPath({ kind: "invoice" })} className={`${primaryButton} mt-6`}>
        <PlusIcon />
        New invoice
      </Link>
    </div>
  );
}

function InvoiceView({ snapshot, entry, receipt }: { snapshot: Snapshot; entry: InvoiceEntry; receipt?: string }) {
  const navigate = useNavigate();
  const invoice = entry.ok ? entry.invoice : undefined;
  // The invoice itself, or the receipt named in the URL.
  const doc = invoice?.receipts.find((candidate) => candidate.id === receipt) ?? invoice;
  const pdf = usePdf(doc, snapshot.images);
  // The payment dialog: a new payment, or the payment file being edited.
  const [paymentDialog, setPaymentDialog] = useState<{ file?: string }>();
  // Payments towards this invoice that have problems, so they can be opened and fixed.
  const brokenPayments = snapshot.payments.filter((payment) => !payment.ok && payment.invoiceIds.includes(entry.id));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  // Writes the status into the invoice file the way the editor saves it. Works on invoices with
  // errors too, as long as the file holds a JSON object.
  const record = snapshot.raw.invoices.find((inv) => inv.file === entry.file)?.data;
  const status = entryStatus(entry);
  const setStatus = async (next: InvoiceStatus) => {
    if (next === status || saving) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await saveFile(entry.file, tidy({ ...asObj(record), status: next }, "invoice"));
      await refresh();
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-[880px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="truncate text-lg font-semibold">{entryTitle(entry)}</h2>
              {!entry.ok && <StatusBadge status={status} invalid />}
              {invoice && <PaymentBadge payment={invoice.summary.payment} />}
            </div>
            <p className="mt-0.5 truncate text-[13px] text-muted">
              {invoice && doc ? (
                <>
                  {entry.customerId && invoice.summary.customer ? (
                    <Link to={customerPath(entry.customerId)} className="hover:text-ink hover:underline">
                      {invoice.summary.customer}
                    </Link>
                  ) : (
                    invoice.summary.customer
                  )}
                  {invoice.summary.customer && " · "}
                  {doc.headline}
                </>
              ) : (
                entry.file
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusToggle status={status} disabled={saving || !isObj(record)} onChange={(next) => void setStatus(next)} />
            {doc?.kind === "receipt" ? (
              <button type="button" onClick={() => setPaymentDialog({ file: doc.file })} className={secondaryButton}>
                <PencilIcon className="shrink-0" />
                Edit payment
              </button>
            ) : (
              <button
                type="button"
                disabled={!isObj(record) || invoice?.summary.payment === "paid"}
                title={invoice?.summary.payment === "paid" ? "Paid in full" : undefined}
                onClick={() => setPaymentDialog({})}
                className={secondaryButton}
              >
                <ReceiptIcon />
                Record payment
              </button>
            )}
            <Link to={editPath({ kind: "invoice", file: entry.file })} className={secondaryButton}>
              <PencilIcon className="shrink-0" />
              Edit
            </Link>
            <button
              type="button"
              disabled={!pdf.bytes}
              onClick={() => doc && pdf.bytes && downloadPdf(pdf.bytes, doc.fileName)}
              className={primaryButton}
            >
              <DownloadIcon />
              {doc?.status === "draft" ? "Download draft" : "Download PDF"}
            </button>
          </div>
        </div>
      </header>

      {paymentDialog && (
        <PaymentDialog
          snapshot={snapshot}
          file={paymentDialog.file}
          invoiceId={entry.id}
          onClose={() => setPaymentDialog(undefined)}
          // Show the payment's receipt, or the invoice once the payment is deleted.
          onSaved={(paymentId) => {
            setPaymentDialog(undefined);
            void navigate(documentPath(entry.id, paymentId));
          }}
        />
      )}

      <div className="mx-auto max-w-[880px] px-4 py-6 sm:px-8">
        {saveError && (
          <p className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-800" role="alert">
            Could not change the status: {saveError}
          </p>
        )}
        {brokenPayments.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-4 text-sm text-red-800" role="alert">
            <span className="mr-auto">
              {brokenPayments.length === 1 ? "A payment" : `${brokenPayments.length} payments`} towards this invoice
              {brokenPayments.length === 1 ? " has" : " have"} problems.
            </span>
            {brokenPayments.map((payment) => (
              <button
                key={payment.file}
                type="button"
                onClick={() => setPaymentDialog({ file: payment.file })}
                className={secondaryButton}
              >
                <PencilIcon className="shrink-0" />
                Fix {paymentTitle(payment)}
              </button>
            ))}
          </div>
        )}
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
        {invoice && doc && (
          <DocumentTabs
            invoice={invoice}
            selectedId={doc.id}
            onSelect={(id) => void navigate(documentPath(entry.id, id === invoice.id ? undefined : id))}
          />
        )}
        {doc &&
          (pdf.previewBytes ? (
            <PdfPreview bytes={pdf.previewBytes} label={doc.number ?? entryTitle(entry)} />
          ) : (
            !pdf.error && <PageSkeleton />
          ))}
      </div>
    </>
  );
}

/** Draft or final, saved straight to the invoice file. */
function StatusToggle({
  status,
  disabled,
  onChange,
}: {
  status: InvoiceStatus;
  disabled: boolean;
  onChange: (status: InvoiceStatus) => void;
}) {
  return (
    <div className="flex h-9 rounded-md bg-black/[0.05] p-0.5 text-[13px] font-medium" role="radiogroup" aria-label="Status">
      {(["draft", "final"] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={status === option}
          disabled={disabled}
          onClick={() => onChange(option)}
          className="rounded px-3 text-muted transition enabled:hover:text-ink disabled:cursor-not-allowed aria-checked:bg-white aria-checked:text-ink aria-checked:shadow-sm"
        >
          {option === "draft" ? "Draft" : "Final"}
        </button>
      ))}
    </div>
  );
}
