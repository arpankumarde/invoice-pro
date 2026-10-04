import { createFormatters, parseIsoDate } from "./format.ts";
import type {
  DataSet,
  InvoiceEntry,
  InvoiceStatus,
  LineItem,
  MetaRow,
  Party,
  PaymentRow,
  ResolvedDocument,
  ResolvedInvoice,
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

function resolveInvoice(file: string, raw: unknown, shared: Shared, errors: string[]): ResolvedInvoice | undefined {
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

  // Custom fields follow the dates, on the invoice and on its receipts.
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
  const receiptFooter = optStr(raw, "receiptFooter", at, errors);

  // Each payment gets a receipt, which lists the payments up to and including it. So the list
  // has to be in the order the payments were made.
  let lastPaid: Date | undefined;
  const payments = list(raw, "payments", at, errors).map((entry, i) => {
    const where = `payments[${i}].`;
    if (!isObj(entry)) {
      errors.push(`payments[${i}] must be an object`);
      return undefined;
    }
    const amount = optNum(entry, "amount", where, errors);
    if (amount === undefined && isBlank(entry.amount)) errors.push(`${where}amount is required`);
    if (amount !== undefined && amount <= 0) errors.push(`${where}amount must be greater than 0`);
    const date = optDate(entry, "date", where, errors);
    if (date && lastPaid && date < lastPaid) {
      errors.push(`${where}date is before the payment above it; list payments in the order they were made`);
    }
    lastPaid = date ?? lastPaid;
    return {
      receiptNumber: optStr(entry, "receiptNumber", where, errors),
      date,
      amountMinor: fmt.toMinor(amount ?? 0),
      method: optStr(entry, "method", where, errors),
      details: strList(entry, "details", where, errors),
    };
  });

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
  const total = subtotal + taxTotal;
  totals.push({ label: "Total", value: fmt.money(total) });

  const paidMinor = payments.reduce((sum, payment) => sum + (payment?.amountMinor ?? 0), 0);
  if (paidMinor > total) {
    errors.push(`payments add up to ${fmt.money(paidMinor)}, more than the invoice total of ${fmt.money(total)}`);
    return undefined;
  }

  const id = fileStem(file);
  const pdfName = (base: string) => `${safeFileName(base)}${status === "draft" ? "-DRAFT" : ""}.pdf`;

  // Parts an invoice shares with its receipts.
  const common = {
    file,
    status,
    settings: shared.settings,
    seller: shared.seller,
    logo: shared.logo,
    billTo,
    hasQuantityColumn: items.some((item) => item.quantity),
    hasTaxColumn: groups.size > 0,
    items,
    footnotes: [...noteNumbers.entries()].map(([note, n]) => `[${n}] ${note}`),
  };

  // With no errors recorded, every payment was read.
  const made = payments.map((payment) => payment!);
  const history: PaymentRow[] = made.map((payment) => ({
    method: payment.method ?? "",
    details: payment.details,
    date: payment.date ? fmt.date(payment.date) : "",
    amount: fmt.money(payment.amountMinor),
    receiptNumber: payment.receiptNumber ?? "",
  }));
  let paidSoFar = 0;
  const receipts = made.map(({ receiptNumber, date, amountMinor }, i): ResolvedDocument => {
    paidSoFar += amountMinor;
    const receiptMeta: MetaRow[] = [];
    if (number) receiptMeta.push({ label: "Invoice number", value: number, strong: true });
    if (receiptNumber) receiptMeta.push({ label: "Receipt number", value: receiptNumber });
    if (date) receiptMeta.push({ label: "Date paid", value: fmt.date(date) });
    receiptMeta.push(...customFields);
    const receiptTotals: TotalRow[] = [...totals, { label: "Amount paid", value: fmt.money(paidSoFar), strong: true }];
    if (paidSoFar < total) receiptTotals.push({ label: "Amount remaining", value: fmt.money(total - paidSoFar) });
    return {
      ...common,
      kind: "receipt",
      id: `${id}/receipt-${i + 1}`,
      number: receiptNumber,
      fileName: pdfName(`Receipt-${receiptNumber ?? `${number ?? id}-${i + 1}`}`),
      meta: receiptMeta,
      headline: `${fmt.money(amountMinor)} paid${date ? ` on ${fmt.date(date)}` : ""}`,
      totals: receiptTotals,
      payments: history.slice(0, i + 1),
      footer: receiptFooter,
    };
  });

  return {
    ...common,
    kind: "invoice",
    id,
    number,
    fileName: pdfName(`Invoice-${number ?? id}`),
    meta,
    headline: dueDate ? `${fmt.money(total)} due ${fmt.date(dueDate)}` : `${fmt.money(total)} due`,
    payUrl,
    bankAccount: bankAccount?.length ? bankAccount : undefined,
    memo,
    totals: [...totals, { label: "Amount due", value: fmt.money(total), strong: true }],
    payments: [],
    footer,
    receipts,
    summary: {
      customer: billTo?.name,
      amountDue: fmt.money(total),
      issueDate: issueDate && fmt.date(issueDate),
      sortKey: `${issueDate?.toISOString().slice(0, 10) ?? "0000-00-00"} ${number ?? id}`,
      payment: paidMinor === 0 ? "unpaid" : paidMinor < total ? "partial" : "paid",
      total: fmt.fromMinor(total),
    },
  };
}

/** Validates the whole data folder and turns each invoice file into something renderable. */
export function resolveAll(data: DataSet): InvoiceEntry[] {
  const sharedErrors: string[] = [];
  const shared = readShared(data, sharedErrors);

  const entries: InvoiceEntry[] = data.invoices.map(({ file, data: raw }) => {
    const id = fileStem(file);
    const errors = [...sharedErrors];
    const invoice = resolveInvoice(file, raw, shared, errors);
    if (invoice && errors.length === 0) return { id, file, ok: true, invoice };
    const obj = isObj(raw) ? raw : {};
    return {
      id,
      file,
      ok: false,
      errors,
      status: obj.status === "final" ? "final" : "draft",
      number: typeof obj.number === "string" ? obj.number : undefined,
    };
  });

  // Invoice numbers and receipt numbers must be unique across the folder. Receipt numbers are
  // read from the raw files, so a clash is reported even on an invoice with other errors.
  const byNumber = new Map<string, string[]>();
  for (const entry of entries) {
    const number = entry.ok ? entry.invoice.number : entry.number;
    if (number) byNumber.set(number, [...(byNumber.get(number) ?? []), entry.file]);
  }
  const receiptNumbers = data.invoices.map(({ data: raw }) =>
    (isObj(raw) && Array.isArray(raw.payments) ? raw.payments : [])
      .map((payment) => (isObj(payment) && typeof payment.receiptNumber === "string" ? payment.receiptNumber.trim() : ""))
      .filter(Boolean),
  );
  const byReceipt = new Map<string, string[]>();
  data.invoices.forEach(({ file }, i) => {
    for (const receipt of receiptNumbers[i]) byReceipt.set(receipt, [...(byReceipt.get(receipt) ?? []), file]);
  });

  return entries.map((entry, i) => {
    const messages: string[] = [];
    const number = entry.ok ? entry.invoice.number : entry.number;
    const clashes = number ? byNumber.get(number)!.filter((f) => f !== entry.file) : [];
    if (clashes.length > 0) messages.push(`Invoice number "${number}" is also used by ${clashes.map(fileStem).join(", ")}`);
    for (const receipt of new Set(receiptNumbers[i])) {
      const files = byReceipt.get(receipt)!;
      const others = [...new Set(files.filter((f) => f !== entry.file))];
      if (others.length > 0) {
        messages.push(`Receipt number "${receipt}" is also used by ${others.map(fileStem).join(", ")}`);
      } else if (files.length > 1) {
        messages.push(`Receipt number "${receipt}" is used by more than one payment`);
      }
    }
    if (messages.length === 0) return entry;
    return entry.ok
      ? { id: entry.id, file: entry.file, ok: false, errors: messages, status: entry.invoice.status, number }
      : { ...entry, errors: [...entry.errors, ...messages] };
  });
}
