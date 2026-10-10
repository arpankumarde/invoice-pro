import { createFormatters, type Formatters, parseIsoDate } from "./format.ts";
import type {
  AllocationRow,
  DataSet,
  InvoiceEntry,
  InvoiceStatus,
  LineItem,
  MetaRow,
  Party,
  PaymentEntry,
  Resolved,
  ResolvedDocument,
  ResolvedInvoice,
  ResolvedReceipt,
  Settings,
  TaxId,
  TotalRow,
} from "./types.ts";

type Obj = Record<string, unknown>;

interface TaxRate {
  name: string;
  rate: number;
  note?: string;
}

interface Shared {
  settings: Settings;
  seller?: Party;
  logo?: string;
  customers: Record<string, Party>;
  taxes: Record<string, TaxRate>;
  bankAccounts: Record<string, MetaRow[]>;
}

export const DEFAULT_SETTINGS: Settings = {
  locale: "en-GB",
  currency: "INR",
  pageSize: "LETTER",
  accentColor: "#2563EB",
  linkColor: "#635BFF",
  permissions: { printing: true, copying: true, annotating: false },
};

const isObj = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBlank = (value: unknown) => value === undefined || value === null || value === "";

/* ---------- field readers: each records a readable error and returns a safe fallback ---------- */

function optStr(o: Obj, key: string, at: string, errors: string[]): string | undefined {
  const value = o[key];
  if (isBlank(value)) return undefined;
  if (typeof value !== "string") {
    errors.push(`${at}${key} must be text`);
    return undefined;
  }
  return value.trim() || undefined;
}

function strList(o: Obj, key: string, at: string, errors: string[]): string[] {
  const value = o[key];
  if (isBlank(value)) return [];
  if (typeof value === "string") return [value];
  if (!Array.isArray(value) || value.some((line) => typeof line !== "string")) {
    errors.push(`${at}${key} must be a list of text lines`);
    return [];
  }
  return value.map((line: string) => line.trim()).filter(Boolean);
}

