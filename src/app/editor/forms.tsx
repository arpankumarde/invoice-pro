import { BANK_FIELDS, DEFAULT_SETTINGS } from "../../invoice/resolve.ts";
import type { DataSet } from "../../invoice/types.ts";
import {
  AddButton,
  Checkbox,
  ColorInput,
  Field,
  LinesInput,
  NumberInput,
  PairRows,
  RemoveButton,
  Section,
  Select,
  TextArea,
  TextInput,
} from "./fields.tsx";
import { asList, asObj, isObj, newPayment, type Obj, setKey, text } from "./json.ts";

interface FormProps {
  record: Obj;
  onChange: (record: Obj) => void;
}

/* ---------- you (the seller) and customers ---------- */

export function PartyForm({
  record,
  onChange,
  customerId,
  onCustomerId,
  images,
}: FormProps & { customerId?: string; onCustomerId?: (id: string) => void; images?: string[] }) {
  const set = (key: string) => (value: unknown) => onChange(setKey(record, key, value));
  return (
    <div className="space-y-5">
      <Section title={onCustomerId ? "Customer" : "Your details"}>
        {onCustomerId && (
          <Field label="Customer id" hint={<>Invoices refer to this customer as "customer": "{customerId || "id"}".</>}>
            <TextInput value={customerId} placeholder="acme" onChange={onCustomerId} />
          </Field>
        )}
        <Field label="Name">
          <TextInput value={record.name} placeholder={onCustomerId ? "Company or person" : "Your full name"} onChange={set("name")} />
        </Field>
        <Field label="Address" hint="One line per row, printed as written.">
          <LinesInput value={record.address} placeholder={"Street\nCity, State PIN\nCountry"} onChange={set("address")} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email">
            <TextInput type="email" value={record.email} onChange={set("email")} />
          </Field>
          <Field label="Phone">
            <TextInput value={record.phone} onChange={set("phone")} />
          </Field>
        </div>
        {images && (
          <Field label="Logo" hint="PNG or JPEG files placed in src/data.">
            <Select
              value={typeof record.logo === "string" ? record.logo : ""}
              onChange={set("logo")}
              options={[
                { value: "", label: images.length > 0 ? "No logo" : "No images in src/data yet" },
                ...images.map((image) => ({ value: image, label: image })),
              ]}
            />
          </Field>
        )}
      </Section>
      <Section title="Tax IDs">
        <PairRows
          rows={record.taxIds}
          onChange={set("taxIds")}
          keys={["type", "value"]}
          labels={["Type", "Number"]}
          placeholders={onCustomerId ? ["IN GST", "29ABCDE1234F1Z5"] : ["PAN", "ABCDE1234F"]}
          addLabel="Add tax ID"
        />
      </Section>
      {!onCustomerId && (
        <Section title="Bank accounts">
          <p className="-mt-1 text-[11px] text-muted">
            Printed as "Pay by bank transfer" on invoices that pick the account. Empty fields are left off.
          </p>
          <BankAccounts value={record.bankAccounts} holder={text(record.name)} onChange={set("bankAccounts")} />
        </Section>
      )}
    </div>
  );
}

const BANK_PLACEHOLDERS: Record<(typeof BANK_FIELDS)[number][0], string> = {
  accountName: "Name on the account",
  bankName: "HDFC Bank",
  accountNumber: "50100123456789",
  accountType: "Savings or Current",
  ifsc: "HDFC0001234",
  swift: "For payments from abroad",
  branch: "Branch name",
  upi: "name@bank",
};

