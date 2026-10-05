import { type FormEvent, useEffect, useRef, useState } from "react";
import { saveFile } from "../app/api.ts";
import { latestSnapshot, refresh, type Snapshot } from "../app/data.ts";
import { Field, LinesInput, NumberInput, TextInput } from "../app/editor/fields.tsx";
import {
  amountRemaining,
  asList,
  asObj,
  newPayment,
  type Obj,
  receiptNumbersOutside,
  setKey,
  text,
  tidy,
  toJson,
} from "../app/editor/json.ts";
import { Errors, PlusIcon, primaryButton, secondaryButton, TrashIcon } from "../app/ui.tsx";
import { resolveAll } from "../invoice/resolve.ts";
import type { DataSet, ResolvedInvoice } from "../invoice/types.ts";

/** A payment being edited. `key` stays put while payments are added and removed around it. */
interface Draft {
  key: number;
  payment: Obj;
  isNew: boolean;
}

/**
 * Every payment on an invoice file, one tab each: edit, delete or add payments, then save them
 * together. Nothing is written until the result passes the same checks as the editor.
 */
export function PaymentsDialog({
  snapshot,
  file,
  title,
  invoice,
  initialIndex,
  onClose,
  onSaved,
}: {
  snapshot: Snapshot;
  file: string;
  title: string;
  /** Missing when the invoice has errors; new payments then aren't prefilled with an amount. */
  invoice?: ResolvedInvoice;
  /** The payment to open on, e.g. the receipt being viewed. */
  initialIndex?: number;
  onClose: () => void;
  /** Called after saving with the selected payment's index, or undefined when none is selected. */
  onSaved: (index: number | undefined) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const record = asObj(snapshot.raw.invoices.find((inv) => inv.file === file)?.data);
  const total = invoice?.summary.total;
  const receiptNumbers = receiptNumbersOutside(snapshot.raw.invoices, file);

  // An invoice without payments opens on a new one, ready to record.
  const [initial] = useState(() => {
    const saved = asList(record.payments).map((payment, i): Draft => ({ key: i, payment: asObj(payment), isNew: false }));
    if (saved.length > 0) return { drafts: saved, selected: Math.min(initialIndex ?? saved.length - 1, saved.length - 1) };
    return { drafts: [{ key: 0, payment: newPayment(record, { total, receiptNumbers }), isNew: true }], selected: 0 };
  });
  const [drafts, setDrafts] = useState(initial.drafts);
  const [selectedKey, setSelectedKey] = useState<number | undefined>(initial.selected);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const selectedIndex = drafts.findIndex((draft) => draft.key === selectedKey);
  const selected = drafts[selectedIndex];
  // The invoice file as it would be saved over `raw`, and what the checks make of it.
  const build = (raw: DataSet) => {
    const current = asObj(raw.invoices.find((inv) => inv.file === file)?.data);
    const data = asObj(tidy({ ...current, payments: drafts.map((draft) => draft.payment) }, "invoice"));
    const check = resolveAll({
      ...raw,
      invoices: raw.invoices.map((inv) => (inv.file === file ? { file, data } : inv)),
    }).find((entry) => entry.file === file);
    return { data, errors: check && !check.ok ? check.errors : [] };
  };
  const { data: next, errors } = build(snapshot.raw);
  const dirty = toJson(next) !== toJson(tidy(record, "invoice"));
  const remaining = total === undefined ? undefined : amountRemaining(next, total);
  const hasErrors = (index: number) => errors.some((error) => error.startsWith(`payments[${index}]`));

  // The invoice is valid, so its currency is a real ISO code.
  const money = (amount: number) =>
    new Intl.NumberFormat(invoice!.settings.locale, {
      style: "currency",
      currency: (text(record.currency) || invoice!.settings.currency).toUpperCase(),
    }).format(amount);

  const update = (key: string) => (value: unknown) =>
    setDrafts((current) =>
      current.map((draft) => (draft.key === selectedKey ? { ...draft, payment: setKey(draft.payment, key, value) } : draft)),
    );

  const add = () => {
    const key = Math.max(-1, ...drafts.map((draft) => draft.key)) + 1;
    const payment = newPayment({ ...record, payments: drafts.map((draft) => draft.payment) }, { total, receiptNumbers });
    setDrafts([...drafts, { key, payment, isNew: true }]);
    setSelectedKey(key);
  };

  // Selects the payment before the removed one, or the next when the first goes.
  const remove = () => {
    const rest = drafts.filter((draft) => draft.key !== selectedKey);
    setDrafts(rest);
    setSelectedKey(rest[Math.max(0, selectedIndex - 1)]?.key);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (errors.length > 0 || !dirty) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      // Check again against the files as they are now, in case another window saved meanwhile
      // (e.g. took the same receipt numbers). The dialog then shows what clashes.
      await refresh();
      const latest = build(latestSnapshot()?.raw ?? snapshot.raw);
      if (latest.errors.length > 0) return setSaving(false);
      await saveFile(file, latest.data);
      await refresh();
      onSaved(selectedIndex === -1 ? undefined : selectedIndex);
    } catch (error) {
      setSaveError((error as Error).message);
      setSaving(false);
    }
  };

  const close = () => {
    if (dirty && !window.confirm("Discard the changes to these payments?")) return;
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
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl bg-canvas p-0 text-ink shadow-xl backdrop:bg-black/30"
    >
      <form onSubmit={(event) => void save(event)} className="space-y-4 p-5">
        <div>
          <h3 className="text-base font-semibold">Payments</h3>
          <p className="mt-0.5 text-[13px] text-muted">
            {total === undefined || remaining === undefined ? (
              title
            ) : (
              <>
                {title} · <span className="tabular-nums">{money(total)}</span> total ·{" "}
                <span className="tabular-nums">
                  {remaining > 0 ? `${money(remaining)} owed after these payments` : "paid in full with these payments"}
                </span>
              </>
            )}
          </p>
          <p className="mt-1 text-[11px] text-muted">
            Each payment gets its own receipt. List them in the order they were made.
          </p>
        </div>

        <div className="flex flex-wrap gap-1 rounded-md bg-black/[0.05] p-0.5 text-[13px] font-medium" role="tablist">
          {drafts.map((draft, i) => (
            <button
              key={draft.key}
              type="button"
              role="tab"
              aria-selected={draft.key === selectedKey}
              onClick={() => setSelectedKey(draft.key)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded px-3 py-1 whitespace-nowrap text-muted aria-selected:bg-white aria-selected:text-ink aria-selected:shadow-sm"
            >
              {text(draft.payment.receiptNumber) || `Payment ${i + 1}`}
              {draft.isNew && <span className="text-[11px] font-normal text-muted">new</span>}
              {attempted && hasErrors(i) && <span className="size-1.5 rounded-full bg-red-600" aria-label="has problems" />}
            </button>
          ))}
          <button
            type="button"
            onClick={add}
            disabled={remaining !== undefined && remaining <= 0}
            title={remaining !== undefined && remaining <= 0 ? "Paid in full" : undefined}
            className="inline-flex shrink-0 items-center gap-1 rounded px-2.5 py-1 whitespace-nowrap text-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PlusIcon />
            New payment
          </button>
        </div>

        {selected ? (
          <div key={selected.key} className="space-y-3">
            <Field label="Receipt number">
              <TextInput value={selected.payment.receiptNumber} onChange={update("receiptNumber")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date paid">
                <TextInput type="date" value={selected.payment.date} onChange={update("date")} />
              </Field>
              <Field label="Amount">
                <NumberInput value={selected.payment.amount} placeholder="0.00" onChange={update("amount")} />
              </Field>
            </div>
            <Field label="Payment method">
              <TextInput
                value={selected.payment.method}
                placeholder="UPI, Bank transfer (NEFT), Cheque…"
                onChange={update("method")}
              />
            </Field>
            <Field label="Small print under the method" hint="E.g. the UTR or transaction reference.">
              <LinesInput rows={2} value={selected.payment.details} placeholder="UTR 412345678901" onChange={update("details")} />
            </Field>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted">
            {dirty ? "No payments left. Saving removes every receipt for this invoice." : "No payments yet."}
          </p>
        )}

        {attempted && errors.length > 0 && <Errors title="These payments can't be saved yet" errors={errors} />}
        {saveError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">Not saved: {saveError}</p>}

        <div className="flex items-center gap-2 pt-1">
          {selected && (
            <button type="button" onClick={remove} className={secondaryButton}>
              <TrashIcon />
              Delete payment
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={close} className={secondaryButton}>
              Cancel
            </button>
            <button type="submit" disabled={saving || !dirty} className={primaryButton}>
              {saving ? "Saving…" : "Save payments"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