function optNum(o: Obj, key: string, at: string, errors: string[]): number | undefined {
  const value = o[key];
  if (isBlank(value)) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${at}${key} must be a number (without quotes)`);
    return undefined;
  }
  return value;
}

function optDate(o: Obj, key: string, at: string, errors: string[]): Date | undefined {
  const value = optStr(o, key, at, errors);
  if (value === undefined) return undefined;
  const date = parseIsoDate(value);
  if (!date) errors.push(`${at}${key} must be a real date written as YYYY-MM-DD`);
  return date ?? undefined;
}

function list(o: Obj, key: string, at: string, errors: string[]): unknown[] {
  const value = o[key];
  if (isBlank(value)) return [];
  if (!Array.isArray(value)) {
    errors.push(`${at}${key} must be a list`);
    return [];
  }
  return value;
}

/* ---------- shared data files ---------- */

/** Bank account fields in print order, with their printed labels. */
export const BANK_FIELDS = [
  ["accountName", "Account name"],
  ["bankName", "Bank"],
  ["accountNumber", "Account number"],
  ["accountType", "Account type"],
  ["ifsc", "IFSC"],
  ["swift", "SWIFT/BIC"],
  ["branch", "Branch"],
  ["upi", "UPI ID"],
] as const;

/** A bank account as label/value rows; `details` adds rows of its own (IBAN, routing number…). */
function readBankAccount(value: Obj, at: string, errors: string[]): MetaRow[] {
  const rows: MetaRow[] = [];
  for (const [key, label] of BANK_FIELDS) {
    const text = optStr(value, key, at, errors);
    if (text) rows.push({ label, value: text });
  }
  list(value, "details", at, errors).forEach((entry, i) => {
    const where = `${at}details[${i}].`;
    if (!isObj(entry)) return errors.push(`${at}details[${i}] must be an object with label and value`);
    const label = optStr(entry, "label", where, errors) ?? "";
    const text = optStr(entry, "value", where, errors);
    if (text) rows.push({ label, value: text });
  });
  return rows;
}

/** Every field is optional; returns undefined when nothing is filled in, so the block is left out. */
function readParty(value: unknown, at: string, errors: string[]): Party | undefined {
  if (!isObj(value)) {
    errors.push(`${at.replace(/\.$/, "")} must be an object`);
    return undefined;
  }
  const taxIds: TaxId[] = [];
  list(value, "taxIds", at, errors).forEach((entry, i) => {
    const where = `${at}taxIds[${i}].`;
    if (!isObj(entry)) return errors.push(`${where.slice(0, -1)} must be an object`);
    const taxValue = optStr(entry, "value", where, errors);
    if (taxValue) taxIds.push({ type: optStr(entry, "type", where, errors), value: taxValue });
  });
  const party: Party = {
    name: optStr(value, "name", at, errors),
    address: strList(value, "address", at, errors),
    email: optStr(value, "email", at, errors),
    phone: optStr(value, "phone", at, errors),
    taxIds,
  };
  const empty = !party.name && !party.email && !party.phone && party.address.length + taxIds.length === 0;
  return empty ? undefined : party;
}

function readSettings(raw: unknown, errors: string[]): Settings {
  if (raw === undefined) return DEFAULT_SETTINGS;
  const at = "settings.json → ";
  if (!isObj(raw)) {
    errors.push("settings.json must be an object");
    return DEFAULT_SETTINGS;
  }
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    permissions: { ...DEFAULT_SETTINGS.permissions },
  };

  const locale = optStr(raw, "locale", at, errors);
  if (locale) {
    try {
      new Intl.NumberFormat(locale);
      settings.locale = locale;
    } catch {
      errors.push(`${at}locale "${locale}" is not a valid locale (e.g. "en-GB", "en-IN", "en-US")`);
    }
  }

  const currency = optStr(raw, "currency", at, errors);
  if (currency) {
    if (/^[A-Za-z]{3}$/.test(currency)) settings.currency = currency.toUpperCase();
    else errors.push(`${at}currency must be a 3-letter ISO code such as "USD" or "INR"`);
  }

  const pageSize = optStr(raw, "pageSize", at, errors);
  if (pageSize) {
    const upper = pageSize.toUpperCase();
    if (upper === "LETTER" || upper === "A4") settings.pageSize = upper;
    else errors.push(`${at}pageSize must be "LETTER" or "A4"`);
  }

  for (const key of ["accentColor", "accentColorEnd", "linkColor"] as const) {
    const color = optStr(raw, key, at, errors);
    if (!color) continue;
    if (/^#[0-9a-f]{6}$/i.test(color)) settings[key] = color;
    else errors.push(`${at}${key} must be a hex colour like "#635BFF"`);
  }

  if (raw.permissions !== undefined) {
    if (!isObj(raw.permissions)) {
      errors.push(`${at}permissions must be an object`);
    } else {
      for (const key of ["printing", "copying", "annotating"] as const) {
        const value = raw.permissions[key];
        if (value === undefined) continue;
        if (typeof value === "boolean") settings.permissions[key] = value;
        else errors.push(`${at}permissions.${key} must be true or false`);
      }
    }
  }
  return settings;
}

function readShared(data: DataSet, errors: string[]): Shared {
  const settings = readSettings(data.settings, errors);

  const seller = data.business === undefined ? undefined : readParty(data.business, "business.json → ", errors);
  let logo: string | undefined;
  const bankAccounts: Record<string, MetaRow[]> = {};
  if (isObj(data.business)) {
    logo = optStr(data.business, "logo", "business.json → ", errors);
    if (logo && !data.images.includes(logo)) {
      errors.push(`business.json → logo "${logo}" was not found in src/data (PNG or JPEG)`);
    }
    list(data.business, "bankAccounts", "business.json → ", errors).forEach((entry, i) => {
      const at = `business.json → bankAccounts[${i}].`;
      if (!isObj(entry)) return errors.push(`business.json → bankAccounts[${i}] must be an object`);
      const id = optStr(entry, "id", at, errors);
      if (!id) return errors.push(`${at}id is required, so invoices can refer to the account`);
      if (id in bankAccounts) return errors.push(`${at}id "${id}" is already used by another bank account`);
      bankAccounts[id] = readBankAccount(entry, at, errors);
    });
  }

  const customers: Record<string, Party> = {};
  if (data.customers !== undefined) {
    if (!isObj(data.customers)) errors.push("customers.json must be an object keyed by customer id");
    else
      for (const [id, value] of Object.entries(data.customers)) {
        const party = readParty(value, `customers.json → ${id}.`, errors);
        if (party) customers[id] = party;
      }
  }

  const taxes: Record<string, TaxRate> = {};
  if (data.taxes !== undefined) {
    if (!isObj(data.taxes)) errors.push("taxes.json must be an object keyed by tax id");
    else
      for (const [id, value] of Object.entries(data.taxes)) {
        const at = `taxes.json → ${id}.`;
        if (!isObj(value)) {
          errors.push(`taxes.json → ${id} must be an object`);
          continue;
        }
        const rate = optNum(value, "rate", at, errors);
        if (rate === undefined || rate < 0 || rate > 100) errors.push(`${at}rate must be a number from 0 to 100`);
        taxes[id] = {
          name: optStr(value, "name", at, errors) ?? "Tax",
          rate: rate ?? 0,
          note: optStr(value, "note", at, errors),
        };
      }
  }

  return { settings, seller, logo, customers, taxes, bankAccounts };
}

/* ---------- invoices ---------- */

function fileStem(file: string) {
  return file.replace(/^.*[\\/]/, "").replace(/\.json$/i, "");
}

function safeFileName(value: string) {
  return value.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "invoice";
}

const pdfName = (base: string, status: InvoiceStatus) => `${safeFileName(base)}${status === "draft" ? "-DRAFT" : ""}.pdf`;

/** An invoice read on its own, before the payments towards it are known. */
interface InvoiceCore {
  id: string;
  status: InvoiceStatus;
  number?: string;
  issueDate?: Date;
  dueDate?: Date;
  currency: string;
  fmt: Formatters;
  billTo?: Party;
  /** Tells customers apart: the id in customers.json, or the inline customer as JSON. */
  customerKey: string;
  totalMinor: number;
  /** Subtotal, taxes and total. */
  totals: TotalRow[];
  meta: MetaRow[];
  payUrl?: string;
  bankAccount?: MetaRow[];
  memo?: string;
  footer?: string;
  /** Parts of the invoice document that come straight from the invoice file. */
  common: Pick<
    ResolvedDocument,
    "status" | "settings" | "seller" | "logo" | "billTo" | "hasQuantityColumn" | "hasTaxColumn" | "items" | "footnotes"
  >;
}

function readInvoice(file: string, raw: unknown, shared: Shared, errors: string[]): InvoiceCore | undefined {
  if (!isObj(raw)) {
    errors.push("The file must contain a JSON object");
    return undefined;
  }
  const at = "";

  const statusText = optStr(raw, "status", at, errors) ?? "draft";
  if (statusText !== "draft" && statusText !== "final") errors.push(`status must be "draft" or "final"`);
  const status: InvoiceStatus = statusText === "final" ? "final" : "draft";

  // Apart from the line items and their prices, every field is optional: whatever is
  // missing is simply left off the invoice.
  const number = optStr(raw, "number", at, errors);

  const currency = (optStr(raw, "currency", at, errors) ?? shared.settings.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.push(`currency must be a 3-letter ISO code such as "USD" or "INR"`);
  const fmt = createFormatters(shared.settings.locale, /^[A-Z]{3}$/.test(currency) ? currency : "USD");

  const issueDate = optDate(raw, "issueDate", at, errors);
  const dueDate = optDate(raw, "dueDate", at, errors);
  if (issueDate && dueDate && dueDate < issueDate) errors.push("dueDate cannot be before issueDate");

  let billTo: Party | undefined;
  if (typeof raw.customer === "string") {
    billTo = shared.customers[raw.customer];
    if (!billTo) errors.push(`customer "${raw.customer}" is not defined in customers.json`);
  } else if (!isBlank(raw.customer)) {
    billTo = readParty(raw.customer, "customer.", errors);
  }
  const customerKey = typeof raw.customer === "string" ? `id:${raw.customer}` : JSON.stringify(billTo ?? null);

  const defaultTaxes = strList(raw, "taxes", at, errors);
  const rawItems = list(raw, "items", at, errors);
  if (rawItems.length === 0) errors.push("items must contain at least one line item");

  const calcItems = rawItems.map((entry, i) => {
    const where = `items[${i}].`;
    if (!isObj(entry)) {
      errors.push(`items[${i}] must be an object`);
      return undefined;
    }
    const description = optStr(entry, "description", where, errors);
    const details = strList(entry, "details", where, errors);
    if (entry.period !== undefined) {
      if (!isObj(entry.period)) {
        errors.push(`${where}period must be an object with start and/or end dates`);
      } else {
        const start = optDate(entry.period, "start", `${where}period.`, errors);
        const end = optDate(entry.period, "end", `${where}period.`, errors);
        const single = start ?? end;
        if (start && end) details.unshift(fmt.period(start, end));
        else if (single) details.unshift(fmt.shortDate(single));
      }
    }
    // A missing quantity counts as 1 but leaves the Qty cell empty.
    const shownQuantity = optNum(entry, "quantity", where, errors);
    const quantity = shownQuantity ?? 1;
    if (quantity <= 0) errors.push(`${where}quantity must be greater than 0`);
    const unitPrice = optNum(entry, "unitPrice", where, errors);
    if (unitPrice === undefined && isBlank(entry.unitPrice)) errors.push(`${where}unitPrice is required`);
    const taxIds = entry.taxes === undefined ? defaultTaxes : strList(entry, "taxes", where, errors);
    for (const id of taxIds) {
      if (!shared.taxes[id]) errors.push(`${where}taxes: "${id}" is not defined in taxes.json`);
    }
    const unitMinor = fmt.toMinor(unitPrice ?? 0);
    return {
      description: description ?? "",
      details,
      quantity: shownQuantity === undefined ? "" : fmt.number(quantity),
      unitMinor,
      amountMinor: Math.round(quantity * unitMinor),
      taxIds,
    };
  });

  // Custom fields follow the dates.
  const customFields: MetaRow[] = [];
  list(raw, "customFields", at, errors).forEach((entry, i) => {
    const where = `customFields[${i}].`;
    if (!isObj(entry)) return errors.push(`customFields[${i}] must be an object with label and value`);
    const label = optStr(entry, "label", where, errors) ?? "";
    const value = optStr(entry, "value", where, errors);
    if (value) customFields.push({ label, value });
  });
  const meta: MetaRow[] = [];
  if (number) meta.push({ label: "Invoice number", value: number, strong: true });
  if (issueDate) meta.push({ label: "Date of issue", value: fmt.date(issueDate) });
  if (dueDate) meta.push({ label: "Date due", value: fmt.date(dueDate) });
  meta.push(...customFields);

  const payUrl = optStr(raw, "payUrl", at, errors);
  if (payUrl && !/^https?:\/\/\S+$/i.test(payUrl)) errors.push("payUrl must start with https:// or http://");

  let bankAccount: MetaRow[] | undefined;
  if (typeof raw.bankAccount === "string" && raw.bankAccount) {
    bankAccount = shared.bankAccounts[raw.bankAccount];
    if (!bankAccount) errors.push(`bankAccount "${raw.bankAccount}" is not one of the bank accounts in business.json`);
  } else if (isObj(raw.bankAccount)) {
    bankAccount = readBankAccount(raw.bankAccount, "bankAccount.", errors);
  } else if (!isBlank(raw.bankAccount)) {
    errors.push("bankAccount must be the id of a bank account in business.json, or an object");
  }

  const memo = optStr(raw, "memo", at, errors);
  const footer = optStr(raw, "footer", at, errors);

  if (errors.length > 0) return undefined;

  // Group taxable amounts per tax rate and number the footnotes in order of first use.
  const groups = new Map<string, { tax: TaxRate; baseMinor: number }>();
  const noteNumbers = new Map<string, number>();
  const items: LineItem[] = calcItems.map((item) => {
    const it = item!;
    const notes = new Set<number>();
    for (const id of it.taxIds) {
      const tax = shared.taxes[id];
      const group = groups.get(id) ?? { tax, baseMinor: 0 };
      group.baseMinor += it.amountMinor;
      groups.set(id, group);
      if (tax.note) {
        if (!noteNumbers.has(tax.note)) noteNumbers.set(tax.note, noteNumbers.size + 1);
        notes.add(noteNumbers.get(tax.note)!);
      }
    }
    return {
      description: it.description,
      details: it.details,
      quantity: it.quantity,
      unitPrice: fmt.money(it.unitMinor),
      tax: it.taxIds.map((id) => fmt.percent(shared.taxes[id].rate)).join(", "),
      taxNotes: [...notes].sort((a, b) => a - b),
      amount: fmt.money(it.amountMinor),
    };
  });

  const subtotal = calcItems.reduce((sum, item) => sum + item!.amountMinor, 0);
  const totals: TotalRow[] = [{ label: "Subtotal", value: fmt.money(subtotal) }];
  let taxTotal = 0;
  for (const { tax, baseMinor } of groups.values()) {
    // Zero-rated taxes (reverse charge, exports) only show up as a footnote, like the reference.
    if (tax.rate === 0) continue;
    const taxMinor = Math.round((baseMinor * tax.rate) / 100);
    taxTotal += taxMinor;
    totals.push({
      label: `${tax.name} (${fmt.percent(tax.rate)} on ${fmt.money(baseMinor)})`,
      value: fmt.money(taxMinor),
    });
  }
  const totalMinor = subtotal + taxTotal;
  totals.push({ label: "Total", value: fmt.money(totalMinor) });

  return {
    id: fileStem(file),
    status,
    number,
    issueDate,
    dueDate,
    currency,
    fmt,
    billTo,
    customerKey,
    totalMinor,
    totals,
    meta,
    payUrl,
    bankAccount,
    memo,
    footer,
    common: {
      status,
      settings: shared.settings,
      seller: shared.seller,
      logo: shared.logo,
      billTo,
      hasQuantityColumn: items.some((item) => item.quantity),
      hasTaxColumn: groups.size > 0,
      items,
      footnotes: [...noteNumbers.entries()].map(([note, n]) => `[${n}] ${note}`),
    },
  };
}

/* ---------- payments ---------- */

/** A payment file read on its own, before the invoices it names are checked. */
interface PaymentCore {
  id: string;
  file: string;
  receiptNumber?: string;
  date?: Date;
  amount?: number;
  method?: string;
  details: string[];
  footer?: string;
  allocations: { invoice: string; amount: number }[];
  /** Payments towards an invoice are listed in this order: by date, then by file name. */
  sortKey: string;
}

function readPayment(file: string, raw: unknown, errors: string[]): PaymentCore | undefined {
  if (!isObj(raw)) {
    errors.push("The file must contain a JSON object");
    return undefined;
  }
  const at = "";
  const amount = optNum(raw, "amount", at, errors);
  if (amount === undefined && isBlank(raw.amount)) errors.push("amount is required");
  if (amount !== undefined && amount <= 0) errors.push("amount must be greater than 0");
  const date = optDate(raw, "date", at, errors);

  const rawAllocations = list(raw, "allocations", at, errors);
  if (rawAllocations.length === 0) errors.push("allocations must name at least one invoice this payment is for");
  const allocations: PaymentCore["allocations"] = [];
  rawAllocations.forEach((entry, i) => {
    const where = `allocations[${i}].`;
    if (!isObj(entry)) return errors.push(`allocations[${i}] must be an object with invoice and amount`);
    const invoice = optStr(entry, "invoice", where, errors);
    if (!invoice) errors.push(`${where}invoice is required`);
    else if (allocations.some((allocation) => allocation.invoice === invoice)) {
      errors.push(`${where}invoice "${invoice}" is listed more than once`);
    }
    const share = optNum(entry, "amount", where, errors);
    if (share === undefined && isBlank(entry.amount)) errors.push(`${where}amount is required`);
    if (share !== undefined && share <= 0) errors.push(`${where}amount must be greater than 0`);
    if (invoice && share !== undefined) allocations.push({ invoice, amount: share });
  });

  const id = fileStem(file);
  return {
    id,
    file,
    receiptNumber: optStr(raw, "receiptNumber", at, errors),
    date,
    amount,
    method: optStr(raw, "method", at, errors),
    details: strList(raw, "details", at, errors),
    footer: optStr(raw, "footer", at, errors),
    allocations,
    sortKey: `${date?.toISOString().slice(0, 10) ?? "9999-12-31"} ${id}`,
  };
}

/** Each invoice's payments in the order they were made, with the share each put towards it. */
type Histories = Map<string, { payment: PaymentCore; amountMinor: number }[]>;

/**
 * One receipt per payment: the amount and how it was paid, then each invoice it went towards with
 * what had been paid on it before and what is left after.
 */
function buildReceipt(payment: PaymentCore, invoices: InvoiceCore[], histories: Histories): ResolvedReceipt {
  const { fmt } = invoices[0];
  const amountMinor = fmt.toMinor(payment.amount!);
  const { receiptNumber, date } = payment;
  const status: InvoiceStatus = invoices.some((invoice) => invoice.status === "draft") ? "draft" : "final";

  const meta: MetaRow[] = [];
  if (receiptNumber) meta.push({ label: "Receipt number", value: receiptNumber, strong: true });
  if (date) meta.push({ label: "Date paid", value: fmt.date(date) });
  const allocations: AllocationRow[] = invoices.map((invoice) => {
    const history = histories.get(invoice.id)!;
    const at = history.findIndex((entry) => entry.payment === payment);
    const before = history.slice(0, at).reduce((sum, entry) => sum + entry.amountMinor, 0);
    const share = history[at].amountMinor;
    return {
      invoice: invoice.number ?? invoice.id,
      issueDate: invoice.issueDate ? fmt.shortDate(invoice.issueDate) : "",
      total: fmt.money(invoice.totalMinor),
      paidBefore: fmt.money(before),
      amount: fmt.money(share),
      balance: fmt.money(invoice.totalMinor - before - share),
    };
  });
  const { settings, seller, logo, billTo } = invoices[0].common;
  return {
    kind: "receipt",
    id: payment.id,
    file: payment.file,
    status,
    number: receiptNumber,
    fileName: pdfName(`Receipt-${receiptNumber ?? payment.id}`, status),
    settings,
    seller,
    logo,
    billTo,
    meta,
    headline: `${fmt.money(amountMinor)} paid${date ? ` on ${fmt.date(date)}` : ""}`,
    memo: [payment.method, ...payment.details].filter(Boolean).join(" · ") || undefined,
    hasQuantityColumn: false,
    hasTaxColumn: false,
    items: [],
    totals: [{ label: "Amount paid", value: fmt.money(amountMinor), strong: true }],
    allocations,
    footnotes: [],
    footer: payment.footer,
    summary: {
      amount: fmt.money(amountMinor),
      date: date && fmt.date(date),
      dateKey: date?.toISOString().slice(0, 10),
      sortKey: payment.sortKey,
      invoices: invoices.map((invoice) => invoice.id),
      currency: invoices[0].currency,
      value: fmt.fromMinor(amountMinor),
    },
  };
}

function buildInvoice(invoice: InvoiceCore, file: string, receipts: ResolvedReceipt[], paidMinor: number): ResolvedInvoice {
  const { fmt, totalMinor, number, issueDate, dueDate, status } = invoice;
  return {
    ...invoice.common,
    kind: "invoice",
    id: invoice.id,
    file,
    number,
    fileName: pdfName(`Invoice-${number ?? invoice.id}`, status),
    meta: invoice.meta,
    headline: dueDate ? `${fmt.money(totalMinor)} due ${fmt.date(dueDate)}` : `${fmt.money(totalMinor)} due`,
    payUrl: invoice.payUrl,
    bankAccount: invoice.bankAccount?.length ? invoice.bankAccount : undefined,
    memo: invoice.memo,
    totals: [...invoice.totals, { label: "Amount due", value: fmt.money(totalMinor), strong: true }],
    allocations: [],
    footer: invoice.footer,
    receipts,
    summary: {
      customer: invoice.billTo?.name,
      amountDue: fmt.money(totalMinor),
      issueDate: issueDate && fmt.date(issueDate),
      issueKey: issueDate?.toISOString().slice(0, 10),
      dueKey: dueDate?.toISOString().slice(0, 10),
      dueDate: dueDate && fmt.date(dueDate),
      sortKey: `${issueDate?.toISOString().slice(0, 10) ?? "0000-00-00"} ${number ?? invoice.id}`,
      payment: paidMinor === 0 ? "unpaid" : paidMinor < totalMinor ? "partial" : "paid",
      currency: invoice.currency,
      total: fmt.fromMinor(totalMinor),
      paid: fmt.fromMinor(paidMinor),
    },
  };
}

/* ---------- the whole folder ---------- */

/** Files whose `key` (an invoice or receipt number) is also used by another file. */
function clashes<T extends { file: string }>(items: T[], key: (item: T) => string | undefined) {
  const byKey = new Map<string, string[]>();
  for (const item of items) {
    const value = key(item);
    if (value) byKey.set(value, [...(byKey.get(value) ?? []), item.file]);
  }
  return (item: T) => {
    const value = key(item);
    const others = value ? byKey.get(value)!.filter((file) => file !== item.file) : [];
    return { value, others: others.map(fileStem) };
  };
}

/**
 * Validates the whole data folder and turns each invoice and payment file into something
 * renderable. An invoice is only valid when every payment towards it is, and a payment only when
 * every invoice it pays is: otherwise what an invoice shows as paid would be a guess.
 */
export function resolveAll(data: DataSet): Resolved {
  const sharedErrors: string[] = [];
  const shared = readShared(data, sharedErrors);

  const invoices = data.invoices.map(({ file, data: raw }) => {
    const errors = [...sharedErrors];
    const core = readInvoice(file, raw, shared, errors);
    const obj = isObj(raw) ? raw : {};
    return {
      id: fileStem(file),
      file,
      errors,
      core,
      customerId: typeof obj.customer === "string" ? obj.customer : undefined,
      status: core?.status ?? (obj.status === "final" ? "final" : "draft"),
      number: core ? core.number : typeof obj.number === "string" ? obj.number : undefined,
    };
  });
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const label = (invoice: (typeof invoices)[number]) => invoice.number ?? invoice.id;

  const payments = data.payments.map(({ file, data: raw }) => {
    const errors: string[] = [];
    const core = readPayment(file, raw, errors);
    const obj = isObj(raw) ? raw : {};
    // Read loosely, so a payment with errors still shows up on its invoices.
    const invoiceIds = (Array.isArray(obj.allocations) ? obj.allocations : [])
      .map((entry) => (isObj(entry) && typeof entry.invoice === "string" ? entry.invoice.trim() : ""))
      .filter(Boolean);
    const receiptNumber = typeof obj.receiptNumber === "string" ? obj.receiptNumber.trim() || undefined : undefined;
    return { id: fileStem(file), file, errors, core, invoiceIds, receiptNumber };
  });

  // Invoice numbers and receipt numbers must be unique across the folder.
  const invoiceClash = clashes(invoices, (invoice) => invoice.number);
  for (const invoice of invoices) {
    const { value, others } = invoiceClash(invoice);
    if (others.length > 0) invoice.errors.push(`Invoice number "${value}" is also used by ${others.join(", ")}`);
  }
  const receiptClash = clashes(payments, (payment) => payment.receiptNumber);
  for (const payment of payments) {
    const { value, others } = receiptClash(payment);
    if (others.length > 0) payment.errors.push(`Receipt number "${value}" is also used by ${others.join(", ")}`);
  }

  // Each payment against the invoices it names.
  for (const payment of payments) {
    const { core } = payment;
    if (!core) continue;
    const targets = core.allocations.map(({ invoice }, i) => {
      const target = invoiceById.get(invoice);
      if (!target) payment.errors.push(`allocations[${i}].invoice: there is no invoice ${invoice} in the invoices folder`);
      return target?.core;
    });
    const known = targets.filter((target) => target !== undefined);
    if (new Set(known.map((target) => target.customerKey)).size > 1) {
      payment.errors.push("allocations must all be invoices billed to the same customer");
    }
    if (new Set(known.map((target) => target.currency)).size > 1) {
      payment.errors.push("allocations must all be invoices in the same currency");
    }
    if (payment.errors.length === 0 && known.length === targets.length && core.amount !== undefined) {
      const { fmt } = known[0];
      const allocated = core.allocations.reduce((sum, allocation) => sum + fmt.toMinor(allocation.amount), 0);
      if (allocated !== fmt.toMinor(core.amount)) {
        payment.errors.push(
          `the allocations add up to ${fmt.money(allocated)}, but the amount received is ${fmt.money(fmt.toMinor(core.amount))}`,
        );
      }
    }
  }

  // No invoice may be paid more than its total.
  for (const invoice of invoices) {
    if (!invoice.core) continue;
    const { fmt, totalMinor } = invoice.core;
    const paidMinor = payments
      .flatMap((payment) => payment.core?.allocations ?? [])
      .filter((allocation) => allocation.invoice === invoice.id)
      .reduce((sum, allocation) => sum + fmt.toMinor(allocation.amount), 0);
    if (paidMinor > totalMinor) {
      invoice.errors.push(`payments add up to ${fmt.money(paidMinor)}, more than the invoice total of ${fmt.money(totalMinor)}`);
    }
  }

  // A problem on either side makes the other unusable too, until nothing changes.
  for (let changed = true; changed; ) {
    changed = false;
    for (const payment of payments) {
      if (payment.errors.length > 0) continue;
      for (const id of payment.invoiceIds) {
        const invoice = invoiceById.get(id)!;
        if (invoice.errors.length === 0) continue;
        payment.errors.push(`${label(invoice)} can't be generated: ${invoice.errors.join("; ")}`);
        changed = true;
      }
    }
    for (const invoice of invoices) {
      if (invoice.errors.length > 0) continue;
      for (const payment of payments) {
        if (payment.errors.length === 0 || !payment.invoiceIds.includes(invoice.id)) continue;
        invoice.errors.push(`Payment ${payment.receiptNumber ?? payment.id} has problems; fix ${payment.file}`);
        changed = true;
      }
    }
  }

  // From here on, every payment without errors pays only invoices without errors, and the other way round.
  const valid = payments
    .filter((payment) => payment.errors.length === 0)
    .map((payment) => payment.core!)
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const histories: Histories = new Map();
  for (const payment of valid) {
    for (const allocation of payment.allocations) {
      const { fmt } = invoiceById.get(allocation.invoice)!.core!;
      const history = histories.get(allocation.invoice) ?? [];
      history.push({ payment, amountMinor: fmt.toMinor(allocation.amount) });
      histories.set(allocation.invoice, history);
    }
  }
  const receipts = new Map(
    valid.map((payment) => [
      payment.id,
      buildReceipt(
        payment,
        payment.allocations.map((allocation) => invoiceById.get(allocation.invoice)!.core!),
        histories,
      ),
    ]),
  );

  return {
    invoices: invoices.map(({ id, file, errors, core, customerId, status, number }): InvoiceEntry => {
      if (errors.length > 0 || !core) return { id, file, customerId, ok: false, errors, status, number };
      const history = histories.get(id) ?? [];
      const paidMinor = history.reduce((sum, entry) => sum + entry.amountMinor, 0);
      const invoice = buildInvoice(
        core,
        file,
        history.map((entry) => receipts.get(entry.payment.id)!),
        paidMinor,
      );
      return { id, file, customerId, ok: true, invoice };
    }),
    payments: payments.map(({ id, file, errors, invoiceIds, receiptNumber }): PaymentEntry => {
      const customerId = invoiceById.get(invoiceIds[0] ?? "")?.customerId;
      const receipt = receipts.get(id);
      if (errors.length > 0 || !receipt) return { id, file, invoiceIds, customerId, ok: false, errors, receiptNumber };
      return { id, file, invoiceIds, customerId, ok: true, receipt };
    }),
  };
}
