// Renders invoices from server/src/data to out/*.pdf without the browser or the data server.
//   pnpm pdf                  every valid invoice
//   pnpm pdf INV-2026-0001    only the named invoices (file name or invoice number)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAll } from "../src/invoice/resolve.ts";
import type { DataSet } from "../src/invoice/types.ts";
import { renderInvoicePdf } from "../src/pdf/render.ts";

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

const invoiceDir = join(dataDir, "invoices");
const dataSet: DataSet = {
  settings: readJson(join(dataDir, "settings.json")),
  business: readJson(join(dataDir, "business.json")),
  customers: readJson(join(dataDir, "customers.json")),
  taxes: readJson(join(dataDir, "taxes.json")),
  invoices: (existsSync(invoiceDir) ? readdirSync(invoiceDir) : [])
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ file: `invoices/${name}`, data: readJson(join(invoiceDir, name)) })),
  images: readdirSync(dataDir).filter((name) => [".png", ".jpg", ".jpeg"].includes(extname(name).toLowerCase())),
};

const font = (name: string) => readFileSync(join(root, "src", "assets", "fonts", name));
const fonts = {
  regular: font("Inter-Regular.ttf"),
  medium: font("Inter-Medium.ttf"),
  semibold: font("Inter-SemiBold.ttf"),
};

const wanted = process.argv.slice(2);
const entries = resolveAll(dataSet).filter(
  (entry) => wanted.length === 0 || wanted.includes(entry.id) || (entry.ok && wanted.includes(entry.invoice.number ?? "")),
);
if (entries.length === 0) {
  console.error(wanted.length ? `No invoice matches ${wanted.join(", ")}` : "No invoices in server/src/data/invoices");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
for (const entry of entries) {
  if (!entry.ok) {
    console.error(`✗ ${entry.file}\n${entry.errors.map((e) => `    ${e}`).join("\n")}`);
    process.exitCode = 1;
    continue;
  }
  const { invoice } = entry;
  const logo = invoice.logo ? readFileSync(join(dataDir, invoice.logo)) : undefined;
  const pdf = await renderInvoicePdf(invoice, { fonts, logo });
  writeFileSync(join(outDir, invoice.fileName), pdf);
  console.log(`✓ out/${invoice.fileName}${invoice.status === "draft" ? "  (draft)" : ""}`);
}
