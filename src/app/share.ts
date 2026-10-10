import type { ResolvedInvoice } from "../invoice/types.ts";

/** A short message to paste into chat or email: number, amount, due date and where to pay. */
export function invoiceMessage(invoice: ResolvedInvoice) {
  const { amountDue, dueDate, payment } = invoice.summary;
  const subject = invoice.number ? `Invoice ${invoice.number}` : "Invoice";
  if (payment === "paid") return `${subject} for ${amountDue} has been paid. Thank you!`;
  const due = dueDate ? `is due on ${dueDate}` : "is due";
  return `${subject} for ${amountDue} ${due}${invoice.payUrl ? `, pay at ${invoice.payUrl}` : ""}.`;
}

/**
 * A mailto: link to the customer with the message filled in. mailto: cannot carry attachments, so
 * the caller downloads the PDF for the user to attach.
 */
export function invoiceMailto(invoice: ResolvedInvoice) {
  const seller = invoice.seller?.name;
  const subject = `${invoice.number ? `Invoice ${invoice.number}` : "Invoice"}${seller ? ` from ${seller}` : ""}`;
  const body = `Hi${invoice.billTo?.name ? ` ${invoice.billTo.name}` : ""},\r\n\r\n${invoiceMessage(invoice)} The PDF is attached.\r\n\r\nThanks${seller ? `,\r\n${seller}` : ""}`;
  const to = invoice.billTo?.email ? encodeURIComponent(invoice.billTo.email) : "";
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
