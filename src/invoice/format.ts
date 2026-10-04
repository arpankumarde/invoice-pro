/** Parses a strict YYYY-MM-DD string as a UTC calendar date. */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Reject rollovers such as 2026-02-31.
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

export type Formatters = ReturnType<typeof createFormatters>;

/**
 * Money is handled in integer minor units (cents, paise) so totals never drift.
 * With the default en-GB locale this reproduces the reference styling:
 * "US$25.00", "30 August 2026", "30 Aug–30 Sept 2026".
 */
export function createFormatters(locale: string, currency: string) {
  const money = new Intl.NumberFormat(locale, { style: "currency", currency });
  const factor = 10 ** (money.resolvedOptions().maximumFractionDigits ?? 2);
  const longDate = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const shortDate = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const shortDateYear = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const plain = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 });

  return {
    toMinor: (amount: number) => Math.round(amount * factor),
    fromMinor: (minor: number) => minor / factor,
    money: (minor: number) => money.format(minor / factor),
    date: (date: Date) => longDate.format(date),
    shortDate: (date: Date) => shortDateYear.format(date),
    period: (start: Date, end: Date) =>
      start.getUTCFullYear() === end.getUTCFullYear()
        ? `${shortDate.format(start)}–${shortDateYear.format(end)}`
        : `${shortDateYear.format(start)}–${shortDateYear.format(end)}`,
    number: (value: number) => plain.format(value),
    percent: (rate: number) => `${plain.format(rate)}%`,
  };
}
