import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { resolveAll } from "../../invoice/resolve.ts";
import type { DataSet, InvoiceEntry } from "../../invoice/types.ts";
import { DATA_FOLDER, deleteFile, saveFile } from "../api.ts";
import { refresh, type Snapshot } from "../data.ts";
import { PdfPreview } from "../PdfPreview.tsx";
import { CheckIcon, Code, Errors, PageSkeleton, primaryButton, secondaryButton, TrashIcon } from "../ui.tsx";
import { usePdf } from "../usePdf.ts";
import { InvoiceForm, PartyForm, SettingsForm } from "./forms.tsx";
import { asList, asObj, isObj, nextInvoiceNumber, type Obj, slug, text, tidy, today, toJson } from "./json.ts";
import { type EditTarget, parseTargetKey, targetKey } from "./target.ts";

const NEW_INVOICE_FILE = "invoices/(new invoice).json";

const fileStem = (file: string) => file.slice(file.lastIndexOf("/") + 1).replace(/\.json$/, "");

const sortKey = (entry: InvoiceEntry) => (entry.ok ? entry.invoice.summary.sortKey : `0000 ${entry.id}`);

/** customers.json with `record` stored under `id`, replacing (or renaming) the customer being edited. */
function mergeCustomer(customers: unknown, originalId: string | undefined, id: string, record: Obj): Obj {
  const out: Obj = {};
  let placed = false;
  for (const [key, value] of Object.entries(asObj(customers))) {
    if (key === originalId || key === id) {
      if (!placed) out[id] = record;
      placed = true;
    } else {
      out[key] = value;
    }
  }
  if (!placed) out[id] = record;
  return out;
}

function initialState({ raw, entries }: Snapshot, target: EditTarget): { record: Obj; customerId: string } {
  const copy = (value: unknown): Obj => (isObj(value) ? structuredClone(value) : {});
  if (target.kind === "business") return { record: copy(raw.business), customerId: "" };
  if (target.kind === "settings") return { record: copy(raw.settings), customerId: "" };
  if (target.kind === "customer") {
    return { record: copy(asObj(raw.customers)[target.id ?? ""]), customerId: target.id ?? "" };
  }
  if (target.file) return { record: copy(raw.invoices.find((inv) => inv.file === target.file)?.data), customerId: "" };
  const numbers = entries.map((entry) => (entry.ok ? entry.invoice.number : entry.number)).filter(Boolean) as string[];
  const number = nextInvoiceNumber(numbers);
  // New invoices show your first bank account; the invoice form can change or remove it.
  const bankAccount = asList(asObj(raw.business).bankAccounts)
    .map((account) => text(asObj(account).id))
    .find(Boolean);
  return {
    record: {
      status: "draft",
      ...(number ? { number } : {}),
      issueDate: today(),
      items: [{ description: "", quantity: 1, unitPrice: 0 }],
      ...(bankAccount ? { bankAccount } : {}),
    },
    customerId: "",
  };
}

/**
 * Resolves what the PDF would look like with the edit applied. Customer, seller and settings
 * edits are shown on the most recent invoice.
 */
function previewEntry({ raw, entries }: Snapshot, target: EditTarget, record: Obj, customerId: string) {
  const latest = [...entries].sort((a, b) => sortKey(b).localeCompare(sortKey(a)))[0]?.file;
  let data: DataSet;
  let file: string | undefined;
  if (target.kind === "invoice") {
    file = target.file ?? NEW_INVOICE_FILE;
    data = {
      ...raw,
      invoices: target.file
        ? raw.invoices.map((inv) => (inv.file === file ? { file, data: record } : inv))
        : [...raw.invoices, { file, data: record }],
    };
  } else if (target.kind === "business") {
    file = latest;
    data = { ...raw, business: record };
  } else if (target.kind === "settings") {
    file = latest;
    data = { ...raw, settings: record };
  } else {
    file = latest;
    const id = customerId.trim() || "(customer)";
    data = {
      ...raw,
      customers: mergeCustomer(raw.customers, target.id, id, record),
      invoices: raw.invoices.map((inv) =>
        inv.file === file ? { file, data: { ...asObj(inv.data), customer: id } } : inv,
      ),
    };
  }
  return file ? resolveAll(data).find((entry) => entry.file === file) : undefined;
}

