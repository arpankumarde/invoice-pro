import { useState } from "react";
import { Link, Navigate, useNavigate, useOutletContext, useParams } from "react-router";
import { DATA_FOLDER, saveFile } from "../app/api.ts";
import { refresh, type Snapshot } from "../app/data.ts";
import { asList, asObj, isObj, tidy } from "../app/editor/json.ts";
import { entryStatus, entryTitle, joinParts } from "../app/entries.ts";
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
import { documentPath, editPath } from "./paths.ts";
import { PaymentsDialog } from "./PaymentsDialog.tsx";

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
  const doc = invoice?.receipts.find((candidate) => candidate.id === `${entry.id}/${receipt}`) ?? invoice;
  const pdf = usePdf(doc, snapshot.images);
  const [managingPayments, setManagingPayments] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  // Writes the status into the invoice file the way the editor saves it. Works on invoices with
  // errors too, as long as the file holds a JSON object.
  const record = snapshot.raw.invoices.find((inv) => inv.file === entry.file)?.data;
  const status = entryStatus(entry);
  const paymentCount = asList(asObj(record).payments).length;
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
              {invoice && doc ? joinParts(invoice.summary.customer, doc.headline) : entry.file}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusToggle status={status} disabled={saving || !isObj(record)} onChange={(next) => void setStatus(next)} />
            <button
              type="button"
              disabled={!isObj(record)}
              onClick={() => setManagingPayments(true)}
              className={secondaryButton}
            >
              <ReceiptIcon />
              {paymentCount === 0 ? "Record payment" : "Payments"}
              {paymentCount > 0 && (
                <span className="rounded bg-black/[0.06] px-1.5 text-[11px] tabular-nums text-muted">{paymentCount}</span>
              )}
            </button>
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

      {managingPayments && (
        <PaymentsDialog
          snapshot={snapshot}
          file={entry.file}
          title={entryTitle(entry)}
          invoice={invoice}
          // Opens on the receipt being viewed.
          initialIndex={doc?.kind === "receipt" ? invoice?.receipts.indexOf(doc) : undefined}
          onClose={() => setManagingPayments(false)}
          // Show the receipt of the payment that was selected, or the invoice when none was.
          onSaved={(index) => {
            setManagingPayments(false);
            void navigate(documentPath(index === undefined ? entry.id : `${entry.id}/receipt-${index + 1}`));
          }}
        />
      )}

      <div className="mx-auto max-w-[880px] px-4 py-6 sm:px-8">
        {saveError && (
          <p className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-800" role="alert">
            Could not change the status: {saveError}
          </p>
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
          <DocumentTabs invoice={invoice} selectedId={doc.id} onSelect={(id) => void navigate(documentPath(id))} />
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
