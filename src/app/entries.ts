import type { InvoiceEntry, InvoiceStatus } from "../invoice/types.ts";

export const entryStatus = (entry: InvoiceEntry): InvoiceStatus => (entry.ok ? entry.invoice.status : (entry.status ?? "draft"));
export const entryTitle = (entry: InvoiceEntry) => (entry.ok ? entry.invoice.number : entry.number) ?? entry.id;
export const sortKey = (entry: InvoiceEntry) => (entry.ok ? entry.invoice.summary.sortKey : `0000 ${entry.id}`);
export const joinParts = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" · ");
