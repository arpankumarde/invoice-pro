/**
 * pdfkit embeds JPEGs byte-for-byte, so EXIF (camera, GPS, timestamps), XMP and comments
 * would end up inside the PDF. Keep only the segments needed to decode the image.
 * PNGs need no treatment: pdfkit re-encodes their pixels and drops every text chunk.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;

  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xda) {
      // Start of scan: everything from here on is image data.
      kept.push(bytes.subarray(i));
      return concat(kept);
    }
    const end = i + 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
    const isApp = marker >= 0xe0 && marker <= 0xef;
    // APP0 (JFIF) and APP14 (Adobe colour transform) affect decoding; other APPn and COM do not.
    const drop = (isApp && marker !== 0xe0 && marker !== 0xee) || marker === 0xfe;
    if (!drop) kept.push(bytes.subarray(i, end));
    i = end;
  }
  // Unexpected structure: hand back the original rather than a broken image.
  return bytes;
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
