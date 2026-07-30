"use client";

import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  FileImage,
  FileText,
  Paperclip,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type DocumentKind = "receipt" | "a4_invoice";

const acceptedTypes =
  "image/jpeg,image/png,image/webp,application/pdf";
const maxPreparedFileSize = 3 * 1024 * 1024;

const pickerClassName =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-[#d7dde5] bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-within:outline-none focus-within:ring-2 focus-within:ring-[#b8892c] focus-within:ring-offset-2";

export function ClaimDocumentUpload() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraFallbackRef = useRef<HTMLInputElement>(null);
  const filePickerRef = useRef<HTMLInputElement>(null);
  const submissionInputRef = useRef<HTMLInputElement>(null);
  const [documentKind, setDocumentKind] =
    useState<DocumentKind>("receipt");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const [preparingFile, setPreparingFile] = useState(false);
  const [cameraKind, setCameraKind] = useState<DocumentKind | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");

  useEffect(() => {
    if (!selectedFile || !selectedFile.type.startsWith("image/")) {
      setPreviewUrl("");
      return;
    }

    const nextUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [selectedFile]);

  useEffect(() => {
    const video = videoRef.current;
    const stream = cameraStreamRef.current;
    if (!cameraReady || !video || !stream) return;

    video.srcObject = stream;
    void video.play().catch(() => {
      setCameraError(
        "The camera preview could not start. Check your browser camera permission.",
      );
    });
  }, [cameraReady]);

  useEffect(
    () => () => {
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  async function prepareImage(file: File) {
    if (file.size <= maxPreparedFileSize) return file;

    const imageUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const nextImage = new Image();
        nextImage.onload = () => resolve(nextImage);
        nextImage.onerror = () => reject(new Error("image_decode"));
        nextImage.src = imageUrl;
      });

      const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
      const scale = Math.min(1, 2200 / longestSide);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("image_canvas");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      let quality = 0.86;
      let blob: Blob | null = null;
      do {
        blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", quality),
        );
        quality -= 0.08;
      } while (blob && blob.size > maxPreparedFileSize && quality >= 0.46);

      if (!blob || blob.size > maxPreparedFileSize) {
        throw new Error("image_size");
      }

      const baseName = file.name.replace(/\.[^.]+$/, "") || "document";
      return new File([blob], `${baseName}.jpg`, {
        lastModified: file.lastModified,
        type: "image/jpeg",
      });
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }

  async function selectFile(file: File | undefined, kind: DocumentKind) {
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError("The document must be 10 MB or smaller.");
      return;
    }

    setPreparingFile(true);
    setError("");
    try {
      let preparedFile = file;
      if (file.type.startsWith("image/")) {
        preparedFile = await prepareImage(file);
      } else if (
        file.type === "application/pdf" &&
        file.size > maxPreparedFileSize
      ) {
        throw new Error("pdf_size");
      }

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(preparedFile);
      if (submissionInputRef.current) {
        submissionInputRef.current.files = dataTransfer.files;
      }

      setDocumentKind(kind);
      setSelectedFile(preparedFile);
    } catch (nextError) {
      setSelectedFile(null);
      if (submissionInputRef.current) submissionInputRef.current.value = "";
      setError(
        nextError instanceof Error && nextError.message === "pdf_size"
          ? "PDF documents must be 3 MB or smaller. Please choose a smaller PDF or scan the page as an image."
          : "This image could not be prepared for upload. Please take the photo again.",
      );
    } finally {
      setPreparingFile(false);
    }
  }

  function stopCamera() {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
    setCameraKind(null);
    setCameraError("");
  }

  async function startCamera(kind: DocumentKind) {
    setCameraKind(kind);
    setCameraReady(false);
    setCameraError("");

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        "Live camera is not available in this browser. Use Open camera below.",
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          height: { ideal: 1920 },
          width: { ideal: 1080 },
        },
      });
      cameraStreamRef.current = stream;
      setCameraReady(true);
    } catch {
      setCameraError(
        "Camera permission was blocked. Allow camera access for dekez.vercel.app, or use Open camera below.",
      );
    }
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || !cameraKind || !video.videoWidth || !video.videoHeight) {
      setCameraError("The camera is still starting. Please try again.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("The photo could not be captured. Please try again.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraError("The photo could not be captured. Please try again.");
          return;
        }

        const kind = cameraKind;
        const file = new File(
          [blob],
          `${kind === "a4_invoice" ? "invoice" : "receipt"}-${Date.now()}.jpg`,
          { type: "image/jpeg" },
        );
        void selectFile(file, kind);
        stopCamera();
      },
      "image/jpeg",
      0.92,
    );
  }

  function clearFile() {
    setSelectedFile(null);
    setError("");
    if (submissionInputRef.current) submissionInputRef.current.value = "";
    if (cameraFallbackRef.current) cameraFallbackRef.current.value = "";
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
        <button
          className={pickerClassName}
          onClick={() => void startCamera("receipt")}
          type="button"
        >
          <Camera className="h-4 w-4" />
          Scan receipt
        </button>
        <button
          className={pickerClassName}
          onClick={() => void startCamera("a4_invoice")}
          type="button"
        >
          <FileText className="h-4 w-4" />
          Scan A4 invoice
        </button>
        <label className={pickerClassName}>
          <FileImage className="h-4 w-4" />
          Choose file
          <input
            accept={acceptedTypes}
            className="sr-only"
            onChange={(event) =>
              void selectFile(event.target.files?.[0], documentKind)
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
          {preparingFile
            ? "Preparing document for fast upload…"
            : "No document selected. Images may be up to 10 MB and are optimized automatically. PDFs may be up to 3 MB."}
        </div>
      )}

      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

      {cameraKind ? (
        <div
          aria-label="Document camera scanner"
          aria-modal="true"
          className="fixed inset-0 z-[100] flex flex-col bg-black"
          role="dialog"
        >
          <div className="flex items-center justify-between bg-black/90 px-4 py-3 text-white">
            <div>
              <p className="font-semibold">
                {cameraKind === "a4_invoice"
                  ? "Scan A4 invoice"
                  : "Scan receipt"}
              </p>
              <p className="text-xs text-gray-300">
                Place the whole document inside the frame.
              </p>
            </div>
            <button
              aria-label="Close camera"
              className="rounded-full p-2 hover:bg-white/10"
              onClick={stopCamera}
              type="button"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
            {cameraReady ? (
              <>
                <video
                  autoPlay
                  className="h-full w-full object-contain"
                  muted
                  playsInline
                  ref={videoRef}
                />
                <div
                  className={`pointer-events-none absolute border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.28)] ${
                    cameraKind === "a4_invoice"
                      ? "aspect-[210/297] h-[76%]"
                      : "h-[72%] w-[84%]"
                  }`}
                />
              </>
            ) : (
              <div className="max-w-sm px-6 text-center text-white">
                <CameraOff className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-4 text-sm">
                  {cameraError || "Starting rear camera…"}
                </p>
              </div>
            )}
          </div>

          <div className="grid gap-3 bg-black/90 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {cameraReady ? (
              <button
                className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-white/25"
                onClick={capturePhoto}
                type="button"
              >
                <span className="h-12 w-12 rounded-full bg-white" />
                <span className="sr-only">Capture document</span>
              </button>
            ) : null}
            <label className="relative mx-auto inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-white/50 px-4 text-sm font-medium text-white">
              <Camera className="h-4 w-4" />
              Open camera
              <input
                accept="image/*"
                capture="environment"
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={(event) => {
                  const kind = cameraKind;
                  if (!kind) return;
                  void selectFile(event.target.files?.[0], kind);
                  stopCamera();
                }}
                ref={cameraFallbackRef}
                type="file"
              />
            </label>
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}
