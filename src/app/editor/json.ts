export type Obj = Record<string, unknown>;

export const isObj = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Readers for loosely typed JSON values. */
export const text = (value: unknown) =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
export const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const asObj = (value: unknown): Obj => (isObj(value) ? value : {});

/** Returns a copy with `key` set, or removed when the value is empty, so blank fields stay out of the JSON. */
export function setKey(obj: Obj, key: string, value: unknown): Obj {
  const next = { ...obj };
  if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) delete next[key];
  else next[key] = value;
  return next;
}

const BANK_ORDER = ["accountName", "bankName", "accountNumber", "accountType", "ifsc", "swift", "branch", "upi", "details"];

const KEY_ORDER: Record<string, string[]> = {
  invoice: [
    "status",
    "number",
    "issueDate",
    "dueDate",
    "currency",
    "customer",
    "customFields",
    "taxes",
    "items",
    "payUrl",
    "bankAccount",
    "memo",
    "footer",
    "payments",
    "receiptFooter",
  ],
  items: ["description", "details", "period", "quantity", "unitPrice", "taxes"],
  payments: ["receiptNumber", "date", "amount", "method", "details"],
  party: ["name", "address", "email", "phone", "taxIds", "logo", "bankAccounts"],
  bankAccounts: ["id", ...BANK_ORDER],
  bankAccount: BANK_ORDER,
  details: ["label", "value"],
  settings: ["locale", "currency", "pageSize", "accentColor", "accentColorEnd", "linkColor", "permissions"],
  permissions: ["printing", "copying", "annotating"],
  period: ["start", "end"],
  taxIds: ["type", "value"],
  customFields: ["label", "value"],
};

/** Objects whose children are named by their key; in any other object the children share its context. */
const NAMED_CHILDREN = new Set(["invoice", "items", "party", "settings", "bankAccounts", "bankAccount"]);

function sortKeys(obj: Obj, order: string[] | undefined): Obj {
  if (!order) return obj;
  const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => rank(a) - rank(b)));
}

/**
 * Trims text and drops empty values, so whatever is left blank in the form is simply missing
 * from the JSON (and therefore from the invoice). An item's `"taxes": []` is kept: it means
 * "no tax on this line" rather than "use the invoice default".
 */
export function tidy(value: unknown, context = "invoice"): unknown {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    const list = value.map((entry) => tidy(entry, context)).filter((entry) => entry !== undefined);
    return list.length > 0 || context === "taxes" ? list : undefined;
  }
  if (isObj(value)) {
    const out: Obj = {};
    for (const [key, entry] of Object.entries(value)) {
      const child = NAMED_CHILDREN.has(context) ? key : context;
      const cleaned = tidy(entry, key === "customer" && isObj(entry) ? "party" : child);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return Object.keys(out).length > 0 ? sortKeys(out, KEY_ORDER[context]) : undefined;
  }
  return value === null ? undefined : value;
}

export const toJson = (value: unknown) => `${JSON.stringify(value ?? {}, null, 2)}\n`;

/**
 * Invoice numbers look like INV-2026-10-0001 and receipt numbers like RCT-2026-10-0001: the year
 * and month the invoice is issued or the payment recorded, then a count within that month. New
 * invoices and payments are dated today.
 */
export function nextNumber(kind: "INV" | "RCT", numbers: string[], now = new Date()): string {
  const prefix = `${kind}-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-`;
  const used = numbers.filter((n) => n.startsWith(prefix)).map((n) => Number(n.slice(prefix.length)) || 0);
  return prefix + String(Math.max(0, ...used) + 1).padStart(4, "0");
}

export function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Receipt numbers used by every invoice except `file`, so a new payment gets the next free one. */
export const receiptNumbersOutside = (invoices: { file: string; data: unknown }[], file?: string) =>
  invoices
    .filter((inv) => inv.file !== file)
    .flatMap((inv) => asList(asObj(inv.data).payments).map((payment) => text(asObj(payment).receiptNumber)))
    .filter(Boolean);

/** What is still owed on an invoice of `total` after the payments in its JSON. */
export function amountRemaining(invoice: Obj, total: number) {
  const paid = asList(invoice.payments)
    .map(asObj)
    .reduce((sum, payment) => sum + (typeof payment.amount === "number" ? payment.amount : 0), 0);
  // toFixed drops floating-point noise such as 0.30000000000000004.
  return Number((total - paid).toFixed(6));
}

/**
 * A payment to add to `invoice`: dated today, with the next receipt number, the amount still owed
 * (when the total is known) and the last payment's method.
 */
export function newPayment(invoice: Obj, { total, receiptNumbers }: { total?: number; receiptNumbers: string[] }): Obj {
  const payments = asList(invoice.payments).map(asObj);
  const remaining = total === undefined ? 0 : amountRemaining(invoice, total);
  const method = text(payments.at(-1)?.method) || (invoice.bankAccount ? "Bank transfer" : "");
  const payment: Obj = {
    receiptNumber: nextNumber("RCT", [...receiptNumbers, ...payments.map((p) => text(p.receiptNumber))]),
    date: today(),
  };
  if (remaining > 0) payment.amount = remaining;
  if (method) payment.method = method;
  return payment;
}

export const slug = (value: string) =>
  value
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
