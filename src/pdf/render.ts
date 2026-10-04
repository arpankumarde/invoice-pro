import PDFDocument from "pdfkit";
import type { Party, ResolvedDocument } from "../invoice/types.ts";
import { stripJpegMetadata } from "./image.ts";

export interface RenderAssets {
  fonts: { regular: Uint8Array; medium: Uint8Array; semibold: Uint8Array };
  /** PNG or JPEG bytes. */
  logo?: Uint8Array;
}

/** pdfkit always appends an XMP packet carrying a creation date and "PDFKit" as producer. */
class BareDocument extends PDFDocument {
  endMetadata() {}
}

const PAGE_SIZES = { LETTER: [612, 792], A4: [595.28, 841.89] } as const;

const FONT = { regular: "Inter-Regular", medium: "Inter-Medium", semibold: "Inter-SemiBold" } as const;
const CAP_HEIGHT = 1490 / 2048; // Inter cap height, in em

// Measurements in points, taken from the reference invoice.
const BLACK = "#000000";
const HAIRLINE = "#EBEBEB";
const MARGIN = 30;
const LINE = 13.5; // line pitch for 9pt text
const SMALL_LINE = 10.5; // line pitch for 7.5pt text
const ITEM_GAP = 6;
const COLUMN_GAP = 30;
const RULE = 0.75;
const LOGO_SIZE = 40.5;
const CONTINUED_TOP = 48; // first baseline on continuation pages

interface Style {
  weight?: keyof typeof FONT;
  size?: number;
  color?: string;
}
const SMALL: Style = { size: 7.5 };
const MARKER: Style = { size: 5.4 };

const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Draws the invoice, or one of its receipts, and returns the finished PDF.
 *
 * Text stays real, selectable vector text. The file is encrypted (AES-256) with no open password
 * and a random owner password that is thrown away, so viewers refuse editing and page assembly
 * (annotating too, unless settings allow it). It carries no Info entries, no XMP packet and a
 * random file ID.
 */
