import { useState } from "react";
import { Link, Navigate, useNavigate, useOutletContext, useParams } from "react-router";
import { DATA_FOLDER, saveFile } from "../app/api.ts";
import { refresh, type Snapshot } from "../app/data.ts";
import { asObj, isObj, tidy } from "../app/editor/json.ts";
import { entryStatus, entryTitle, paymentTitle } from "../app/entries.ts";
import { downloadPdf } from "../app/generate.ts";
import { PdfPreview } from "../app/PdfPreview.tsx";
import { invoiceMailto, invoiceMessage } from "../app/share.ts";
import {
  Code,
  CopyIcon,
  DownloadIcon,
  Errors,
  MailIcon,
  MoreMenu,
  Notice,
  PageHeader,
  PageSkeleton,
  PaymentBadge,
  PencilIcon,
  PlusIcon,
  ReceiptIcon,
  primaryButton,
  secondaryButton,
  StatusBadge,
  Toast,
} from "../app/ui.tsx";
import { usePdf } from "../app/usePdf.ts";
import type { InvoiceEntry, InvoiceStatus } from "../invoice/types.ts";
import type { Workspace } from "./Layout.tsx";
import { customerPath, editPath, invoicePath, receiptPath } from "./paths.ts";
import { PaymentDialog } from "./PaymentDialog.tsx";

/** "/invoices/:invoiceId": an invoice as the finished PDF, with links to its receipts. */
export function InvoicePage() {
  const { snapshot, entries } = useOutletContext<Workspace>();
  const { invoiceId } = useParams();
  const entry = entries.find((entry) => entry.id === invoiceId);
  if (entry) return <InvoiceView key={entry.id} snapshot={snapshot} entry={entry} />;
  // Invoices that no longer exist land on the latest one.
  if (entries[0]) return <Navigate to={invoicePath(entries[0].id)} replace />;

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

function InvoiceView({ snapshot, entry }: { snapshot: Snapshot; entry: InvoiceEntry }) {
  const navigate = useNavigate();
  const invoice = entry.ok ? entry.invoice : undefined;
  const pdf = usePdf(invoice, snapshot.images);
  // The payment dialog: a new payment, or the payment file being fixed.
  const [paymentDialog, setPaymentDialog] = useState<{ file?: string }>();
  // Payments towards this invoice that have problems, so they can be opened and fixed.
  const brokenPayments = snapshot.payments.filter((payment) => !payment.ok && payment.invoiceIds.includes(entry.id));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [emailNote, setEmailNote] = useState<string>();

  const copySummary = async () => {
    if (!invoice) return;
    try {
      await navigator.clipboard.writeText(invoiceMessage(invoice));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setSaveError("Could not copy to the clipboard.");
    }
  };

  // mailto: links can't carry attachments, so the PDF is downloaded for attaching.
  const emailInvoice = () => {
    if (!invoice || !pdf.bytes) return;
    downloadPdf(pdf.bytes, invoice.fileName);
    setEmailNote(`Downloaded ${invoice.fileName}. Attach it to the email that just opened.`);
    window.location.href = invoiceMailto(invoice);
  };

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
      setSaveError(`Could not change the status: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title={entryTitle(entry)}
        badges={
          <>
            {!entry.ok && <StatusBadge status={status} invalid />}
            {invoice && <PaymentBadge payment={invoice.summary.payment} />}
          </>
        }
        subtitle={
          invoice ? (
            <>
              {entry.customerId && invoice.summary.customer ? (
                <Link to={customerPath(entry.customerId)} className="hover:text-ink hover:underline">
                  {invoice.summary.customer}
                </Link>
              ) : (
                invoice.summary.customer
              )}
              {invoice.summary.customer && " · "}
              <span className="whitespace-nowrap">{invoice.headline}</span>
            </>
          ) : (
            entry.file
          )
        }
        actions={
          <>
            <Link to={editPath({ kind: "invoice", file: entry.file })} className={secondaryButton}>
              <PencilIcon className="shrink-0" />
              Edit
            </Link>
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
            <MoreMenu
              items={[
                {
                  label: "Email to customer",
                  icon: <MailIcon />,
                  disabled: !pdf.bytes,
                  title: invoice?.billTo?.email ? `Email ${invoice.billTo.email}` : "Open a new email",
                  onSelect: emailInvoice,
                },
                { label: "Copy summary", icon: <CopyIcon />, disabled: !invoice, onSelect: () => void copySummary() },
                {
                  label: "Duplicate for next month",
                  icon: <PlusIcon />,
                  disabled: !isObj(record),
                  to: editPath({ kind: "invoice", from: entry.file }),
                },
              ]}
            />
            <button
              type="button"
              disabled={!pdf.bytes}
              onClick={() => invoice && pdf.bytes && downloadPdf(pdf.bytes, invoice.fileName)}
              className={primaryButton}
            >
              <DownloadIcon />
              {invoice?.status === "draft" ? "Download draft" : "Download PDF"}
            </button>
          </>
        }
      />
      <Toast message={copied ? "Summary copied" : undefined} />

      {paymentDialog && (
        <PaymentDialog
          snapshot={snapshot}
          file={paymentDialog.file}
          invoiceId={entry.id}
          onClose={() => setPaymentDialog(undefined)}
          // Show the new receipt; after a delete, stay on the invoice.
          onSaved={(paymentId) => {
            setPaymentDialog(undefined);
            if (paymentId) void navigate(receiptPath(paymentId));
          }}
        />
      )}

      <div className="mx-auto max-w-[880px] space-y-4 px-4 py-6 sm:px-8">
        {saveError && (
          <Notice tone="error" onDismiss={() => setSaveError(undefined)}>
            {saveError}
          </Notice>
        )}
        {emailNote && (
          <Notice tone="info" onDismiss={() => setEmailNote(undefined)}>
            {emailNote}
          </Notice>
        )}
        {brokenPayments.length > 0 && (
          <Notice
            tone="error"
            action={brokenPayments.map((payment) => (
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
          >
            {brokenPayments.length === 1 ? "A payment" : `${brokenPayments.length} payments`} towards this invoice
            {brokenPayments.length === 1 ? " has" : " have"} problems.
          </Notice>
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
        {pdf.error && <Notice tone="error">Could not build the PDF: {pdf.error}</Notice>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StatusToggle status={status} disabled={saving || !isObj(record)} onChange={(next) => void setStatus(next)} />
          {invoice && invoice.receipts.length > 0 && (
            <nav className="flex flex-wrap items-center gap-2 text-[13px]" aria-label="Receipts">
              <span className="text-muted">Receipts</span>
              {invoice.receipts.map((receipt) => (
                <Link
                  key={receipt.id}
                  to={receiptPath(receipt.id)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-black/10 bg-white px-2.5 py-1 font-medium hover:bg-black/[0.03]"
                >
                  <ReceiptIcon />
                  {receipt.number ?? receipt.id}
                  <span className="font-normal text-muted tabular-nums">{receipt.summary.amount}</span>
                </Link>
              ))}
            </nav>
          )}
        </div>
        {invoice &&
          (pdf.previewBytes ? (
            <PdfPreview bytes={pdf.previewBytes} label={invoice.number ?? entryTitle(entry)} />
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
    <div className="flex h-8 rounded-md bg-black/[0.05] p-0.5 text-[13px] font-medium" role="radiogroup" aria-label="Status">
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
