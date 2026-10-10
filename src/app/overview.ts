import { createFormatters } from "../invoice/format.ts";
import type { InvoiceEntry, PaymentEntry, ResolvedInvoice, ResolvedReceipt } from "../invoice/types.ts";
import { entryStatus } from "./entries.ts";

/** One amount per currency, summed in minor units so the totals never drift. */
export interface CurrencyTotal {
  currency: string;
  /** Formatted for display. */
  text: string;
  /** In minor units, for comparing and sorting. */
  minor: number;
}

export interface OverdueInvoice {
  id: string;
  invoice: ResolvedInvoice;
  customerId?: string;
  outstanding: string;
  daysLate: number;
}

export interface RecentPayment {
  id: string;
  receipt: ResolvedReceipt;
}

export interface Overview {
  /** Still owed on final invoices, by currency. */
  outstanding: CurrencyTotal[];
  /** Final invoices past their due date with something left to pay, the longest overdue first. */
  overdue: OverdueInvoice[];
  overdueTotals: CurrencyTotal[];
  /** Final invoices issued this month. */
  billed: CurrencyTotal[];
  /** Payments dated this month. */
  received: CurrencyTotal[];
  /** The newest payments first. */
  recentPayments: RecentPayment[];
  drafts: number;
}

/** Today as YYYY-MM-DD in the viewer's time zone, the same form the invoice files use. */
export function todayKey(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/** What is still owed on an invoice, in minor units. Drafts haven't been sent, so they owe nothing. */
export function owedMinor(entry: InvoiceEntry) {
  if (!entry.ok || entry.invoice.status !== "final") return 0;
  const { settings, summary } = entry.invoice;
  const fmt = createFormatters(settings.locale, summary.currency);
  return fmt.toMinor(summary.total) - fmt.toMinor(summary.paid);
}

/** A final invoice past its due date with something left to pay. `today` is YYYY-MM-DD. */
export function isOverdue(entry: InvoiceEntry, today: string) {
  const dueKey = entry.ok ? entry.invoice.summary.dueKey : undefined;
  return !!dueKey && dueKey < today && owedMinor(entry) > 0;
}

class Totals {
  private readonly sums = new Map<string, { locale: string; minor: number }>();

  add(locale: string, currency: string, amount: number) {
    const fmt = createFormatters(locale, currency);
    const sum = this.sums.get(currency) ?? { locale, minor: 0 };
    sum.minor += fmt.toMinor(amount);
    this.sums.set(currency, sum);
  }

  /** Currencies in alphabetical order, so the cards don't shuffle as the data changes. */
  list(): CurrencyTotal[] {
    return [...this.sums]
      .map(([currency, { locale, minor }]) => ({ currency, minor, text: createFormatters(locale, currency).money(minor) }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }
}

/** The figures on the overview page. `today` is YYYY-MM-DD; this month is the one it falls in. */
export function overview(entries: InvoiceEntry[], payments: PaymentEntry[], today: string): Overview {
  const month = today.slice(0, 7);
  const outstanding = new Totals();
  const overdueTotals = new Totals();
  const billed = new Totals();
  const received = new Totals();
  const overdue: OverdueInvoice[] = [];
  let drafts = 0;

  for (const entry of entries) {
    if (entryStatus(entry) === "draft") drafts++;
    // Drafts haven't been sent, so they are neither owed nor billed.
    if (!entry.ok || entry.invoice.status !== "final") continue;
    const { invoice } = entry;
    const { locale } = invoice.settings;
    const { currency, total, issueKey, dueKey } = invoice.summary;
    const fmt = createFormatters(locale, currency);
    const owed = owedMinor(entry);

    if (issueKey?.startsWith(month)) billed.add(locale, currency, total);
    if (owed <= 0) continue;
    outstanding.add(locale, currency, fmt.fromMinor(owed));
    if (dueKey && dueKey < today) {
      overdueTotals.add(locale, currency, fmt.fromMinor(owed));
      overdue.push({
        id: entry.id,
        invoice,
        customerId: entry.customerId,
        outstanding: fmt.money(owed),
        daysLate: daysBetween(dueKey, today),
      });
    }
  }
  overdue.sort((a, b) => b.daysLate - a.daysLate || a.id.localeCompare(b.id));

  const receipts: RecentPayment[] = [];
  for (const payment of payments) {
    if (!payment.ok) continue;
    const { receipt } = payment;
    receipts.push({ id: payment.id, receipt });
    const { dateKey, currency, value } = receipt.summary;
    if (dateKey?.startsWith(month)) received.add(receipt.settings.locale, currency, value);
  }
  // Undated payments sort last: they can't be placed in time.
  const dateOf = ({ receipt }: RecentPayment) => receipt.summary.dateKey ?? "";
  receipts.sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || b.id.localeCompare(a.id));

  return {
    outstanding: outstanding.list(),
    overdue,
    overdueTotals: overdueTotals.list(),
    billed: billed.list(),
    received: received.list(),
    recentPayments: receipts.slice(0, 6),
    drafts,
  };
}
