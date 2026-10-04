import type { ReactNode } from "react";
import { PlusIcon, TrashIcon } from "../ui.tsx";
import { asList, asObj, type Obj, text } from "./json.ts";

const control =
  "mt-1 block w-full rounded-md border border-black/10 bg-white px-2.5 text-sm text-ink outline-none placeholder:text-black/30 focus:border-black/30 focus:ring-2 focus:ring-black/[0.06]";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-muted">{hint}</span>}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: unknown;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "email" | "url" | "date";
}) {
  return (
    <input
      type={type}
      value={text(value)}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={`${control} h-9`}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  placeholder,
}: {
  value: unknown;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step="any"
      value={typeof value === "number" ? value : ""}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
      className={`${control} h-9 tabular-nums`}
    />
  );
}

/** One entry per line; stored as a list of lines. */
export function LinesInput({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: unknown;
  onChange: (lines: string[] | undefined) => void;
  placeholder?: string;
  rows?: number;
}) {
  const current = Array.isArray(value) ? value.map(text).join("\n") : text(value);
  return (
    <textarea
      rows={rows}
      value={current}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value.split("\n"))}
      className={`${control} resize-y py-2 leading-relaxed`}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
}: {
  value: unknown;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      rows={2}
      value={text(value)}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={`${control} resize-y py-2 leading-relaxed`}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className={`${control} h-9 pr-8`}>
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-t border-line pt-5 first:border-t-0 first:pt-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-ink hover:bg-black/[0.04]"
    >
      <PlusIcon />
      {children}
    </button>
  );
}

export function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="mt-6 grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-red-50 hover:text-red-700"
    >
      <TrashIcon />
    </button>
  );
}

/** A list of small objects edited as rows of two fields, e.g. tax IDs or custom fields. */
export function PairRows({
  rows,
  onChange,
  keys,
  labels,
  placeholders,
  addLabel,
}: {
  rows: unknown;
  onChange: (rows: Obj[] | undefined) => void;
  keys: [string, string];
  labels: [string, string];
  placeholders: [string, string];
  addLabel: string;
}) {
  const list = asList(rows).map(asObj);
  const update = (index: number, key: string, value: string) =>
    onChange(list.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  return (
    <div className="space-y-2">
      {list.map((row, index) => (
        <div key={index} className="flex items-start gap-2">
          {keys.map((key, k) => (
            <div key={key} className={k === 0 ? "w-2/5" : "flex-1"}>
              <Field label={labels[k]}>
                <TextInput value={row[key]} placeholder={placeholders[k]} onChange={(v) => update(index, key, v)} />
              </Field>
            </div>
          ))}
          <RemoveButton
            label={`Remove ${labels[0].toLowerCase()} row`}
            onClick={() => {
              const next = list.filter((_, i) => i !== index);
              onChange(next.length > 0 ? next : undefined);
            }}
          />
        </div>
      ))}
      <AddButton onClick={() => onChange([...list, { [keys[0]]: "", [keys[1]]: "" }])}>{addLabel}</AddButton>
    </div>
  );
}
