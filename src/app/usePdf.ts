import { useEffect, useState } from "react";
import type { ResolvedDocument } from "../invoice/types.ts";
import { generatePdf } from "./generate.ts";

/** Builds the PDF for an invoice or receipt whenever it changes. */
export function usePdf(invoice: ResolvedDocument | undefined, images: Record<string, string>) {
  const [result, setResult] = useState<{ invoice: ResolvedDocument; bytes?: Uint8Array<ArrayBuffer>; error?: string }>();

  useEffect(() => {
    if (!invoice) return;
    let cancelled = false;
    generatePdf(invoice, images).then(
      (bytes) => !cancelled && setResult({ invoice, bytes }),
      (reason: unknown) =>
        !cancelled && setResult({ invoice, error: reason instanceof Error ? reason.message : String(reason) }),
    );
    return () => {
      cancelled = true;
    };
  }, [invoice, images]);

  const current = result?.invoice === invoice ? result : undefined;
  return {
    /** Bytes for the invoice as it is now; undefined while regenerating. */
    bytes: current?.bytes,
    /** Most recent render of the same invoice, kept on screen while the next one is built. */
    previewBytes: invoice && result?.invoice.id === invoice.id ? result.bytes : undefined,
    error: current?.error,
  };
}
