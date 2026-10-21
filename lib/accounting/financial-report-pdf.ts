import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { FinancialReportExport, ReportPrintRow } from "./financial-report-export";

// Render an already-authorised screen snapshot. Deliberately no accounting
// service or database access: generating a file has zero financial side effects.
export async function financialReportPdf(report: FinancialReportExport, generatedAt: Date, unicodeFont?: Uint8Array) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.registerFontkit(fontkit);
  const unicode = unicodeFont ? await pdf.embedFont(unicodeFont, { subset: false }) : null;
  const unicodeCharacters = unicode ? new Set(unicode.getCharacterSet()) : null;
  const clean = (text: string) => text.replace(/\r/g, "").replace(/\t/g, " ").replace(/[\u2010-\u2015]/g, "-");
  const fontFor = (text: string, strong = false) => /[^\x20-\x7e]/.test(text) ? unicode ?? regular : strong ? bold : regular;
  const measure = (text: string, size: number, strong = false) => fontFor(text, strong).widthOfTextAtSize(text, size);
  const wrap = (text: string, width: number, size: number, strong = false) => {
    const lines: string[] = [];
    for (const paragraph of clean(text).split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (measure(next, size, strong) <= width) { line = next; continue; }
        if (line) lines.push(line);
        line = "";
        // Long tokens/CJK names must wrap rather than cross the numeric columns.
        for (const char of word) {
          if (line && measure(line + char, size, strong) > width) { lines.push(line); line = ""; }
          line += char;
        }
      }
      lines.push(line);
    }
    return lines;
  };
  const width = 595.28, height = 841.89, margin = 40, bottom = 62, body = 515;
  let page: PDFPage, y = 0;
  const draft = report.warnings.length > 0;
  const draw = (text: string, x: number, baseline: number, size = 9, strong = false) => {
    const value = clean(text);
    if (/[^\x20-\x7e]/.test(value) && unicodeCharacters) {
      for (const character of value) {
        if (!unicodeCharacters.has(character.codePointAt(0)!)) throw new Error(`The report font does not support "${character}". Please review this character before exporting.`);
      }
    }
    page.drawText(value, { x, y: baseline, size, font: fontFor(value, strong), color: rgb(.08, .08, .08) });
  };
  const rule = () => page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: .5, color: rgb(.6, .6, .6) });
  function newPage() {
    page = pdf.addPage([width, height]); y = height - margin;
    if (pdf.getPageCount() > 1) {
      draw(report.company.name, margin, y, 10, true); y -= 17;
      draw(`${report.title}${draft ? " - DRAFT / REVIEW REQUIRED" : ""}`, margin, y, 9); y -= 14;
      rule(); y -= 17;
    }
  }
  function paragraph(value: string, size = 9, strong = false) {
    for (const line of wrap(value, body, size, strong)) {
      if (y - size - 5 < bottom) newPage();
      draw(line, margin, y, size, strong); y -= size + 5;
    }
    y -= 5;
  }
  const rowLines = (cells: string[], strong: boolean, section = false) =>
    cells.map((value, i) => wrap(value, (section ? body : report.widths[i]) - 12, 9, strong));
  const rowHeight = (row: ReportPrintRow) => Math.max(...rowLines(row.cells, Boolean(row.kind), row.kind === "section").map((lines) => lines.length)) * 13 + 12;
  function renderRow(cells: string[], strong = false, section = false, header = false) {
    const lines = rowLines(cells, strong, section);
    const h = Math.max(...lines.map((column) => column.length)) * 13 + 12;
    if (strong) page.drawRectangle({ x: margin, y: y - h, width: body, height: h, color: rgb(.94, .94, .94) });
    let x = margin;
    lines.forEach((column, i) => {
      const cellWidth = section ? body : report.widths[i];
      column.forEach((line, j) => draw(line, !section && i >= 2 ? x + cellWidth - 6 - measure(line, 9, strong) : x + 6, y - 15 - j * 13, 9, strong));
      x += cellWidth;
    });
    y -= h;
    if (!section || header) rule();
  }
  function tablePage() { newPage(); renderRow(report.columns, true, false, true); }

  newPage();
  paragraph(report.company.name, 17, true);
  if (report.company.registration) paragraph(`Company registration no.: ${report.company.registration}`, 9);
  if (report.company.address) paragraph(report.company.address, 9);
  y -= 4; paragraph(report.title, 15, true);
  paragraph(report.period, 10);
  paragraph(`Scope: ${report.scope}`, 9);
  const generatedDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(generatedAt);
  paragraph(`Generated on: ${generatedDate} (Malaysia time)`, 9);
  if (draft) paragraph("DRAFT - REVIEW REQUIRED / NOT FINAL", 11, true);
  for (const warning of report.warnings) paragraph(warning, 9, true);
  for (const note of report.notes) paragraph(note, 8);
  y -= 5;
  if (y - 70 < bottom) newPage();
  renderRow(report.columns, true, false, true);
  for (const [index, row] of report.rows.entries()) {
    const h = rowHeight(row);
    if (h > 650) throw new Error("An account row is too long to print safely. Shorten its display label before exporting.");
    // Keep section headings with a row and ordinary last rows with their total.
    let following = 0;
    for (let next = index + 1; next < report.rows.length; next++) {
      const candidate = report.rows[next];
      if ((row.kind === "section" && next === index + 1) || candidate.kind === "total" || candidate.kind === "final") following += rowHeight(candidate);
      else break;
    }
    // A group larger than a fresh page must still break safely by whole row.
    if (y - h - Math.min(following, Math.max(0, 650 - h)) < bottom) tablePage();
    renderRow(row.cells, Boolean(row.kind), row.kind === "section");
  }
  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    page = p;
    draw(report.company.name, margin, 40, 8, true);
    draw(`Page ${index + 1} of ${pages.length}`, width - margin - 65, 40, 8);
    draw(`System Generated Financial Report - ${draft ? "DRAFT / review required" : "Prepared for audit/review purposes"}`, margin, 26, 8);
  });
  pdf.setTitle(`${report.title}${draft ? " - DRAFT" : ""}`);
  pdf.setAuthor(report.company.name);
  pdf.setSubject(`${report.period}; ${report.scope}`);
  pdf.setCreationDate(generatedAt);
  return { bytes: await pdf.save(), pages: pages.length };
}
