import { useEffect, useState } from "react";

/** Device pixels per PDF point; 2.5 keeps text crisp on high-DPI screens at up to ~800px wide. */
const RENDER_SCALE = 2.5;

async function renderPages(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  // pdf.js takes ownership of the buffer it is given, so hand it a copy.
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const pdf = await task.promise;
    const urls: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob) urls.push(URL.createObjectURL(blob));
    }
    return urls;
  } finally {
    await task.destroy();
  }
}

/** Shows the generated PDF itself, so the preview is exactly what gets downloaded. */
export function PdfPreview({ bytes, label }: { bytes: Uint8Array; label: string }) {
  const [pages, setPages] = useState<{ bytes: Uint8Array; urls: string[] }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    renderPages(bytes)
      .then((urls) => {
        if (cancelled) return urls.forEach((url) => URL.revokeObjectURL(url));
        setPages({ bytes, urls });
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  // Release the previous page images once they have been replaced.
  useEffect(() => () => pages?.urls.forEach((url) => URL.revokeObjectURL(url)), [pages]);

  if (error) {
    return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-800">Preview failed: {error}</p>;
  }

  const stale = pages?.bytes !== bytes;
  return (
    <div className={`flex flex-col items-center gap-6 transition-opacity ${stale && pages ? "opacity-60" : ""}`}>
      {pages ? (
        pages.urls.map((url, i) => (
          <img
            key={url}
            src={url}
            alt={`${label}, page ${i + 1} of ${pages.urls.length}`}
            className="block w-full max-w-[816px] rounded-[3px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.06)]"
          />
        ))
      ) : (
        <div className="aspect-[612/792] w-full max-w-[816px] animate-pulse rounded-[3px] bg-white/70" />
      )}
    </div>
  );
}
