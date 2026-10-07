import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { deleteFile, saveFile } from "../app/api.ts";
import { latestSnapshot, refresh, type Snapshot } from "../app/data.ts";
import { Field, LinesInput, NumberInput, TextInput } from "../app/editor/fields.tsx";
import {
  asList,
  asObj,
  fillInOrder,
  newPayment,
  type Obj,
  receiptNumbersOutside,
  roundMoney,
  setKey,
  slug,
  text,
  tidy,
  toJson,
} from "../app/editor/json.ts";
import { entryStatus, entryTitle, joinParts, sortKey } from "../app/entries.ts";
import { Errors, primaryButton, secondaryButton, StatusBadge, TrashIcon } from "../app/ui.tsx";
import { createFormatters } from "../invoice/format.ts";
import { resolveAll } from "../invoice/resolve.ts";
import type { DataSet } from "../invoice/types.ts";

/** An invoice the payment can go towards, as it stands without this payment. */
interface Candidate {
  id: string;
  title: string;
  issueDate?: string;
  draft: boolean;
  /** What is still owed; undefined when the invoice has errors of its own or doesn't exist. */
  owed?: number;
  missing?: boolean;
  money?: (amount: number) => string;
}

const fileStem = (file: string) => file.slice(file.lastIndexOf("/") + 1).replace(/\.json$/, "");

/**
 * One payment received: when, how, and how much of it goes to each of the customer's invoices.
 * Nothing is written until the result passes the same checks as the rest of the app.
 */
