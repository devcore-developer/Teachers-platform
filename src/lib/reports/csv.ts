/* ------------------------------------------------------------------ */
/* Batch 2 — CSV serialization with the ORIGINAL platform's format:     */
/* UTF-8 BOM (so Excel opens Arabic correctly), CRLF line endings and   */
/* RFC-4180 quoting — byte-compatible with the HTML v11Csv/v13 exports. */
/* ------------------------------------------------------------------ */

function escapeCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

/** Serialize rows to the exact original CSV dialect (BOM included). */
export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const body = rows
    .map((row) => row.map(escapeCell).join(","))
    .join("\r\n");
  return `\uFEFF${body}`;
}

/** Response headers for a CSV/JSON file download (Arabic filename safe). */
export function downloadHeaders(filename: string, mime: string): Headers {
  const headers = new Headers();
  headers.set(
    "Content-Disposition",
    `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  headers.set("Content-Type", `${mime}; charset=utf-8`);
  headers.set("Cache-Control", "no-store");
  return headers;
}