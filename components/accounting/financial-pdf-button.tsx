"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FinancialReportExport } from "@/lib/accounting/financial-report-export";

export function FinancialPdfButton({ report }: { report: FinancialReportExport }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    setBusy(true); setError("");
    try {
      const { financialReportPdf } = await import("@/lib/accounting/financial-report-pdf");
      const text = JSON.stringify(report);
      let unicodeFont: Uint8Array | undefined;
      if (/[^\x20-\x7e]/.test(text)) {
        const response = await fetch("/fonts/NotoSansSC-Regular.ttf");
        if (!response.ok) throw new Error("The report font could not be loaded. Please retry.");
        unicodeFont = new Uint8Array(await response.arrayBuffer());
      }
      const { bytes } = await financialReportPdf(report, new Date(), unicodeFont);
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = report.warnings.length ? report.filename.replace(/\.pdf$/, "_DRAFT.pdf") : report.filename;
      document.body.appendChild(link);
      link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "PDF could not be generated. Please retry.");
    } finally { setBusy(false); }
  }
  return <div className="max-w-xl space-y-2">
    <Button type="button" variant="outline" disabled={busy} onClick={download}>
      <Download aria-hidden="true" className="h-4 w-4" />{busy ? "Preparing PDF..." : report.warnings.length ? "Download draft PDF" : "Export PDF"}
    </Button>
    {report.warnings.length ? <div role="alert" className="text-xs text-amber-900"><strong>Review required — export is marked DRAFT.</strong>{report.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
  </div>;
}