function BankAccounts({
  value,
  holder,
  onChange,
}: {
  value: unknown;
  holder: string;
  onChange: (accounts: Obj[] | undefined) => void;
}) {
  const accounts = asList(value).map(asObj);
  const update = (index: number, next: Obj) => onChange(accounts.map((account, i) => (i === index ? next : account)));
  const add = () => {
    const taken = new Set(accounts.map((account) => text(account.id)));
    let id = "bank";
    for (let n = 2; taken.has(id); n++) id = `bank-${n}`;
    onChange([...accounts, { id, ...(holder ? { accountName: holder } : {}) }]);
  };
  return (
    <>
      {accounts.map((account, index) => {
        const set = (key: string) => (next: unknown) => update(index, setKey(account, key, next));
        return (
          <div key={index} className="rounded-lg border border-black/[0.08] bg-white p-3.5">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <Field label="Account id" hint="Invoices pick the account by this id.">
                  <TextInput value={account.id} placeholder="hdfc" onChange={set("id")} />
                </Field>
              </div>
              <RemoveButton
                label={`Remove bank account ${index + 1}`}
                onClick={() => {
                  const next = accounts.filter((_, i) => i !== index);
                  onChange(next.length > 0 ? next : undefined);
                }}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {BANK_FIELDS.map(([key, label]) => (
                <Field key={key} label={label}>
                  <TextInput value={account[key]} placeholder={BANK_PLACEHOLDERS[key]} onChange={set(key)} />
                </Field>
              ))}
            </div>
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-muted">Other details</p>
              <PairRows
                rows={account.details}
                onChange={set("details")}
                keys={["label", "value"]}
                labels={["Label", "Value"]}
                placeholders={["IBAN", "GB29 NWBK 6016 1331 9268 19"]}
                addLabel="Add detail"
              />
            </div>
          </div>
        );
      })}
      <AddButton onClick={add}>Add bank account</AddButton>
    </>
  );
}

/* ---------- invoices ---------- */

