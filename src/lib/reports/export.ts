/**
 * Phase 10 — report export builders.
 *
 * Formats (all rendered from the SAME buildReport() dataset the screen
 * shows — no separate data path, no silent fallback to empty files):
 *   • CSV        — UTF-8 with BOM (Arabic opens correctly in Excel),
 *                  CRLF rows, RFC-quoted cells, formula-injection guard.
 *   • Excel XML  — SpreadsheetML 2003 (.xls): preserves Arabic, right-to
 *                  -left sheet, styled header, meta rows. No new deps.
 *   • Print/PDF  — the print view page uses the browser print engine
 *                  (native Arabic shaping + @page A4) — see
 *                  /reports/[reportId]/print.
 *
 * Formula-injection mitigation (OWASP): text cells starting with =, +,
 * - or @ are prefixed with a single quote so spreadsheet engines treat
 * them as text. Numeric cells produced by the report builders are never
 * escaped (they are typed numbers, not user input).
 */

import type { ReportCellValue, ReportColumn, ReportData } from "@/lib/reports/service";
import { EXPORT_ROW_LIMIT } from "@/config/analytics";

/* ------------------------------------------------------------------ */
/* Cell handling                                                        */
/* ------------------------------------------------------------------ */

/** Leading =, +, - or @ is how spreadsheet engines start a formula. */
const FORMULA_LEAD = /^[=+@\-]/;

export function isUnsafeFormulaText(value: string): boolean {
  return value.length > 0 && FORMULA_LEAD.test(value);
}

