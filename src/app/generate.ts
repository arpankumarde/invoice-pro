import regularUrl from "../assets/fonts/Inter-Regular.ttf?url";
import mediumUrl from "../assets/fonts/Inter-Medium.ttf?url";
import semiboldUrl from "../assets/fonts/Inter-SemiBold.ttf?url";
import type { ResolvedDocument } from "../invoice/types.ts";
import type { RenderAssets } from "../pdf/render.ts";

async function fetchBytes(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

let fonts: Promise<RenderAssets["fonts"]> | undefined;
function loadFonts() {
  fonts ??= Promise.all([fetchBytes(regularUrl), fetchBytes(mediumUrl), fetchBytes(semiboldUrl)])
    .then(([regular, medium, semibold]) => ({ regular, medium, semibold }))
    .catch((error: unknown) => {
      fonts = undefined;
      throw error;
    });
  return fonts;
}

/** Builds the PDF in the browser. pdfkit is loaded on first use to keep the page light. */
export async function generatePdf(invoice: ResolvedDocument, images: Record<string, string>) {
  const logoUrl = invoice.logo ? images[invoice.logo] : undefined;
  const [{ renderPdf }, loadedFonts, logo] = await Promise.all([
    import("../pdf/render.ts"),
    loadFonts(),
    logoUrl ? fetchBytes(logoUrl) : undefined,
  ]);
  return renderPdf(invoice, { fonts: loadedFonts, logo });
}

export function downloadPdf(bytes: Uint8Array<ArrayBuffer>, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
