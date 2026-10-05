import { Link, Navigate, useNavigate, useOutletContext, useParams } from "react-router";
import { DATA_FOLDER } from "../app/api.ts";
import type { Snapshot } from "../app/data.ts";
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
  primaryButton,
  secondaryButton,
  StatusBadge,
} from "../app/ui.tsx";
import { usePdf } from "../app/usePdf.ts";
import type { InvoiceEntry } from "../invoice/types.ts";
import type { Workspace } from "./Layout.tsx";
import { documentPath, editPath } from "./paths.ts";

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

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-[880px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="truncate text-lg font-semibold">{entryTitle(entry)}</h2>
              <StatusBadge status={entryStatus(entry)} invalid={!entry.ok} />
              {invoice && <PaymentBadge payment={invoice.summary.payment} />}
            </div>
            <p className="mt-0.5 truncate text-[13px] text-muted">
              {invoice && doc ? joinParts(invoice.summary.customer, doc.headline) : entry.file}
            </p>
          </div>
          <div className="flex gap-2">
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
