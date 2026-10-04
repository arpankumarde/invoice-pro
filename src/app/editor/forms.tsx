import type { DataSet } from "../../invoice/types.ts";
import {
  AddButton,
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
import { asList, asObj, isObj, type Obj, setKey } from "./json.ts";

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
    </div>
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
}: FormProps & { raw: DataSet; suggestedNumber?: string }) {
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

  const items = asList(record.items).map(asObj);
  const setItems = (next: Obj[]) => onChange(setKey(record, "items", next));
  const updateItem = (index: number, update: (item: Obj) => Obj) =>
    setItems(items.map((item, i) => (i === index ? update(item) : item)));

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
        <Field label="Memo" hint="Printed under the amount due.">
          <TextArea value={record.memo} onChange={set("memo")} />
        </Field>
        <Field label="Footer" hint="Small print after the totals.">
          <TextArea value={record.footer} onChange={set("footer")} />
        </Field>
      </Section>
    </div>
  );
}
