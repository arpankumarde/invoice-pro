// Renders invoices and their receipts from server/src/data to out/*.pdf without the browser or
// the data server.
//   pnpm pdf                     every valid invoice and its receipts
//   pnpm pdf INV-2026-10-0001    only the named invoices (file name or invoice number) and their receipts
//   pnpm pdf RCT-2026-10-0001    only the named receipts (file name or receipt number)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAll } from "../src/invoice/resolve.ts";
import type { DataSet, ResolvedDocument } from "../src/invoice/types.ts";
import { renderPdf } from "../src/pdf/render.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataDir = join(root, "server", "src", "data");
const outDir = join(root, "out");

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`✗ ${path.slice(root.length)} is not valid JSON: ${(error as Error).message}`);
    process.exit(1);
  }
}

/** Every JSON file in a folder of records, e.g. invoices/INV-2026-10-0001.json. */
const records = (folder: string) => {
  const dir = join(dataDir, folder);
  return (existsSync(dir) ? readdirSync(dir) : [])
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ file: `${folder}/${name}`, data: readJson(join(dir, name)) }));
};

const dataSet: DataSet = {
  settings: readJson(join(dataDir, "settings.json")),
  business: readJson(join(dataDir, "business.json")),
  customers: readJson(join(dataDir, "customers.json")),
  taxes: readJson(join(dataDir, "taxes.json")),
  invoices: records("invoices"),
  payments: records("payments"),
  images: readdirSync(dataDir).filter((name) => [".png", ".jpg", ".jpeg"].includes(extname(name).toLowerCase())),
};

const font = (name: string) => readFileSync(join(root, "src", "assets", "fonts", name));
const fonts = {
  regular: font("Inter-Regular.ttf"),
  medium: font("Inter-Medium.ttf"),
  semibold: font("Inter-SemiBold.ttf"),
};

const wanted = process.argv.slice(2);
const { invoices, payments } = resolveAll(dataSet);
const wantedInvoices = invoices.filter(
  (entry) => wanted.length === 0 || wanted.includes(entry.id) || (entry.ok && wanted.includes(entry.invoice.number ?? "")),
);
const wantedPayments = payments.filter(
  (entry) =>
    wanted.includes(entry.id) ||
    wanted.includes((entry.ok ? entry.receipt.number : entry.receiptNumber) ?? ""),
);
if (wantedInvoices.length + wantedPayments.length === 0) {
  console.error(wanted.length ? `Nothing matches ${wanted.join(", ")}` : "No invoices in server/src/data/invoices");
  process.exit(1);
}

// The named invoices with their receipts, then the named receipts. A receipt for a payment split
// across invoices is written once.
const documents = new Map<string, ResolvedDocument>();
for (const entry of [...wantedInvoices, ...wantedPayments]) {
  if (!entry.ok) {
    console.error(`✗ ${entry.file}\n${entry.errors.map((e) => `    ${e}`).join("\n")}`);
    process.exitCode = 1;
    continue;
  }
  const own = "invoice" in entry ? [entry.invoice, ...entry.invoice.receipts] : [entry.receipt];
  for (const document of own) documents.set(document.fileName, document);
}

mkdirSync(outDir, { recursive: true });
for (const document of documents.values()) {
  const logo = document.logo ? readFileSync(join(dataDir, document.logo)) : undefined;
  const pdf = await renderPdf(document, { fonts, logo });
  writeFileSync(join(outDir, document.fileName), pdf);
  console.log(`✓ out/${document.fileName}${document.status === "draft" ? "  (draft)" : ""}`);
}