export function renderPdf(invoice: ResolvedDocument, assets: RenderAssets): Promise<Uint8Array<ArrayBuffer>> {
  const { settings } = invoice;
  const [pageWidth, pageHeight] = PAGE_SIZES[settings.pageSize];
  const right = pageWidth - MARGIN;
  const width = right - MARGIN;
  const footerRuleY = pageHeight - 60.75;
  const bottom = footerRuleY - 24; // lowest baseline allowed for body text

  const doc = new BareDocument({
    size: [pageWidth, pageHeight],
    margin: 0,
    // No default font: pdfkit's browser build would otherwise try to load Helvetica, which it
    // doesn't bundle. Every draw call below sets an Inter weight explicitly.
    font: null as unknown as string,
    autoFirstPage: false,
    bufferPages: true,
    pdfVersion: "1.7ext3",
    ownerPassword: randomHex(32),
    permissions: {
      printing: settings.permissions.printing ? "highResolution" : undefined,
      copying: settings.permissions.copying,
      annotating: settings.permissions.annotating,
      contentAccessibility: true,
      modifying: false,
      fillingForms: false,
      documentAssembly: false,
    },
    // pdfkit hashes the trailer /ID from these values when the document is created. Throwaway
    // random values keep the ID free of a timestamp or a "PDFKit" fingerprint. The Info
    // dictionary itself is emptied before the file is written.
    info: {
      CreationDate: new Date(crypto.getRandomValues(new Uint32Array(1))[0] * 1000),
      Producer: randomHex(16),
      Creator: randomHex(16),
    },
  });

  const chunks: Uint8Array[] = [];
  const done = new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    doc.on("end", () => resolve(concat(chunks)));
    doc.on("error", reject);
  });

  doc.registerFont(FONT.regular, assets.fonts.regular);
  doc.registerFont(FONT.medium, assets.fonts.medium);
  doc.registerFont(FONT.semibold, assets.fonts.semibold);

  /* ---------- drawing helpers (all y values are text baselines) ---------- */

  const applyStyle = ({ weight = "regular", size = 9, color = BLACK }: Style = {}) =>
    doc.font(FONT[weight]).fontSize(size).fillColor(color);

  const measure = (text: string, style?: Style) => {
    applyStyle(style);
    return doc.widthOfString(text);
  };

  const write = (text: string, x: number, baseline: number, style?: Style, align: "left" | "right" = "left") => {
    const textWidth = measure(text, style);
    doc.text(text, align === "right" ? x - textWidth : x, baseline, { lineBreak: false, baseline: "alphabetic" });
    return textWidth;
  };

  const wrap = (text: string, maxWidth: number, style?: Style): string[] => {
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (measure(candidate, style) <= maxWidth) {
          line = candidate;
          continue;
        }
        if (line) lines.push(line);
        // A single word wider than the column is broken by characters.
        line = "";
        for (const char of word) {
          if (line && measure(line + char, style) > maxWidth) {
            lines.push(line);
            line = "";
          }
          line += char;
        }
      }
      lines.push(line);
    }
    return lines;
  };

  const hrule = (x: number, y: number, ruleWidth: number, color: string) =>
    doc.rect(x, y, ruleWidth, RULE).fill(color);

  // A solid colour, or a left-to-right gradient when settings give an end colour.
  const accentFill = () => {
    if (!settings.accentColorEnd) return settings.accentColor;
    return doc.linearGradient(0, 0, pageWidth, 0).stop(0, settings.accentColor).stop(1, settings.accentColorEnd);
  };

  const addPage = () => {
    doc.addPage({ size: [pageWidth, pageHeight], margin: 0 });
    doc.rect(0, 0, pageWidth, 4).fill(accentFill());
    if (invoice.status === "draft") {
      const size = 150;
      doc.save();
      doc.rotate(-35, { origin: [pageWidth / 2, pageHeight / 2] });
      applyStyle({ weight: "semibold", size });
      doc.fillColor(BLACK, 0.05);
      const textWidth = doc.widthOfString("DRAFT");
      doc.text("DRAFT", pageWidth / 2 - textWidth / 2, pageHeight / 2 + (CAP_HEIGHT * size) / 2, {
        lineBreak: false,
        baseline: "alphabetic",
      });
      doc.restore();
    }
  };

  /* ---------- header ---------- */

  addPage();
  const titleWidth = write(invoice.kind === "receipt" ? "Receipt" : "Invoice", MARGIN, 48, { weight: "semibold", size: 18 });
  if (invoice.status === "draft") {
    const pill: Style = { weight: "semibold", size: 7.5, color: "#5C5C5C" };
    const pillWidth = measure("DRAFT", pill) + 12;
    const centre = 48 - (CAP_HEIGHT * 18) / 2;
    doc.roundedRect(MARGIN + titleWidth + 10, centre - 7.5, pillWidth, 15, 3).fill("#EFEFEF");
    write("DRAFT", MARGIN + titleWidth + 16, centre + (CAP_HEIGHT * 7.5) / 2, pill);
  }

  if (assets.logo) {
    const bytes = new Uint8Array(stripJpegMetadata(assets.logo));
    doc.image(bytes.buffer, right - LOGO_SIZE, 30, { fit: [LOGO_SIZE, LOGO_SIZE], align: "right" });
  }

  // Anything missing from the JSON is skipped, and the blocks below move up to close the gap.
  // `y` is always the baseline of the last line drawn.
  let y = 48;

  // Invoice number, dates and custom fields.
  if (invoice.meta.length > 0) {
    const labelWidth = Math.max(
      ...invoice.meta.map((row) => measure(row.label, { weight: row.strong ? "semibold" : "medium" })),
    );
    const valueX = MARGIN + labelWidth + (labelWidth > 0 ? 6.5 : 0);
    y += 30 - LINE;
    for (const row of invoice.meta) {
      const style: Style = { weight: row.strong ? "semibold" : "medium" };
      y += LINE;
      write(row.label, MARGIN, y, style);
      wrap(row.value, MARGIN + width * 0.6 - valueX, style).forEach((line, i) => {
        if (i > 0) y += LINE;
        write(line, valueX, y, style);
      });
    }
  }

  // Seller and customer columns, packed from the left.
  const columnWidth = width * 0.4;
  const contact = (party: Party) =>
    [...party.address, party.email, party.phone].filter((line): line is string => Boolean(line));
  const columns: { title?: string; party: Party; lines: string[] }[] = [];
  if (invoice.seller) columns.push({ title: invoice.seller.name, party: invoice.seller, lines: contact(invoice.seller) });
  if (invoice.billTo) {
    const { name } = invoice.billTo;
    columns.push({ title: "Bill to", party: invoice.billTo, lines: [...(name ? [name] : []), ...contact(invoice.billTo)] });
  }
  if (columns.length > 0) {
    const top = y + (invoice.meta.length > 0 ? 28.5 : 37.5);
    const ends = columns.map(({ title, party, lines }, column) => {
      const x = MARGIN + column * columnWidth;
      let last = top;
      if (title) {
        wrap(title, columnWidth - 12, { weight: "semibold" }).forEach((line, i) => {
          last = top + i * LINE;
          write(line, x, last, { weight: "semibold" });
        });
      }
      let next = last + 16.5;
      for (const text of lines) {
        for (const line of wrap(text, columnWidth - 12)) {
          write(line, x, next);
          last = next;
          next += LINE;
        }
      }
      for (const taxId of party.taxIds) {
        const typeWidth = taxId.type ? write(taxId.type, x, next) + 3.85 : 0;
        write(taxId.value, x + typeWidth, next);
        last = next;
        next += LINE;
      }
      return last;
    });
    y = Math.max(...ends);
  }

  // Amount due headline, payment link and memo.
  y += 39.75;
  write(invoice.headline, MARGIN, y, { weight: "semibold", size: 13.5 });
  if (invoice.payUrl) {
    y += 21.75;
    const linkWidth = write("Pay online", MARGIN, y, { weight: "semibold", color: settings.linkColor });
    hrule(MARGIN, y + 0.75, linkWidth, settings.linkColor);
    doc.link(MARGIN, y - 9, linkWidth, 11.25, invoice.payUrl);
  }
  if (invoice.memo) {
    y += 24 - LINE;
    for (const line of wrap(invoice.memo, width * 0.7)) {
      y += LINE;
      write(line, MARGIN, y);
    }
  }

  /* ---------- line items ---------- */

  // Numeric columns are sized to their content and laid out right to left, as in the reference.
  // The amount column also has to fit the totals below it.
  const snap = (n: number) => Math.ceil(n / 0.75 - 1e-6) * 0.75;
  const marker = (notes: number[]) => (notes.length ? `[${notes.join(",")}]` : "");
  const { items, hasQuantityColumn, hasTaxColumn } = invoice;
  const amountWidth = snap(
    Math.max(
      measure("Amount", SMALL),
      ...items.map((item) => measure(item.amount)),
      ...invoice.totals.map((row) => measure(row.value, { weight: row.strong ? "semibold" : "regular" })),
    ),
  );
  const taxRight = right - amountWidth - COLUMN_GAP;
  const taxWidth = hasTaxColumn
    ? snap(
        Math.max(
          measure("Tax", SMALL),
          ...items.map((item) => measure(item.tax) + measure(marker(item.taxNotes), MARKER)),
        ),
      )
    : 0;
  const unitRight = hasTaxColumn ? taxRight - taxWidth - COLUMN_GAP : taxRight;
  const unitWidth = snap(Math.max(measure("Unit price", SMALL), ...items.map((item) => measure(item.unitPrice))));
  const qtyRight = unitRight - unitWidth - COLUMN_GAP;
  const qtyWidth = hasQuantityColumn
    ? snap(Math.max(measure("Qty", SMALL), ...items.map((item) => measure(item.quantity))))
    : 0;
  const numbersLeft = hasQuantityColumn ? qtyRight - qtyWidth : unitRight - unitWidth;
  const descriptionWidth = Math.min(width / 2, numbersLeft - COLUMN_GAP - MARGIN);

  const drawTableHeader = (baseline: number) => {
    write("Description", MARGIN, baseline, SMALL);
    if (hasQuantityColumn) write("Qty", qtyRight, baseline, SMALL, "right");
    write("Unit price", unitRight, baseline, SMALL, "right");
    if (hasTaxColumn) write("Tax", taxRight, baseline, SMALL, "right");
    write("Amount", right, baseline, SMALL, "right");
    hrule(MARGIN, baseline + 7.5, width, BLACK);
    return baseline + 7.5 + RULE + 13.5;
  };

  let next = drawTableHeader(y + 39.75);
  let rowEnd = next;
  for (const item of items) {
    const lines = [item.description, ...item.details]
      .filter(Boolean)
      .flatMap((text) => wrap(text, descriptionWidth));
    if (lines.length === 0) lines.push("");
    let top = next;
    if (top + (lines.length - 1) * LINE > bottom) {
      addPage();
      top = drawTableHeader(CONTINUED_TOP);
    }
    lines.forEach((line, i) => write(line, MARGIN, top + i * LINE));
    if (item.quantity) write(item.quantity, qtyRight, top, {}, "right");
    write(item.unitPrice, unitRight, top, {}, "right");
    if (hasTaxColumn && item.tax) {
      const note = marker(item.taxNotes);
      const noteWidth = note ? measure(note, MARKER) : 0;
      write(item.tax, taxRight - noteWidth, top, {}, "right");
      if (note) write(note, taxRight - noteWidth, top - 5.25, MARKER);
    }
    write(item.amount, right, top, {}, "right");
    rowEnd = top + (lines.length - 1) * LINE;
    next = rowEnd + LINE + ITEM_GAP;
  }

  /* ---------- totals ---------- */

  const totalsX = MARGIN + width / 2;
  let ruleY = rowEnd + 18.75;
  if (ruleY + invoice.totals.length * 14.25 > bottom) {
    addPage();
    ruleY = CONTINUED_TOP - 10.5;
  }
  for (const row of invoice.totals) {
    const style: Style = { weight: row.strong ? "semibold" : "regular" };
    hrule(totalsX, ruleY, right - totalsX, HAIRLINE);
    write(row.label, totalsX, ruleY + 10.5, style);
    write(row.value, right, ruleY + 10.5, style, "right");
    ruleY += 14.25;
  }
  y = ruleY - 14.25 + 10.5;

  /* ---------- payment history (receipts) ---------- */

  // A small table like the line items: amounts and receipt numbers sized to their content from
  // the right, dates lined up with the totals when there is room, the method taking the rest.
  if (invoice.payments.length > 0) {
    const { payments } = invoice;
    const DETAILS_GAP = 11.25; // method baseline to its first line of small print
    const hasDate = payments.some((row) => row.date);
    const hasReceipt = payments.some((row) => row.receiptNumber);
    const receiptWidth = hasReceipt
      ? snap(Math.max(measure("Receipt number", SMALL), ...payments.map((row) => measure(row.receiptNumber))))
      : 0;
    const paidRight = hasReceipt ? right - receiptWidth - COLUMN_GAP : right;
    const paidLeft =
      paidRight - snap(Math.max(measure("Amount paid", SMALL), ...payments.map((row) => measure(row.amount))));
    const dateWidth = hasDate ? snap(Math.max(measure("Date", SMALL), ...payments.map((row) => measure(row.date)))) : 0;
    const dateX = Math.min(totalsX, paidLeft - COLUMN_GAP - dateWidth);
    const methodWidth = (hasDate ? dateX : paidLeft) - COLUMN_GAP - MARGIN;

    const rows = payments.map((row) => {
      const method = wrap(row.method, methodWidth);
      const details = row.details.flatMap((text) => wrap(text, methodWidth, SMALL));
      const methodDepth = (method.length - 1) * LINE;
      const depth = details.length > 0 ? methodDepth + DETAILS_GAP + (details.length - 1) * SMALL_LINE : methodDepth;
      return { ...row, method, details, methodDepth, depth };
    });

    const drawHeader = (baseline: number) => {
      write("Payment method", MARGIN, baseline, SMALL);
      if (hasDate) write("Date", dateX, baseline, SMALL);
      write("Amount paid", paidRight, baseline, SMALL, "right");
      if (hasReceipt) write("Receipt number", right, baseline, SMALL, "right");
      hrule(MARGIN, baseline + 7.5, width, BLACK);
      return baseline + 7.5 + RULE + 13.5;
    };

    // The heading stays with the header and first row.
    let title = y + 39.75;
    if (title + 36 + 21.75 + rows[0].depth > bottom) {
      addPage();
      title = CONTINUED_TOP;
    }
    write("Payment history", MARGIN, title, { weight: "semibold", size: 13.5 });
    let next = drawHeader(title + 36);
    let rowEnd = next;
    for (const row of rows) {
      let top = next;
      if (top + row.depth > bottom) {
        addPage();
        top = drawHeader(CONTINUED_TOP);
      }
      row.method.forEach((line, i) => write(line, MARGIN, top + i * LINE));
      row.details.forEach((line, i) =>
        write(line, MARGIN, top + row.methodDepth + DETAILS_GAP + i * SMALL_LINE, SMALL),
      );
      if (row.date) write(row.date, dateX, top);
      write(row.amount, paidRight, top, {}, "right");
      if (row.receiptNumber) write(row.receiptNumber, right, top, {}, "right");
      rowEnd = top + row.depth;
      next = rowEnd + LINE + ITEM_GAP;
    }
    y = rowEnd;
  }

  /* ---------- bank transfer details ---------- */

  // Small labels over their values, like the table header. As many columns as fit the page, each
  // as wide as its widest cell, so wrapped rows line up. Offsets are baselines from the title.
  if (invoice.bankAccount) {
    const LABEL_TO_VALUE = 12;
    const fields = invoice.bankAccount.map((row) => ({
      ...row,
      width: Math.min(width, Math.max(measure(row.label, SMALL), measure(row.value))),
    }));
    const columnWidths = (count: number) =>
      Array.from({ length: count }, (_, column) =>
        Math.max(...fields.filter((_, i) => i % count === column).map((field) => field.width)),
      );
    const fits = (count: number) => columnWidths(count).reduce((sum, w) => sum + w + COLUMN_GAP, -COLUMN_GAP) <= width;
    let count = fields.length;
    while (count > 1 && !fits(count)) count--;
    // Spread the fields evenly over the rows they need, rather than leaving one alone on the last.
    const balanced = Math.ceil(fields.length / Math.ceil(fields.length / count));
    if (fits(balanced)) count = balanced;
    const widths = columnWidths(count);

    const cells: { label: string; lines: string[]; x: number; top: number }[] = [];
    let top = 18;
    let depth = 0;
    fields.forEach((field, i) => {
      const column = i % count;
      if (column === 0 && i > 0) top = depth + 21;
      const x = MARGIN + widths.slice(0, column).reduce((sum, w) => sum + w + COLUMN_GAP, 0);
      const lines = measure(field.value) <= widths[column] ? [field.value] : wrap(field.value, widths[column]);
      cells.push({ label: field.label, lines, x, top });
      depth = Math.max(depth, top + LABEL_TO_VALUE + (lines.length - 1) * LINE);
    });

    let title = y + 39.75;
    if (title + depth > bottom) {
      addPage();
      title = CONTINUED_TOP;
    }
    write("Pay by bank transfer", MARGIN, title, { weight: "semibold" });
    for (const cell of cells) {
      write(cell.label, cell.x, title + cell.top, SMALL);
      cell.lines.forEach((line, i) => write(line, cell.x, title + cell.top + LABEL_TO_VALUE + i * LINE));
    }
    y = title + depth;
  }

  /* ---------- footnotes and footer text ---------- */

  y += 43.5;
  const writeSmall = (text: string) => {
    for (const line of wrap(text, width, SMALL)) {
      if (y > bottom) {
        addPage();
        y = CONTINUED_TOP;
      }
      write(line, MARGIN, y, SMALL);
      y += SMALL_LINE;
    }
  };
  invoice.footnotes.forEach(writeSmall);
  if (invoice.footer) {
    if (invoice.footnotes.length > 0) y += SMALL_LINE;
    writeSmall(invoice.footer);
  }

  /* ---------- page footers ---------- */

  const { start, count } = doc.bufferedPageRange();
  for (let i = 0; i < count; i++) {
    doc.switchToPage(start + i);
    hrule(MARGIN, footerRuleY, width, HAIRLINE);
    write(`Page ${i + 1} of ${count}`, right, pageHeight - 38, SMALL, "right");
    if (count > 1) {
      write([invoice.number, invoice.headline].filter(Boolean).join(" · "), MARGIN, pageHeight - 38, SMALL);
    }
  }

  for (const key of Object.keys(doc.info) as (keyof PDFKit.DocumentInfo)[]) delete doc.info[key];
  doc.end();
  return done;
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
