export type InvoiceStatus = "draft" | "final";

export type PageSize = "LETTER" | "A4";

export interface Settings {
  locale: string;
  currency: string;
  pageSize: PageSize;
  /** The strip across the top of every page. */
  accentColor: string;
  /** When set, the strip fades from accentColor on the left to this colour on the right. */
  accentColorEnd?: string;
  linkColor: string;
  /** Editing is always blocked; these control what else viewers may do. */
  permissions: {
    printing: boolean;
    copying: boolean;
    annotating: boolean;
  };
}

export interface TaxId {
  type?: string;
  value: string;
}

/** Seller or customer. Anything left out of the JSON is left off the invoice. */
export interface Party {
  name?: string;
  address: string[];
  email?: string;
  phone?: string;
  taxIds: TaxId[];
}

/** Raw JSON as read from src/data, before validation. */
export interface DataSet {
  settings: unknown;
  business: unknown;
  customers: unknown;
  taxes: unknown;
  invoices: { file: string; data: unknown }[];
  /** One file per payment received, naming the invoices it pays and how much goes to each. */
  payments: { file: string; data: unknown }[];
  /** File names of images present in src/data (for logo lookups). */
  images: string[];
}

export interface MetaRow {
  label: string;
  value: string;
  strong?: boolean;
}

export interface LineItem {
  description: string;
  details: string[];
  /** Empty when the JSON gives no quantity. */
  quantity: string;
  unitPrice: string;
  tax: string;
  /** Footnote numbers attached to the tax cell, e.g. [1]. */
  taxNotes: number[];
  amount: string;
}

export interface TotalRow {
  label: string;
  value: string;
  strong?: boolean;
}

/** A row of a receipt: what the payment put towards one of the invoices it pays. */
export interface AllocationRow {
  invoice: string;
  issueDate: string;
  total: string;
  /** Paid on this invoice by earlier payments. */
  paidBefore: string;
  amount: string;
  /** Still owed on this invoice after this payment. */
  balance: string;
}

/** Everything the PDF renderer needs for an invoice or one of its receipts, already validated and formatted. */
export interface ResolvedDocument {
  kind: "invoice" | "receipt";
  /** The invoice or payment file's name, without folder or extension. */
  id: string;
  /** The invoice or payment file. */
  file: string;
  /** Receipts take their invoices' status: draft while any of them is. */
  status: InvoiceStatus;
  /** Invoice number, or receipt number on a receipt. */
  number?: string;
  fileName: string;
  settings: Settings;
  meta: MetaRow[];
  seller?: Party;
  /** Image file name in src/data. */
  logo?: string;
  billTo?: Party;
  headline: string;
  payUrl?: string;
  /** "Pay by bank transfer" rows, e.g. Account number, IFSC. */
  bankAccount?: MetaRow[];
  memo?: string;
  hasQuantityColumn: boolean;
  hasTaxColumn: boolean;
  items: LineItem[];
  totals: TotalRow[];
  /** Receipts: one row per invoice the payment pays, drawn instead of the line items. Empty on invoices. */
  allocations: AllocationRow[];
  footnotes: string[];
  footer?: string;
}

export type PaymentStatus = "unpaid" | "partial" | "paid";

export interface ResolvedReceipt extends ResolvedDocument {
  kind: "receipt";
  summary: {
    amount: string;
    date?: string;
    /** ISO date, for sorting. */
    sortKey: string;
    /** Ids of the invoices it pays, in the payment's order. */
    invoices: string[];
  };
}

export interface ResolvedInvoice extends ResolvedDocument {
  kind: "invoice";
  /** One per payment towards this invoice, in the order they were made. */
  receipts: ResolvedReceipt[];
  summary: {
    customer?: string;
    amountDue: string;
    issueDate?: string;
    /** ISO date, for sorting. */
    sortKey: string;
    payment: PaymentStatus;
    /** ISO code, e.g. "INR". */
    currency: string;
    /** The invoice total in currency units (not minor units), e.g. to prefill a payment. */
    total: number;
    /** What has been paid so far, in currency units. */
    paid: number;
  };
}

/** `customerId` is set when the invoice names a customer from customers.json, even if it has errors. */
export type InvoiceEntry =
  | { id: string; file: string; customerId?: string; ok: true; invoice: ResolvedInvoice }
  | {
      id: string;
      file: string;
      customerId?: string;
      ok: false;
      errors: string[];
      status?: InvoiceStatus;
      number?: string;
    };

/**
 * A payment file. `invoiceIds` and `customerId` are read from the raw JSON, so they are known even
 * when the payment has errors; the customer is that of its first invoice.
 */
export type PaymentEntry = { id: string; file: string; invoiceIds: string[]; customerId?: string } & (
  | { ok: true; receipt: ResolvedReceipt }
  | { ok: false; errors: string[]; receiptNumber?: string }
);

export interface Resolved {
  invoices: InvoiceEntry[];
  payments: PaymentEntry[];
}