function TaxPicker({
  selected,
  options,
  onChange,
}: {
  selected: string[];
  options: { id: string; label: string }[];
  onChange: (ids: string[]) => void;
}) {
  if (options.length === 0) return <p className="text-xs text-muted">No tax rates in taxes.json yet.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = selected.includes(option.id);
        return (
          <label
            key={option.id}
            className={`relative inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
              on ? "border-ink bg-ink text-white" : "border-black/10 bg-white text-ink hover:bg-black/[0.03]"
            }`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={on}
              onChange={() => onChange(on ? selected.filter((id) => id !== option.id) : [...selected, option.id])}
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

export function InvoiceForm({
  record,
  onChange,
  raw,
  suggestedNumber,
  receiptNumbers,
  total,
  onRecordPayment,
}: FormProps & {
  raw: DataSet;
  suggestedNumber?: string;
  /** Receipt numbers used by other invoices, so a new payment gets the next free one. */
  receiptNumbers: string[];
  /** The invoice total, when the invoice is valid; a new payment is prefilled with what is left. */
  total?: number;
  /** Called with the new payment's index after "Record payment". */
  onRecordPayment?: (index: number) => void;
}) {
  const set = (key: string) => (value: unknown) => onChange(setKey(record, key, value));

  const customers = asObj(raw.customers);
  const settings = asObj(raw.settings);
  const taxOptions = Object.entries(asObj(raw.taxes)).map(([id, value]) => {
    const tax = asObj(value);
    const name = typeof tax.name === "string" ? tax.name : "Tax";
    return { id, label: `${name} ${typeof tax.rate === "number" ? tax.rate : "?"}%${tax.note ? " · note" : ""}` };
  });
  const defaultTaxes = asList(record.taxes).filter((id): id is string => typeof id === "string");

  const customer = record.customer;
  const customerValue = typeof customer === "string" ? customer : isObj(customer) ? "__inline__" : "";
  const customerOptions = [
    { value: "", label: "None" },
    ...Object.entries(customers).map(([id, value]) => {
      const name = asObj(value).name;
      return { value: id, label: typeof name === "string" ? `${name} (${id})` : id };
    }),
  ];
  if (isObj(customer)) customerOptions.push({ value: "__inline__", label: "Inline customer (edit in JSON)" });
  else if (typeof customer === "string" && !(customer in customers)) {
    customerOptions.push({ value: customer, label: `${customer} (not in customers.json)` });
  }

  const bankAccounts = asList(asObj(raw.business).bankAccounts)
    .map(asObj)
    .filter((account) => text(account.id));
  const bankAccount = record.bankAccount;
  const bankValue = typeof bankAccount === "string" ? bankAccount : isObj(bankAccount) ? "__inline__" : "";
  const bankOptions = [
    { value: "", label: bankAccounts.length > 0 ? "Don't show bank details" : "Add bank accounts under Your details" },
    ...bankAccounts.map((account) => {
      const number = text(account.accountNumber).replace(/\s+/g, "");
      const name = [text(account.bankName), number && `····${number.slice(-4)}`].filter(Boolean).join(" ");
      return { value: text(account.id), label: name ? `${name} (${text(account.id)})` : text(account.id) };
    }),
  ];
  if (isObj(bankAccount)) bankOptions.push({ value: "__inline__", label: "Inline account (edit in JSON)" });
  else if (typeof bankAccount === "string" && !bankAccounts.some((account) => account.id === bankAccount)) {
    bankOptions.push({ value: bankAccount, label: `${bankAccount} (not in Your details)` });
  }

  const items = asList(record.items).map(asObj);
  const setItems = (next: Obj[]) => onChange(setKey(record, "items", next));
  const updateItem = (index: number, update: (item: Obj) => Obj) =>
    setItems(items.map((item, i) => (i === index ? update(item) : item)));

  const payments = asList(record.payments).map(asObj);
  const setPayments = (next: Obj[]) => onChange(setKey(record, "payments", next));
  const updatePayment = (index: number, key: string, value: unknown) =>
    setPayments(payments.map((payment, i) => (i === index ? setKey(payment, key, value) : payment)));
  const recordPayment = () => {
    setPayments([...payments, newPayment(record, { total, receiptNumbers })]);
    onRecordPayment?.(payments.length);
  };

  return (
    <div className="space-y-5">
      <Section title="Details">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Status" hint="Drafts get a DRAFT watermark.">
            <Select
              value={record.status === "final" ? "final" : "draft"}
              onChange={set("status")}
              options={[
                { value: "draft", label: "Draft" },
                { value: "final", label: "Final" },
              ]}
            />
          </Field>
          <Field label="Invoice number">
            <TextInput value={record.number} placeholder={suggestedNumber} onChange={set("number")} />
          </Field>
          <Field label="Date of issue">
            <TextInput type="date" value={record.issueDate} onChange={set("issueDate")} />
          </Field>
          <Field label="Date due" hint="Leave empty to leave it off the invoice.">
            <TextInput type="date" value={record.dueDate} onChange={set("dueDate")} />
          </Field>
          <Field label="Customer">
            <Select
              value={customerValue}
              onChange={(value) => value !== "__inline__" && set("customer")(value)}
              options={customerOptions}
            />
          </Field>
          <Field label="Currency">
            <TextInput
              value={record.currency}
              placeholder={typeof settings.currency === "string" ? settings.currency : "USD"}
              onChange={(value) => set("currency")(value.toUpperCase())}
            />
          </Field>
        </div>
      </Section>

      <Section title="Line items">
        {items.map((item, index) => {
          const period = asObj(item.period);
          const setPeriod = (key: string, value: string) => {
            const next = setKey(period, key, value);
            updateItem(index, (it) => setKey(it, "period", Object.keys(next).length > 0 ? next : undefined));
          };
          const ownTaxes = Array.isArray(item.taxes);
          return (
            <div key={index} className="rounded-lg border border-black/[0.08] bg-white p-3.5">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <Field label={`Line ${index + 1}`}>
                    <TextInput
                      value={item.description}
                      placeholder="Description"
                      onChange={(value) => updateItem(index, (it) => setKey(it, "description", value))}
                    />
                  </Field>
                </div>
                <RemoveButton
                  label={`Remove line ${index + 1}`}
                  onClick={() => setItems(items.filter((_, i) => i !== index))}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="Quantity" hint="Empty: counts as 1, cell left blank.">
                  <NumberInput
                    value={item.quantity}
                    onChange={(value) => updateItem(index, (it) => setKey(it, "quantity", value))}
                  />
                </Field>
                <Field label="Unit price">
                  <NumberInput
                    value={item.unitPrice}
                    placeholder="0.00"
                    onChange={(value) => updateItem(index, (it) => setKey(it, "unitPrice", value))}
                  />
                </Field>
                <Field label="Period from">
                  <TextInput type="date" value={period.start} onChange={(value) => setPeriod("start", value)} />
                </Field>
                <Field label="Period to">
                  <TextInput type="date" value={period.end} onChange={(value) => setPeriod("end", value)} />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Extra lines under the description">
                  <LinesInput
                    rows={2}
                    value={item.details}
                    onChange={(value) => updateItem(index, (it) => setKey(it, "details", value))}
                  />
                </Field>
              </div>
              <div className="mt-3 space-y-2">
                <Field label="Tax on this line">
                  <Select
                    value={ownTaxes ? "own" : "default"}
                    onChange={(value) =>
                      updateItem(index, (it) =>
                        value === "own" ? { ...it, taxes: [...defaultTaxes] } : setKey(it, "taxes", undefined),
                      )
                    }
                    options={[
                      { value: "default", label: "Same as the invoice taxes below" },
                      { value: "own", label: "Choose for this line" },
                    ]}
                  />
                </Field>
                {ownTaxes && (
                  <TaxPicker
                    options={taxOptions}
                    selected={asList(item.taxes).filter((id): id is string => typeof id === "string")}
                    onChange={(ids) => updateItem(index, (it) => ({ ...it, taxes: ids }))}
                  />
                )}
              </div>
            </div>
          );
        })}
        <AddButton onClick={() => setItems([...items, { description: "", quantity: 1, unitPrice: 0 }])}>Add line item</AddButton>
      </Section>

      <Section title="Invoice taxes">
        <p className="-mt-1 text-[11px] text-muted">Applied to every line that doesn't choose its own.</p>
        <TaxPicker options={taxOptions} selected={defaultTaxes} onChange={set("taxes")} />
      </Section>

      <Section title="Extra fields">
        <p className="-mt-1 text-[11px] text-muted">Shown under the dates, e.g. Place of supply or PO number.</p>
        <PairRows
          rows={record.customFields}
          onChange={set("customFields")}
          keys={["label", "value"]}
          labels={["Label", "Value"]}
          placeholders={["Place of supply", "Bihar (10)"]}
          addLabel="Add field"
        />
      </Section>

      <Section title="Notes and payment">
        <Field label="Payment link" hint={'Shown as "Pay online".'}>
          <TextInput type="url" value={record.payUrl} placeholder="https://" onChange={set("payUrl")} />
        </Field>
        <Field label="Bank transfer" hint={'Shown as "Pay by bank transfer" under the totals.'}>
          <Select
            value={bankValue}
            onChange={(value) => value !== "__inline__" && set("bankAccount")(value)}
            options={bankOptions}
          />
        </Field>
        <Field label="Memo" hint="Printed under the amount due.">
          <TextArea value={record.memo} onChange={set("memo")} />
        </Field>
        <Field label="Footer" hint="Small print after the totals.">
          <TextArea value={record.footer} onChange={set("footer")} />
        </Field>
      </Section>

      <Section title="Payments received">
        <p className="-mt-1 text-[11px] text-muted">
          Each payment gets its own receipt, listing the payments up to it. Add them in the order they were made.
        </p>
        {payments.map((payment, index) => (
          <div key={index} className="rounded-lg border border-black/[0.08] bg-white p-3.5">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <Field label="Receipt number">
                  <TextInput
                    value={payment.receiptNumber}
                    onChange={(value) => updatePayment(index, "receiptNumber", value)}
                  />
                </Field>
              </div>
              <RemoveButton
                label={`Remove payment ${index + 1}`}
                onClick={() => setPayments(payments.filter((_, i) => i !== index))}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Date paid">
                <TextInput type="date" value={payment.date} onChange={(value) => updatePayment(index, "date", value)} />
              </Field>
              <Field label="Amount">
                <NumberInput
                  value={payment.amount}
                  placeholder="0.00"
                  onChange={(value) => updatePayment(index, "amount", value)}
                />
              </Field>
            </div>
            <div className="mt-3 space-y-3">
              <Field label="Payment method">
                <TextInput
                  value={payment.method}
                  placeholder="UPI, Bank transfer (NEFT), Cheque…"
                  onChange={(value) => updatePayment(index, "method", value)}
                />
              </Field>
              <Field label="Small print under the method" hint="E.g. the UTR or transaction reference.">
                <LinesInput
                  rows={2}
                  value={payment.details}
                  placeholder="UTR 412345678901"
                  onChange={(value) => updatePayment(index, "details", value)}
                />
              </Field>
            </div>
          </div>
        ))}
        <AddButton onClick={recordPayment}>Record payment</AddButton>
        {payments.length > 0 && (
          <Field label="Receipt footer" hint="Small print at the end of every receipt for this invoice.">
            <TextArea
              value={record.receiptFooter}
              placeholder="This is a computer-generated receipt and does not require a signature."
              onChange={set("receiptFooter")}
            />
          </Field>
        )}
      </Section>
    </div>
  );
}

/* ---------- settings ---------- */

const STRIP_PRESETS: { label: string; colors: { accentColor: string; accentColorEnd?: string } }[] = [
  { label: "Blue", colors: { accentColor: "#2563EB" } },
  { label: "Blue gradient", colors: { accentColor: "#1D4ED8", accentColorEnd: "#38BDF8" } },
  { label: "Navy gradient", colors: { accentColor: "#1E3A8A", accentColorEnd: "#3B82F6" } },
  { label: "Cream", colors: { accentColor: "#FFF6EB" } },
];

const HEX = /^#[0-9a-f]{6}$/i;

export function SettingsForm({ record, onChange }: FormProps) {
  const set = (key: string) => (value: unknown) => onChange(setKey(record, key, value));
  const start = HEX.test(text(record.accentColor)) ? text(record.accentColor) : DEFAULT_SETTINGS.accentColor;
  // A blank end colour keeps the gradient fields open while typing; the JSON leaves it out.
  const gradient = "accentColorEnd" in record;
  const end = HEX.test(text(record.accentColorEnd)) ? text(record.accentColorEnd) : start;
  const fill = (from: string, to?: string) => (to ? `linear-gradient(to right, ${from}, ${to})` : from);
  const permissions = asObj(record.permissions);
  const permission = (key: keyof typeof DEFAULT_SETTINGS.permissions) => ({
    checked: typeof permissions[key] === "boolean" ? permissions[key] : DEFAULT_SETTINGS.permissions[key],
    onChange: (checked: boolean) => set("permissions")({ ...permissions, [key]: checked }),
  });

  return (
    <div className="space-y-5">
      <Section title="Top strip">
        <p className="-mt-1 text-[11px] text-muted">The band of colour across the top of every page.</p>
        <div className="flex flex-wrap gap-1.5">
          {STRIP_PRESETS.map(({ label, colors }) => {
            const on =
              start.toLowerCase() === colors.accentColor.toLowerCase() &&
              (gradient ? end.toLowerCase() : undefined) === colors.accentColorEnd?.toLowerCase();
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ ...setKey(record, "accentColorEnd", undefined), ...colors })}
                className="inline-flex items-center gap-2 rounded-md border border-black/10 bg-white px-2 py-1 text-xs hover:bg-black/[0.03] aria-pressed:border-ink"
              >
                <span
                  className="h-2 w-8 rounded-full ring-1 ring-black/10 ring-inset"
                  style={{ background: fill(colors.accentColor, colors.accentColorEnd) }}
                />
                {label}
              </button>
            );
          })}
        </div>
        <Field label="Style">
          <Select
            value={gradient ? "gradient" : "solid"}
            onChange={(value) =>
              onChange(
                value === "gradient" ? { ...record, accentColorEnd: start } : setKey(record, "accentColorEnd", undefined),
              )
            }
            options={[
              { value: "solid", label: "Solid colour" },
              { value: "gradient", label: "Gradient, left to right" },
            ]}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={gradient ? "From" : "Colour"}>
            <ColorInput value={record.accentColor} fallback={DEFAULT_SETTINGS.accentColor} onChange={set("accentColor")} />
          </Field>
          {gradient && (
            <Field label="To">
              <ColorInput
                value={record.accentColorEnd}
                fallback={start}
                onChange={(value) => onChange({ ...record, accentColorEnd: value })}
              />
            </Field>
          )}
        </div>
      </Section>

      <Section title="Links">
        <Field label="Link colour" hint={'The "Pay online" link.'}>
          <ColorInput value={record.linkColor} fallback={DEFAULT_SETTINGS.linkColor} onChange={set("linkColor")} />
        </Field>
      </Section>

      <Section title="Format">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Locale" hint="Formats dates and amounts, e.g. en-GB, en-IN, en-US.">
            <TextInput value={record.locale} placeholder={DEFAULT_SETTINGS.locale} onChange={set("locale")} />
          </Field>
          <Field label="Default currency" hint="Invoices can choose their own.">
            <TextInput
              value={record.currency}
              placeholder={DEFAULT_SETTINGS.currency}
              onChange={(value) => set("currency")(value.toUpperCase())}
            />
          </Field>
          <Field label="Page size">
            <Select
              value={text(record.pageSize).toUpperCase() === "A4" ? "A4" : "LETTER"}
              onChange={set("pageSize")}
              options={[
                { value: "LETTER", label: "US Letter" },
                { value: "A4", label: "A4" },
              ]}
            />
          </Field>
        </div>
      </Section>

      <Section title="PDF permissions">
        <p className="-mt-1 text-[11px] text-muted">Editing the PDF is always blocked.</p>
        <Checkbox label="Printing" {...permission("printing")} />
        <Checkbox label="Copying text" {...permission("copying")} />
        <Checkbox label="Comments and annotations" {...permission("annotating")} />
      </Section>
    </div>
  );
}