export function PaymentDialog({
  snapshot,
  file,
  customerId,
  invoiceId,
  onClose,
  onSaved,
}: {
  snapshot: Snapshot;
  /** The payment file to edit; left out to record a new payment. */
  file?: string;
  /** Whose invoices to offer. Defaults to the customer of the payment, or of `invoiceId`. */
  customerId?: string;
  /** A new payment starts out paying what this invoice still owes, and fills it before any other. */
  invoiceId?: string;
  onClose: () => void;
  /** Called after saving with the payment's id, or with undefined after deleting it. */
  onSaved: (paymentId: string | undefined) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { raw } = snapshot;
  const customer =
    customerId ??
    snapshot.payments.find((payment) => payment.file === file)?.customerId ??
    snapshot.entries.find((entry) => entry.id === invoiceId)?.customerId;
  const customerName = customer && (text(asObj(asObj(raw.customers)[customer]).name) || customer);

  // The invoices as they would be without this payment, so "owed" doesn't count it.
  const without = useMemo(
    () => resolveAll({ ...raw, payments: raw.payments.filter((payment) => payment.file !== file) }).invoices,
    [raw, file],
  );

  const [initial] = useState(() => {
    if (file) return { payment: structuredClone(asObj(raw.payments.find((p) => p.file === file)?.data)), auto: false };
    // The method of the customer's latest payment, or a bank transfer when the invoice shows bank details.
    const theirs = new Set(snapshot.entries.filter((e) => customer && e.customerId === customer).map((e) => e.id));
    const lastMethod = raw.payments
      .map((payment) => asObj(payment.data))
      .filter((payment) => asList(payment.allocations).some((a) => theirs.has(text(asObj(a).invoice))))
      .sort((a, b) => text(b.date).localeCompare(text(a.date)))
      .map((payment) => text(payment.method))
      .find(Boolean);
    const startRaw = asObj(raw.invoices.find((inv) => fileStem(inv.file) === invoiceId)?.data);
    const payment = newPayment(
      receiptNumbersOutside(raw.payments),
      lastMethod || (startRaw.bankAccount ? "Bank transfer" : undefined),
    );
    const start = without.find((entry) => entry.id === invoiceId);
    if (start?.ok) {
      const owed = roundMoney(start.invoice.summary.total - start.invoice.summary.paid);
      if (owed > 0) {
        payment.amount = owed;
        payment.allocations = [{ invoice: start.id, amount: owed }];
      }
    }
    return { payment, auto: true };
  });
  const [payment, setPayment] = useState<Obj>(initial.payment);
  // While on, the split follows the amount received: the starting invoice first, then the oldest.
  const [auto, setAuto] = useState(initial.auto);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const allocations = asList(payment.allocations).map(asObj);
  const shares = new Map(allocations.map((allocation) => [text(allocation.invoice), allocation.amount]));
  const known = new Set(without.map((entry) => entry.id));
  const candidates: Candidate[] = [
    ...without
      .filter((entry) => (customer ? entry.customerId === customer : entry.id === invoiceId) || shares.has(entry.id))
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
      .map((entry): Candidate => {
        const base = { id: entry.id, title: entryTitle(entry), draft: entryStatus(entry) === "draft" };
        if (!entry.ok) return base;
        const { summary, settings } = entry.invoice;
        const fmt = createFormatters(settings.locale, summary.currency);
        return {
          ...base,
          issueDate: summary.issueDate,
          owed: roundMoney(summary.total - summary.paid),
          money: (amount) => fmt.money(fmt.toMinor(amount)),
        };
      })
      .filter((candidate) => shares.has(candidate.id) || (candidate.owed ?? 0) > 0),
    // Allocations to invoices that no longer exist, so they can be taken off.
    ...[...shares.keys()]
      .filter((id) => id && !known.has(id))
      .map((id): Candidate => ({ id, title: id, draft: false, missing: true })),
  ];
  const money = candidates.find((candidate) => candidate.money)?.money ?? ((amount: number) => String(amount));

  // Keeps the allocations in the order the invoices are listed: oldest first.
  const withShares = (base: Obj, next: Map<string, unknown>) =>
    setKey(
      base,
      "allocations",
      candidates
        .filter((candidate) => next.has(candidate.id))
        .map((candidate) => setKey({ invoice: candidate.id }, "amount", next.get(candidate.id))),
    );
  const spread = (base: Obj) => {
    const order = [
      ...candidates.filter((candidate) => candidate.id === invoiceId),
      ...candidates.filter((candidate) => candidate.id !== invoiceId && !candidate.draft),
    ].filter((candidate) => (candidate.owed ?? 0) > 0);
    const amount = typeof base.amount === "number" ? base.amount : 0;
    return withShares(base, fillInOrder(amount, order.map((candidate) => ({ id: candidate.id, owed: candidate.owed! }))));
  };

  const update = (key: string) => (value: unknown) => setPayment(setKey(payment, key, value));
  const setAmount = (value: number | undefined) => {
    const next = setKey(payment, "amount", value);
    setPayment(auto ? spread(next) : next);
  };
  const applied = roundMoney(
    allocations.reduce((sum, allocation) => sum + (typeof allocation.amount === "number" ? allocation.amount : 0), 0),
  );
  const received = typeof payment.amount === "number" ? payment.amount : undefined;
  const toggle = (candidate: Candidate, on: boolean) => {
    setAuto(false);
    const next = new Map(shares);
    if (on) {
      const left = roundMoney((received ?? 0) - applied);
      next.set(candidate.id, left > 0 ? Math.min(left, candidate.owed ?? left) : candidate.owed);
    } else {
      next.delete(candidate.id);
    }
    setPayment(withShares(payment, next));
  };
  const setShare = (candidate: Candidate, value: number | undefined) => {
    setAuto(false);
    setPayment(withShares(payment, new Map(shares).set(candidate.id, value)));
  };

  // New payments are saved under their receipt number; existing ones keep their file.
  const path = file ?? `payments/${slug(text(payment.receiptNumber)) || "new-payment"}.json`;
  const fileTaken = !file && raw.payments.some((p) => p.file === path);
  // The payment file as it would be saved over `data`, and what the checks make of it.
  const build = (data: DataSet) => {
    const clean = asObj(tidy(payment, "payment"));
    const payments = file
      ? data.payments.map((p) => (p.file === file ? { file, data: clean } : p))
      : [...data.payments, { file: path, data: clean }];
    const entry = resolveAll({ ...data, payments }).payments.find((p) => p.file === path);
    return { data: clean, errors: entry && !entry.ok ? entry.errors : [] };
  };
  const { data: next, errors } = build(raw);
  const dirty = !file || toJson(next) !== toJson(tidy(initial.payment, "payment"));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (errors.length > 0 || fileTaken || !dirty) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      // Check again against the files as they are now, in case another window saved meanwhile
      // (e.g. took the same receipt number). The dialog then shows what clashes.
      await refresh();
      const latest = build(latestSnapshot()?.raw ?? raw);
      if (latest.errors.length > 0) return setSaving(false);
      await saveFile(path, latest.data, { createOnly: !file });
      await refresh();
      onSaved(fileStem(path));
    } catch (error) {
      setSaveError((error as Error).message);
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!file || !window.confirm(`Delete payment ${text(payment.receiptNumber) || fileStem(file)} and its receipt?`)) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await deleteFile(file);
      await refresh();
      onSaved(undefined);
    } catch (error) {
      setSaveError((error as Error).message);
      setSaving(false);
    }
  };

  const close = () => {
    if (file && dirty && !window.confirm("Discard the changes to this payment?")) return;
    dialog.current?.close();
  };

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onCancel={(event) => {
        // Escape asks before throwing away edits.
        event.preventDefault();
        close();
      }}
      className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-xl bg-canvas p-0 text-ink shadow-xl backdrop:bg-black/30"
    >
      <form onSubmit={(event) => void save(event)} className="space-y-4 p-5">
        <div>
          <h3 className="text-base font-semibold">
            {file ? `Payment ${text(payment.receiptNumber) || fileStem(file)}` : "Record payment"}
          </h3>
          <p className="mt-0.5 text-[13px] text-muted">
            {customerName && `From ${customerName}. `}One receipt covers the whole payment, however it's split.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Receipt number">
            <TextInput value={payment.receiptNumber} onChange={update("receiptNumber")} />
          </Field>
          <Field label="Date paid">
            <TextInput type="date" value={payment.date} onChange={update("date")} />
          </Field>
          <Field label="Amount received">
            <NumberInput value={payment.amount} placeholder="0.00" onChange={setAmount} />
          </Field>
          <Field label="Payment method">
            <TextInput value={payment.method} placeholder="UPI, Bank transfer (NEFT)…" onChange={update("method")} />
          </Field>
        </div>
        <Field label="Small print under the method" hint="E.g. the UTR or transaction reference.">
          <LinesInput rows={1} value={payment.details} placeholder="UTR 412345678901" onChange={update("details")} />
        </Field>
        <Field label="Receipt footer" hint="Small print at the end of the receipt.">
          <TextInput
            value={payment.footer}
            placeholder="This is a computer-generated receipt and does not require a signature."
            onChange={update("footer")}
          />
        </Field>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-medium text-muted">Applied to</span>
            <button
              type="button"
              onClick={() => {
                setAuto(true);
                setPayment(spread(payment));
              }}
              disabled={received === undefined}
              className="text-[12px] font-medium text-ink underline decoration-black/20 underline-offset-2 hover:decoration-black/50 disabled:opacity-40"
            >
              {invoiceId ? "Fill this invoice, then the oldest" : "Fill the oldest invoices first"}
            </button>
          </div>
          {candidates.length === 0 ? (
            <p className="mt-1 rounded-lg border border-line bg-white px-3 py-4 text-center text-[13px] text-muted">
              Nothing is owed on {customerName ? `${customerName}'s` : "these"} invoices.
            </p>
          ) : (
            <div className="mt-1 max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-white">
              {candidates.map((candidate) => {
                const on = shares.has(candidate.id);
                const share = shares.get(candidate.id);
                return (
                  <label key={candidate.id} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(event) => toggle(candidate, event.target.checked)}
                      className="size-4 shrink-0 accent-ink"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[13px] font-medium">
                        <span className="truncate">{candidate.title}</span>
                        {candidate.draft && <StatusBadge status="draft" />}
                      </span>
                      <span className="block truncate text-[11px] text-muted">
                        {candidate.missing ? (
                          <span className="text-red-700">No such invoice</span>
                        ) : candidate.owed === undefined ? (
                          <span className="text-red-700">Needs fixing</span>
                        ) : (
                          joinParts(candidate.issueDate, `${money(candidate.owed)} owed`)
                        )}
                      </span>
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      aria-label={`Amount for ${candidate.title}`}
                      disabled={!on}
                      value={typeof share === "number" ? share : ""}
                      onChange={(event) =>
                        setShare(candidate, event.target.value === "" ? undefined : Number(event.target.value))
                      }
                      className="h-8 w-28 shrink-0 rounded-md border border-black/10 bg-white px-2 text-right text-sm tabular-nums outline-none focus:border-black/30 disabled:opacity-40"
                    />
                  </label>
                );
              })}
            </div>
          )}
          <p className="mt-1.5 text-[12px] tabular-nums">
            {received === undefined ? (
              <span className="text-muted">Enter the amount received to split it across the invoices.</span>
            ) : roundMoney(received - applied) === 0 ? (
              <span className="text-muted">All {money(received)} applied.</span>
            ) : received > applied ? (
              <span className="text-amber-800">{money(roundMoney(received - applied))} not applied to an invoice yet.</span>
            ) : (
              <span className="text-red-700">{money(roundMoney(applied - received))} more applied than received.</span>
            )}
          </p>
        </div>

        {fileTaken && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            There's already a payment saved as {path}. Change the receipt number to save this one.
          </p>
        )}
        {attempted && errors.length > 0 && <Errors title="This payment can't be saved yet" errors={errors} />}
        {saveError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">Not saved: {saveError}</p>}

        <div className="flex items-center gap-2 pt-1">
          {file && (
            <button type="button" onClick={() => void remove()} disabled={saving} className={secondaryButton}>
              <TrashIcon />
              Delete payment
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={close} className={secondaryButton}>
              Cancel
            </button>
            <button type="submit" disabled={saving || !dirty} className={primaryButton}>
              {saving ? "Saving…" : file ? "Save payment" : "Record payment"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
