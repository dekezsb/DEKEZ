"use client";

import { useEffect, useRef, useState } from "react";
import {
  Camera,
  FileImage,
  FileText,
  Paperclip,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type DocumentKind = "receipt" | "a4_invoice";

const acceptedTypes =
  "image/jpeg,image/png,image/webp,application/pdf";

const pickerClassName =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-[#d7dde5] bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-within:outline-none focus-within:ring-2 focus-within:ring-[#b8892c] focus-within:ring-offset-2";

export function ClaimDocumentUpload() {
  const receiptCameraRef = useRef<HTMLInputElement>(null);
  const invoiceCameraRef = useRef<HTMLInputElement>(null);
  const filePickerRef = useRef<HTMLInputElement>(null);
  const submissionInputRef = useRef<HTMLInputElement>(null);
  const [documentKind, setDocumentKind] =
    useState<DocumentKind>("receipt");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedFile || !selectedFile.type.startsWith("image/")) {
      setPreviewUrl("");
      return;
    }

    const nextUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [selectedFile]);

  function selectFile(file: File | undefined, kind: DocumentKind) {
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError("The document must be 10 MB or smaller.");
      return;
    }

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    if (submissionInputRef.current) {
      submissionInputRef.current.files = dataTransfer.files;
    }

    setDocumentKind(kind);
    setSelectedFile(file);
    setError("");
  }

  function clearFile() {
    setSelectedFile(null);
    setError("");
    if (submissionInputRef.current) submissionInputRef.current.value = "";
    if (receiptCameraRef.current) receiptCameraRef.current.value = "";
    if (invoiceCameraRef.current) invoiceCameraRef.current.value = "";
    if (filePickerRef.current) filePickerRef.current.value = "";
  }

  return (
    <fieldset className="lg:col-span-2">
      <legend className="text-sm font-medium text-gray-700">
        Receipt or invoice *
      </legend>
      <p className="mt-1 text-xs text-gray-500">
        Photograph a receipt, scan a full A4 invoice, or choose an existing
        image/PDF.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label className={pickerClassName}>
          <Camera className="h-4 w-4" />
          Scan receipt
          <input
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(event) =>
              selectFile(event.target.files?.[0], "receipt")
            }
            ref={receiptCameraRef}
            type="file"
          />
        </label>
        <label className={pickerClassName}>
          <FileText className="h-4 w-4" />
          Scan A4 invoice
          <input
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(event) =>
              selectFile(event.target.files?.[0], "a4_invoice")
            }
            ref={invoiceCameraRef}
            type="file"
          />
        </label>
        <label className={pickerClassName}>
          <FileImage className="h-4 w-4" />
          Choose file
          <input
            accept={acceptedTypes}
            className="sr-only"
            onChange={(event) =>
              selectFile(event.target.files?.[0], documentKind)
            }
            ref={filePickerRef}
            type="file"
          />
        </label>
      </div>

      <input
        className="sr-only"
        name="receipt"
        ref={submissionInputRef}
        required
        tabIndex={-1}
        type="file"
      />
      <input name="attachmentKind" type="hidden" value={documentKind} />

      {selectedFile ? (
        <div className="mt-3 rounded-md border border-[#d7dde5] bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Paperclip className="h-4 w-4 shrink-0 text-[#9a6b12]" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-gray-500">
                  {documentKind === "a4_invoice"
                    ? "A4 invoice"
                    : "Receipt"}{" "}
                  · {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            </div>
            <Button onClick={clearFile} size="sm" type="button" variant="ghost">
              <RotateCcw className="h-4 w-4" />
              Replace
            </Button>
          </div>

          {previewUrl ? (
            <div
              className={`mt-3 overflow-hidden rounded-md border bg-[#f4f6f8] ${
                documentKind === "a4_invoice"
                  ? "mx-auto aspect-[210/297] max-h-[32rem] max-w-sm"
                  : "max-h-80"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={`${documentKind === "a4_invoice" ? "A4 invoice" : "Receipt"} preview`}
                className="h-full w-full object-contain"
                src={previewUrl}
              />
            </div>
          ) : (
            <div className="mt-3 flex min-h-28 items-center justify-center rounded-md border bg-[#f4f6f8] text-sm text-gray-600">
              <FileText className="mr-2 h-5 w-5" />
              PDF ready to submit
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-dashed border-[#b98a2c] bg-[#fffaf0] px-3 py-4 text-center text-sm text-gray-600">
          No document selected. Images and PDFs may be up to 10 MB.
        </div>
      )}

      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </fieldset>
  );
}
