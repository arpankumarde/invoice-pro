import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useBlocker } from "react-router";
import { resolveAll } from "../../invoice/resolve.ts";
import type { DataSet, InvoiceEntry } from "../../invoice/types.ts";
import { DATA_FOLDER, deleteFile, saveFile } from "../api.ts";
import { refresh, type Snapshot } from "../data.ts";
import { PdfPreview } from "../PdfPreview.tsx";
import {
  CheckIcon,
  DocumentTabs,
  Errors,
  ghostButton,
  Notice,
  PageHeader,
  PageSkeleton,
  primaryButton,
  TrashIcon,
} from "../ui.tsx";
import { usePdf } from "../usePdf.ts";
import { InvoiceForm, PartyForm, SettingsForm } from "./forms.tsx";
import {
  asList,
  asObj,
  duplicateInvoice,
  isObj,
  nextNumber,
  type Obj,
  slug,
  text,
  tidy,
  today,
  toJson,
} from "./json.ts";
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
  const source = target.from ? raw.invoices.find((inv) => inv.file === target.from)?.data : undefined;
  if (isObj(source)) return { record: duplicateInvoice(source, numbers), customerId: "" };
  const number = nextNumber("INV", numbers);
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
  return file ? resolveAll(data).invoices.find((entry) => entry.file === file) : undefined;
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
  // Which document the preview shows: the invoice, or one of its receipts by id.
  const [previewId, setPreviewId] = useState<string>();
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
  const [initialOutput] = useState(() => toJson(payloadFor(initial.record, initial.customerId.trim())));
  const [savedOutput, setSavedOutput] = useState(() => (isNew ? "" : initialOutput));
  const dirty = output !== savedOutput;
  // A new record that hasn't been touched has nothing to lose, even though it isn't saved yet.
  const unsaved = dirty && !(isNew && output === initialOutput);
  // Set when the editor itself navigates away (after a save or a delete), which must not prompt.
  const leaving = useRef(false);
  const leave = (next: EditTarget) => {
    leaving.current = true;
    onNavigate(next);
  };
  const canSave = !saving && !jsonError && !fileTaken && !(target.kind === "customer" && !id);

  // Rebuild the preview shortly after typing stops rather than on every keystroke.
  // The memo matters: usePdf rebuilds whenever it receives a new invoice object.
  const previewSource = useDebounced(JSON.stringify({ clean, id }), 300);
  const key = targetKey(target);
  const entry = useMemo(() => {
    const parsed = JSON.parse(previewSource) as { clean: Obj; id: string };
    return previewEntry(snapshot, parseTargetKey(key)!, parsed.clean, parsed.id);
  }, [snapshot, key, previewSource]);
  const invoice = entry?.ok ? entry.invoice : undefined;
  const shown = invoice?.receipts.find((receipt) => receipt.id === previewId) ?? invoice;
  const pdf = usePdf(shown, images);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await saveFile(path, payload, { createOnly: isNewInvoice });
      await refresh();
      setSavedOutput(output);
      // New records continue in the editor under their saved name.
      if (isNewInvoice) leave({ kind: "invoice", file: path });
      else if (target.kind === "customer" && target.id !== id) leave({ kind: "customer", id });
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (target.kind === "invoice" && target.file) {
      const id = fileStem(target.file);
      const paying = raw.payments.filter((p) => asList(asObj(p.data).allocations).some((a) => asObj(a).invoice === id)).length;
      const warning = paying > 0 ? ` ${paying} payment(s) go towards it and will need fixing.` : "";
      if (!window.confirm(`Delete ${title.replace(/^Edit /, "")}? This removes ${DATA_FOLDER}/${target.file}.${warning}`)) return;
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
      leave({ kind: target.kind });
    } catch (error) {
      setSaveError((error as Error).message);
    }
  };

  // Ask before in-app navigation (sidebar, tabs, back/forward) throws away unsaved edits.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      unsaved &&
      !leaving.current &&
      currentLocation.pathname + currentLocation.search !== nextLocation.pathname + nextLocation.search,
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm("You have unsaved changes. Leave without saving?")) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  // Closing or reloading the browser tab gets the browser's own prompt.
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);

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
            : target.from
              ? `New invoice from ${text(asObj(raw.invoices.find((inv) => inv.file === target.from)?.data).number) || fileStem(target.from)}`
              : "New invoice";

  return (
    <>
      <PageHeader
        wide
        title={title}
        subtitle={
          <span className="font-mono text-[12px]">
            {isNewInvoice ? "Will be saved as " : ""}
            {`${DATA_FOLDER}/${path}`}
          </span>
        }
        actions={
          <>
            <span className={`mr-1 text-[13px] ${saveError ? "text-red-700" : "text-muted"}`} role="status">
              {saveError ? (
                `Not saved: ${saveError}`
              ) : saving ? (
                "Saving…"
              ) : dirty ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
                  {isNew ? "Not saved yet" : "Unsaved changes"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <CheckIcon />
                  Saved
                </span>
              )}
            </span>
            {((target.kind === "invoice" && target.file) || (target.kind === "customer" && target.id)) && (
              <button
                type="button"
                onClick={() => void remove()}
                className={`${ghostButton} hover:bg-red-50 hover:text-red-700`}
              >
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
          </>
        }
      />

      <div className="grid gap-8 px-4 py-6 sm:px-8 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          {target.kind === "customer" && !id && (
            <div className="mb-4">
              <Notice tone="warning">Give the customer an id to save it.</Notice>
            </div>
          )}
          {fileTaken && (
            <div className="mb-4">
              <Notice tone="warning">
                There's already an invoice saved as {path}. Change the invoice number to save this one.
              </Notice>
            </div>
          )}
          {takenId && (
            <div className="mb-4">
              <Notice tone="warning">Another customer already uses the id "{id}". Saving will replace it.</Notice>
            </div>
          )}
          {target.kind === "invoice" ? (
            <InvoiceForm
              record={record}
              onChange={updateRecord}
              raw={raw}
              suggestedNumber={nextNumber(
                "INV",
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
              <DocumentTabs invoice={entry.invoice} selectedId={shown?.id ?? entry.id} onSelect={setPreviewId} />
              {pdf.error && (
                <div className="mb-4">
                  <Notice tone="error">{pdf.error}</Notice>
                </div>
              )}
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