/** Neutralizes spreadsheet formula injection for TEXT cells. */
export function escapeCsvCell(raw: string): string {
  const neutralized = isUnsafeFormulaText(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cellString(value: ReportCellValue): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

/* ------------------------------------------------------------------ */
/* CSV                                                                  */
/* ------------------------------------------------------------------ */

export function buildReportCsv(report: ReportData): string {
  const lines: string[] = [];
  // Meta header (Arabic preserved; generatedAt is ISO for tooling).
  lines.push(escapeCsvCell(report.meta.titleAr));
  lines.push(
    escapeCsvCell(
      [
        report.meta.schoolName ? `المدرسة: ${report.meta.schoolName}` : null,
        report.meta.branchName ? `الفرع: ${report.meta.branchName}` : null,
        report.meta.dateRangeLabel ? `الفترة: ${report.meta.dateRangeLabel}` : null,
        `تاريخ التوليد: ${report.meta.generatedAt.toISOString()}`,
      ]
        .filter((part) => part !== null)
        .join(" | ")
    )
  );
  lines.push("");

  if (report.columns.length > 0) {
    lines.push(report.columns.map((column) => escapeCsvCell(column.label)).join(","));
    const limited = report.rows.slice(0, EXPORT_ROW_LIMIT);
    for (const row of limited) {
      lines.push(
        report.columns
          .map((column) => {
            const value = row.values[column.key] ?? null;
            if (typeof value === "number") return String(value);
            return escapeCsvCell(cellString(value));
          })
          .join(",")
      );
    }
    if (report.rows.length > EXPORT_ROW_LIMIT) {
      lines.push(escapeCsvCell(`تنبيه: تم اقتصار الملف على أول ${EXPORT_ROW_LIMIT} صفًا من ${report.rows.length}.`));
    }
  }

  if (report.sections) {
    for (const section of report.sections) {
      lines.push("");
      lines.push(escapeCsvCell(section.titleAr));
      for (const item of section.items) {
        lines.push(`${escapeCsvCell(item.label)},${escapeCsvCell(item.value)}`);
        if (item.note) lines.push(escapeCsvCell(`ملاحظة: ${item.note}`));
      }
      if (section.note) lines.push(escapeCsvCell(section.note));
    }
  }

  // BOM first so Excel detects UTF-8 Arabic.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/* ------------------------------------------------------------------ */
/* SpreadsheetML (Excel-compatible .xls)                                */
/* ------------------------------------------------------------------ */

function xmlCell(value: ReportCellValue, columnType: ReportColumn["type"]): string {
  if (typeof value === "number") {
    return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  const text = escapeXmlText(cellString(value));
  if (
    columnType === "percent" &&
    typeof value === "string" &&
    value.trim() !== "" &&
    !Number.isNaN(Number(value))
  ) {
    return `<Cell><Data ss:Type="Number">${Number(value)}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${text}</Data></Cell>`;
}

export function buildReportExcelXml(report: ReportData): string {
  const rows: string[] = [];
  const titleCell = (text: string, bold = false) =>
    `<Cell ss:StyleID="${bold ? "header" : "meta"}"><Data ss:Type="String">${escapeXmlText(text)}</Data></Cell>`;

  rows.push(`<Row>${titleCell(report.meta.titleAr, true)}</Row>`);
  const metaParts = [
    report.meta.schoolName ? `المدرسة: ${report.meta.schoolName}` : null,
    report.meta.branchName ? `الفرع: ${report.meta.branchName}` : null,
    report.meta.scopeNote,
    report.meta.dateRangeLabel ? `الفترة: ${report.meta.dateRangeLabel}` : null,
    `تاريخ التوليد: ${report.meta.generatedAt.toISOString()}`,
  ].filter((part) => part !== null);
  rows.push(`<Row>${titleCell(metaParts.join(" — "))}</Row>`);
  rows.push(`<Row></Row>`);

  if (report.columns.length > 0) {
    rows.push(
      `<Row>${report.columns
        .map((column) => `<Cell ss:StyleID="header"><Data ss:Type="String">${escapeXmlText(column.label)}</Data></Cell>`)
        .join("")}</Row>`
    );
    const limited = report.rows.slice(0, EXPORT_ROW_LIMIT);
    for (const row of limited) {
      rows.push(
        `<Row>${report.columns.map((column) => xmlCell(row.values[column.key] ?? null, column.type)).join("")}</Row>`
      );
    }
    if (report.rows.length > EXPORT_ROW_LIMIT) {
      rows.push(
        `<Row>${titleCell(`تنبيه: تم اقتصار الملف على أول ${EXPORT_ROW_LIMIT} صفًا من ${report.rows.length}.`)}</Row>`
      );
    }
  }

  if (report.sections) {
    for (const section of report.sections) {
      rows.push(`<Row></Row>`);
      rows.push(`<Row>${titleCell(section.titleAr, true)}</Row>`);
      rows.push(`<Row>${titleCell("البند")}<Cell><Data ss:Type="String">القيمة</Data></Cell></Row>`);
      for (const item of section.items) {
        rows.push(
          `<Row>${titleCell(item.label)}<Cell><Data ss:Type="String">${escapeXmlText(item.value)}</Data></Cell></Row>`
        );
        if (item.note) {
          rows.push(`<Row>${titleCell(`ملاحظة: ${item.note}`)}</Row>`);
        }
      }
      if (section.note) {
        rows.push(`<Row>${titleCell(section.note)}</Row>`);
      }
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="header">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1D5BD6" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="meta">
   <Font ss:Color="#334155"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${escapeXmlText(report.meta.titleAr.slice(0, 28))}">
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <DisplayRightToLeft/>
  </WorksheetOptions>
  <Table>
   ${rows.join("\n   ")}
  </Table>
 </Worksheet>
</Workbook>`;
}

/* ------------------------------------------------------------------ */
/* Download filename helpers                                            */
/* ------------------------------------------------------------------ */

/** ASCII fallback + RFC 5987 UTF-8 name so Arabic filenames survive. */
export function contentDispositionFor(filenameBase: string, extension: string): string {
  const ascii = `report-${new Date().toISOString().slice(0, 10)}.${extension}`;
  const encoded = encodeURIComponent(`${filenameBase}.${extension}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}