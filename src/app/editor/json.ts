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
  ],
  items: ["description", "details", "period", "quantity", "unitPrice", "taxes"],
  payment: ["receiptNumber", "date", "amount", "method", "details", "allocations", "footer"],
  allocations: ["invoice", "amount"],
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
const NAMED_CHILDREN = new Set(["invoice", "payment", "items", "party", "settings", "bankAccounts", "bankAccount"]);

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

const DAY = 86_400_000;
const parseDay = (value: unknown) => {
  const day = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : undefined;
  return day && !Number.isNaN(day.getTime()) ? day : undefined;
};
const formatDay = (day: Date) => day.toISOString().slice(0, 10);
const monthLength = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** The same day next month; a last-of-the-month date stays the last day (30 Apr → 31 May), others are clamped (31 Jan → 28 Feb). */
function plusMonth(day: Date) {
  const [year, month, date] = [day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()];
  const lastDay = date === monthLength(year, month);
  const length = monthLength(year, month + 1);
  return new Date(Date.UTC(year, month + 1, lastDay ? length : Math.min(date, length)));
}

/**
 * The next month's invoice from `source`, as a draft: same customer, items, taxes and other fields, with each
 * item's period moved forward a month, issued on the 1st of the month after the new period (invoices are
 * postpaid), due 15 days later, under the next free number for that month. A quantity that was the number
 * of days in the old period (e.g. 31 days of hosting) follows the new period's length.
 */
export function duplicateInvoice(source: Obj, numbers: string[]): Obj {
  const copy = structuredClone(source);
  let periodEnd: Date | undefined;
  copy.items = asList(copy.items).map((item) => {
    if (!isObj(item) || !isObj(item.period)) return item;
    const start = parseDay(item.period.start);
    const end = parseDay(item.period.end);
    const period = { ...item.period };
    const next = { start: start && plusMonth(start), end: end && plusMonth(end) };
    if (next.start) period.start = formatDay(next.start);
    if (next.end) period.end = formatDay(next.end);
    if (next.end && (!periodEnd || next.end > periodEnd)) periodEnd = next.end;
    const quantity =
      start && end && next.start && next.end && item.quantity === Math.round((end.getTime() - start.getTime()) / DAY) + 1
        ? Math.round((next.end.getTime() - next.start.getTime()) / DAY) + 1
        : item.quantity;
    return { ...item, period, ...(quantity === undefined ? {} : { quantity }) };
  });

  const base = periodEnd ?? parseDay(copy.issueDate) ?? new Date();
  const issue = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1));
  const due = new Date(issue.getTime() + 15 * DAY);
  return {
    ...copy,
    status: "draft",
    number: nextNumber("INV", numbers, new Date(issue.getUTCFullYear(), issue.getUTCMonth(), 1)),
    issueDate: formatDay(issue),
    dueDate: formatDay(due),
  };
}

type Files = { file: string; data: unknown }[];

/** Rounds away floating-point noise such as 0.30000000000000004. */
export const roundMoney = (value: number) => Number(value.toFixed(6));

/** Every receipt number in use, except by the payment in `exceptFile`, so a new payment gets the next free one. */
export const receiptNumbersOutside = (payments: Files, exceptFile?: string) =>
  payments
    .filter((payment) => payment.file !== exceptFile)
    .map((payment) => text(asObj(payment.data).receiptNumber))
    .filter(Boolean);

/** How much each invoice (by id) has been paid by every payment except the one in `exceptFile`. */
export function paidOutside(payments: Files, exceptFile?: string) {
  const paid = new Map<string, number>();
  for (const payment of payments) {
    if (payment.file === exceptFile) continue;
    for (const allocation of asList(asObj(payment.data).allocations).map(asObj)) {
      const invoice = text(allocation.invoice);
      if (invoice && typeof allocation.amount === "number") {
        paid.set(invoice, roundMoney((paid.get(invoice) ?? 0) + allocation.amount));
      }
    }
  }
  return paid;
}

/** Spreads `amount` over the invoices in the order given, each getting up to what it still owes. */
export function fillInOrder(amount: number, invoices: { id: string; owed: number }[]) {
  const shares = new Map<string, number>();
  let left = amount;
  for (const { id, owed } of invoices) {
    const share = roundMoney(Math.min(left, owed));
    if (share <= 0) continue;
    shares.set(id, share);
    left = roundMoney(left - share);
  }
  return shares;
}

/** A payment to record: dated today, with the next receipt number. */
export function newPayment(receiptNumbers: string[], method?: string): Obj {
  return { receiptNumber: nextNumber("RCT", receiptNumbers), date: today(), ...(method ? { method } : {}) };
}

export const slug = (value: string) =>
  value
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
