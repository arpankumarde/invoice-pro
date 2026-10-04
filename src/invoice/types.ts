export type InvoiceStatus = "draft" | "final";

export type PageSize = "LETTER" | "A4";

export interface Settings {
  locale: string;
  currency: string;
  pageSize: PageSize;
  accentColor: string;
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

/** Everything the PDF renderer needs, already validated and formatted. */
export interface ResolvedInvoice {
  id: string;
  file: string;
  status: InvoiceStatus;
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
  memo?: string;
  hasQuantityColumn: boolean;
  hasTaxColumn: boolean;
  items: LineItem[];
  totals: TotalRow[];
  footnotes: string[];
  footer?: string;
  summary: {
    customer?: string;
    amountDue: string;
    issueDate?: string;
    /** ISO date, for sorting. */
    sortKey: string;
  };
}

export type InvoiceEntry =
  | { id: string; file: string; ok: true; invoice: ResolvedInvoice }
  | { id: string; file: string; ok: false; errors: string[]; status?: InvoiceStatus; number?: string };