function useDebounced<T extends string>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function Editor({
  snapshot,
  target,
  onNavigate,
}: {
  snapshot: Snapshot;
  target: EditTarget;
  /** Moves the editor to another record, e.g. to the file a new invoice was just saved as. */
  onNavigate: (target: EditTarget) => void;
}) {
  const { raw, images } = snapshot;
  const context = target.kind === "invoice" || target.kind === "settings" ? target.kind : "party";
  const [initial] = useState(() => initialState(snapshot, target));
  const [record, setRecord] = useState(initial.record);
  const [customerId, setCustomerId] = useState(initial.customerId);
  const [jsonText, setJsonText] = useState(() => toJson(tidy(initial.record, context)));
  const [jsonError, setJsonError] = useState<string>();
  const [tab, setTab] = useState<"preview" | "json">("preview");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  const updateRecord = (next: Obj) => {
    setRecord(next);
    setJsonText(toJson(tidy(next, context)));
    setJsonError(undefined);
  };
  const updateJsonText = (value: string) => {
    setJsonText(value);
    try {
      const parsed: unknown = JSON.parse(value);
      if (!isObj(parsed)) throw new Error("The JSON must be a single object, starting with { and ending with }");
      setRecord(parsed);
      setJsonError(undefined);
    } catch (error) {
      setJsonError((error as Error).message);
    }
  };

  // What gets written: the invoice, business or settings record itself, or the whole customers.json with
  // this customer added, updated or renamed.
  const payloadFor = (rec: Obj, customer: string) => {
    const clean = asObj(tidy(rec, context));
    return target.kind === "customer" ? mergeCustomer(raw.customers, target.id, customer, clean) : clean;
  };
  const clean = asObj(tidy(record, context));
  const id = customerId.trim();
  const payload = payloadFor(record, id);
  const output = toJson(payload);
  const path =
    target.kind === "business" || target.kind === "settings"
      ? `${target.kind}.json`
      : target.kind === "customer"
        ? "customers.json"
        : (target.file ?? `invoices/${slug(text(clean.number)) || "new-invoice"}.json`);
  const isNewInvoice = target.kind === "invoice" && !target.file;
  const isNew = isNewInvoice || (target.kind === "customer" && !target.id);
  const takenId = target.kind === "customer" && id !== target.id && id in asObj(raw.customers);
  const fileTaken = isNewInvoice && raw.invoices.some((inv) => inv.file === path);
  const [savedOutput, setSavedOutput] = useState(() =>
    isNew ? "" : toJson(payloadFor(initial.record, initial.customerId.trim())),
  );
  const dirty = output !== savedOutput;
  const canSave = !saving && !jsonError && !fileTaken && !(target.kind === "customer" && !id);

  // Rebuild the preview shortly after typing stops rather than on every keystroke.
  // The memo matters: usePdf rebuilds whenever it receives a new invoice object.
  const previewSource = useDebounced(JSON.stringify({ clean, id }), 300);
  const key = targetKey(target);
  const entry = useMemo(() => {
    const parsed = JSON.parse(previewSource) as { clean: Obj; id: string };
    return previewEntry(snapshot, parseTargetKey(key)!, parsed.clean, parsed.id);
  }, [snapshot, key, previewSource]);
  const pdf = usePdf(entry?.ok ? entry.invoice : undefined, images);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await saveFile(path, payload, { createOnly: isNewInvoice });
      await refresh();
      setSavedOutput(output);
      // New records continue in the editor under their saved name.
      if (isNewInvoice) onNavigate({ kind: "invoice", file: path });
      else if (target.kind === "customer" && target.id !== id) onNavigate({ kind: "customer", id });
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (target.kind === "invoice" && target.file) {
      if (!window.confirm(`Delete ${title.replace(/^Edit /, "")}? This removes ${DATA_FOLDER}/${target.file}.`)) return;
    } else if (target.kind === "customer" && target.id) {
      const using = raw.invoices.filter((inv) => asObj(inv.data).customer === target.id).length;
      const warning = using > 0 ? ` ${using} invoice(s) use this customer and will need another one.` : "";
      if (!window.confirm(`Delete customer ${target.id}?${warning}`)) return;
    } else {
      return;
    }
    setSaveError(undefined);
    try {
      if (target.kind === "invoice") {
        await deleteFile(path);
      } else {
        const remaining = { ...asObj(raw.customers) };
        delete remaining[target.id!];
        await saveFile("customers.json", remaining);
      }
      await refresh();
      onNavigate({ kind: target.kind });
    } catch (error) {
      setSaveError((error as Error).message);
    }
  };

  // Ctrl+S / Cmd+S saves.
  const onSaveShortcut = useEffectEvent(() => void save());
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onSaveShortcut();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const title =
    target.kind === "business"
      ? "Your details"
      : target.kind === "settings"
        ? "Settings"
        : target.kind === "customer"
          ? target.id
            ? `Edit customer ${target.id}`
            : "New customer"
          : target.file
            ? `Edit ${text(asObj(raw.invoices.find((inv) => inv.file === target.file)?.data).number) || fileStem(target.file)}`
            : "New invoice";

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{title}</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              {isNewInvoice ? "Will be saved as " : ""}
              <Code>{`${DATA_FOLDER}/${path}`}</Code>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-[13px] ${saveError ? "text-red-700" : "text-muted"}`} role="status">
              {saveError ? (
                `Not saved: ${saveError}`
              ) : saving ? (
                "Saving…"
              ) : dirty ? (
                isNew ? "Not saved yet" : "Unsaved changes"
              ) : (
                <span className="inline-flex items-center gap-1">
                  <CheckIcon />
                  Saved
                </span>
              )}
            </span>
            {((target.kind === "invoice" && target.file) || (target.kind === "customer" && target.id)) && (
              <button type="button" onClick={() => void remove()} className={secondaryButton}>
                <TrashIcon />
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave || (!dirty && !isNew)}
              className={primaryButton}
              title="Save (Ctrl+S)"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </header>

      <div className="grid gap-8 px-4 py-6 sm:px-8 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          {target.kind === "customer" && !id && (
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
              Give the customer an id to save it.
            </p>
          )}
          {fileTaken && (
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
              There's already an invoice saved as {path}. Change the invoice number to save this one.
            </p>
          )}
          {takenId && (
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
              Another customer already uses the id "{id}". Saving will replace it.
            </p>
          )}
          {target.kind === "invoice" ? (
            <InvoiceForm
              record={record}
              onChange={updateRecord}
              raw={raw}
              suggestedNumber={nextInvoiceNumber(
                snapshot.entries.map((e) => (e.ok ? e.invoice.number : e.number)).filter(Boolean) as string[],
              )}
            />
          ) : target.kind === "settings" ? (
            <SettingsForm record={record} onChange={updateRecord} />
          ) : (
            <PartyForm
              record={record}
              onChange={updateRecord}
              images={target.kind === "business" ? raw.images : undefined}
              customerId={target.kind === "customer" ? customerId : undefined}
              onCustomerId={target.kind === "customer" ? setCustomerId : undefined}
            />
          )}
        </div>

        <div className="min-w-0 xl:sticky xl:top-[6.75rem] xl:max-h-[calc(100dvh-8.25rem)] xl:self-start xl:overflow-y-auto">
          <div className="mb-4 inline-flex rounded-md bg-black/[0.05] p-0.5 text-[13px] font-medium" role="tablist">
            {(["preview", "json"] as const).map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={tab === name}
                onClick={() => setTab(name)}
                className="rounded px-3 py-1 text-muted aria-selected:bg-white aria-selected:text-ink aria-selected:shadow-sm"
              >
                {name === "preview" ? "Preview" : "JSON"}
              </button>
            ))}
          </div>

          {tab === "json" ? (
            <div>
              <p className="mb-2 text-xs text-muted">
                {target.kind === "customer"
                  ? "This customer on its own; saving adds it to customers.json with your other customers. You can edit the JSON directly."
                  : "You can edit the JSON directly; the form follows along."}
              </p>
              <textarea
                value={jsonText}
                onChange={(event) => updateJsonText(event.target.value)}
                spellCheck={false}
                aria-label="JSON"
                className="block h-[65vh] min-h-80 w-full resize-y rounded-lg border border-black/10 bg-white p-4 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-black/30"
              />
              {jsonError && <p className="mt-2 text-[13px] text-red-700">Not valid JSON yet: {jsonError}</p>}
            </div>
          ) : !entry ? (
            <p className="text-sm text-muted">Add an invoice first to preview your details and customers.</p>
          ) : !entry.ok ? (
            <Errors title="The preview can't be built yet" errors={entry.errors} />
          ) : (
            <>
              {target.kind !== "invoice" && (
                <p className="mb-3 text-xs text-muted">
                  Shown on {entry.invoice.number ?? entry.id}, your latest invoice.
                </p>
              )}
              {pdf.error && <p className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-800">{pdf.error}</p>}
              {pdf.previewBytes ? (
                <PdfPreview bytes={pdf.previewBytes} label={`${title} preview`} />
              ) : (
                !pdf.error && <PageSkeleton />
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
