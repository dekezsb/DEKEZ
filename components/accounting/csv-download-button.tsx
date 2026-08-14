"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

function csvCell(value: string | number) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function CsvDownloadButton({
  fileName,
  label,
  rows,
}: {
  fileName: string;
  label: string;
  rows: Array<Array<string | number>>;
}) {
  function download() {
    const content = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  return <Button onClick={download} type="button" variant="outline"><Download className="h-4 w-4" />{label}</Button>;
}
