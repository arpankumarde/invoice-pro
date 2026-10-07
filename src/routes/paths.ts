import { generatePath } from "react-router";
import type { EditTarget } from "../app/editor/target.ts";

/** Invoices are stored as invoices/<id>.json; URLs carry only the id. */
export const invoiceFile = (id: string) => `invoices/${id}.json`;
const invoiceIdOf = (file: string) => file.replace(/^invoices\//, "").replace(/\.json$/, "");

/** The page for an invoice, or for the receipt of a payment towards it (by payment id). */
export const documentPath = (invoiceId: string, receiptId?: string) =>
  generatePath("/invoices/:invoiceId/:receipt?", { invoiceId, receipt: receiptId });

/** A customer's page: their details and every invoice billed to them. */
export const customerPath = (id: string) => generatePath("/customers/:customerId", { customerId: id });

/** The editor page for a record. Invoices and customers without a file or id start a new one. */
export function editPath(target: EditTarget) {
  if (target.kind === "invoice") {
    return generatePath("/edit/invoices/:id?", { id: target.file && invoiceIdOf(target.file) });
  }
  if (target.kind === "customer") return generatePath("/edit/customers/:id?", { id: target.id });
  return `/edit/${target.kind}`;
}
