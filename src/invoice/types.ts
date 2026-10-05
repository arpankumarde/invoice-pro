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

/** A row of a receipt's "Payment history". Empty strings leave the cell blank. */
export interface PaymentRow {
  method: string;
  /** Small print under the method, e.g. a UTR or transaction reference. */
  details: string[];
  date: string;
  amount: string;
  receiptNumber: string;
}

/** Everything the PDF renderer needs for an invoice or one of its receipts, already validated and formatted. */
export interface ResolvedDocument {
  kind: "invoice" | "receipt";
  /** Unique across the folder: the invoice file's name, plus "/receipt-<n>" for its receipts. */
  id: string;
  /** The invoice file, also for receipts. */
  file: string;
  /** Receipts take their invoice's status. */
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
  /** Receipts: the payments made so far, this receipt's last. Empty on invoices. */
  payments: PaymentRow[];
  footnotes: string[];
  footer?: string;
}

export type PaymentStatus = "unpaid" | "partial" | "paid";

export interface ResolvedInvoice extends ResolvedDocument {
  kind: "invoice";
  /** One per payment, in the order they were made. */
  receipts: ResolvedDocument[];
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
