import { createFormatters } from "../invoice/format.ts";
import type { InvoiceEntry } from "../invoice/types.ts";
import type { Snapshot } from "./data.ts";
import { asList, asObj, text } from "./editor/json.ts";
import { entryStatus } from "./entries.ts";

/** Totals in one currency, over the final invoices only: drafts haven't been sent. */
export interface Balance {
  currency: string;
  invoiced: string;
  paid: string;
  outstanding: string;
  /** Something is still owed. */
  due: boolean;
}

export interface CustomerSummary {
  /** The key in customers.json. */
  id: string;
  name?: string;
  /** False when invoices name this id but customers.json doesn't define it. */
  defined: boolean;
  /** The customer's invoices, latest first. */
  entries: InvoiceEntry[];
  balances: Balance[];
}

/** Every customer in customers.json, then any id that only invoices mention, each with its invoices. */
export function customerSummaries(snapshot: Snapshot, entries: InvoiceEntry[]): CustomerSummary[] {
  const defined = asObj(snapshot.raw.customers);
  const ids = [...Object.keys(defined)];
  for (const entry of entries) {
    if (entry.customerId && !ids.includes(entry.customerId)) ids.push(entry.customerId);
  }
  return ids.map((id) => {
    const name = text(asObj(defined[id]).name) || undefined;
    const own = entries.filter((entry) => entry.customerId === id);
    return { id, name, defined: id in defined, entries: own, balances: balancesOf(own) };
  });
}

function balancesOf(entries: InvoiceEntry[]): Balance[] {
  const byCurrency = new Map<string, { locale: string; invoiced: number; paid: number }>();
  for (const entry of entries) {
    if (!entry.ok || entryStatus(entry) !== "final") continue;
    const { settings, summary } = entry.invoice;
    const fmt = createFormatters(settings.locale, summary.currency);
    const sum = byCurrency.get(summary.currency) ?? { locale: settings.locale, invoiced: 0, paid: 0 };
    // Summed in minor units so the totals never drift.
    sum.invoiced += fmt.toMinor(summary.total);
    sum.paid += fmt.toMinor(summary.paid);
    byCurrency.set(summary.currency, sum);
  }
  return [...byCurrency].map(([currency, { locale, invoiced, paid }]) => {
    const fmt = createFormatters(locale, currency);
    return {
      currency,
      invoiced: fmt.money(invoiced),
      paid: fmt.money(paid),
      outstanding: fmt.money(invoiced - paid),
      due: invoiced > paid,
    };
  });
}

/** The contact details in customers.json, read loosely so a half-edited record still shows. */
export function customerDetails(snapshot: Snapshot, id: string) {
  const raw = asObj(asObj(snapshot.raw.customers)[id]);
  return {
    address: asList(raw.address).map(text).filter(Boolean),
    email: text(raw.email) || undefined,
    phone: text(raw.phone) || undefined,
    taxIds: asList(raw.taxIds)
      .map((taxId) => ({ type: text(asObj(taxId).type), value: text(asObj(taxId).value) }))
      .filter((taxId) => taxId.value),
  };
}
