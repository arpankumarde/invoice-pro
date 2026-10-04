import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

// server/src/data, whether this runs from src/ (tsx) or dist/ (built).
const DATA_DIR = fileURLToPath(new URL("../src/data/", import.meta.url));
const PORT = Number(process.env.PORT ?? 3001);

const SHARED_FILES = ["settings.json", "business.json", "customers.json", "taxes.json"];
const INVOICE_FILE = /^invoices\/[\w-][\w.-]*\.json$/;
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

/** Only these paths (relative to the data folder) can be written, so requests can't reach other files. */
const isWritable = (path: string) => SHARED_FILES.includes(path) || INVOICE_FILE.test(path);

const app = new Hono();

// Only pages served from this machine may call the API.
app.use(
  "/api/*",
  cors({ origin: (origin) => (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin) ? origin : null) }),
);

app.onError((error, c) => c.json({ error: error.message }, 500));

app.get("/", (c) => c.text(`Invoice data server. Data folder: ${DATA_DIR}`));

/** Everything the app needs in one response. Files that fail to parse are reported, not fatal. */
app.get("/api/data", async (c) => {
  const problems: string[] = [];
  const read = async (path: string) => {
    try {
      return JSON.parse(await readFile(join(DATA_DIR, path), "utf8")) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") problems.push(`${path}: ${(error as Error).message}`);
      return undefined;
    }
  };
  const invoiceNames = (await readdir(join(DATA_DIR, "invoices")).catch(() => [] as string[]))
    .filter((name) => INVOICE_FILE.test(`invoices/${name}`))
    .sort();
  const images = (await readdir(DATA_DIR).catch(() => [] as string[])).filter(
    (name) => extname(name).toLowerCase() in IMAGE_TYPES,
  );

  const [settings, business, customers, taxes] = await Promise.all(SHARED_FILES.map(read));
  const invoices = await Promise.all(
    invoiceNames.map(async (name) => ({ file: `invoices/${name}`, data: await read(`invoices/${name}`) })),
  );
  return c.json({ settings, business, customers, taxes, invoices, images, problems });
});

app.get("/api/images/:name", async (c) => {
  const name = c.req.param("name");
  const type = IMAGE_TYPES[extname(name).toLowerCase()];
  const path = join(DATA_DIR, name);
  if (!type || /[\\/]/.test(name) || name.startsWith(".") || !existsSync(path)) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.body(await readFile(path), 200, { "Content-Type": type, "Cache-Control": "no-cache" });
});

/** Writes one JSON file. `?create` refuses to overwrite an existing file (used for new invoices). */
app.put("/api/data/:path{.+}", async (c) => {
  const path = c.req.param("path");
  if (!isWritable(path)) return c.json({ error: `${path} can't be written` }, 400);
  const body: unknown = await c.req.json().catch(() => undefined);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return c.json({ error: "The body must be a JSON object" }, 400);
  }
  const target = join(DATA_DIR, path);
  if (c.req.query("create") !== undefined && existsSync(target)) {
    return c.json({ error: `${path} already exists` }, 409);
  }
  // Write a temporary file first so a crash never leaves a half-written file behind.
  await mkdir(dirname(target), { recursive: true });
  await writeFile(`${target}.tmp`, `${JSON.stringify(body, null, 2)}\n`);
  await rename(`${target}.tmp`, target);
  return c.json({ ok: true });
});

app.delete("/api/data/:path{.+}", async (c) => {
  const path = c.req.param("path");
  if (!INVOICE_FILE.test(path)) return c.json({ error: "Only invoice files can be deleted" }, 400);
  const target = join(DATA_DIR, path);
  if (!existsSync(target)) return c.json({ error: `${path} doesn't exist` }, 404);
  await rm(target);
  return c.json({ ok: true });
});

// Loopback only: the API writes files, so it isn't exposed to the network.
serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => {
  console.log(`Invoice data server on http://localhost:${info.port}`);
});
