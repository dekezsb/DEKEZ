import { createHash } from "node:crypto";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

export const CHAT_FILE_LIMIT = 3 * 1024 * 1024;
export const CHAT_BUCKET = "dekez-chat-files";
export const validId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export async function boundedBytes(request: Request): Promise<Buffer> {
  if (Number(request.headers.get("content-length") ?? 0) > CHAT_FILE_LIMIT) throw new Error("File exceeds 3 MB.");
  const reader = request.body?.getReader(); if (!reader) throw new Error("Choose a file.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > CHAT_FILE_LIMIT) { await reader.cancel(); throw new Error("File exceeds 3 MB."); }
    chunks.push(value);
  }
  if (!size) throw new Error("Choose a non-empty file.");
  return Buffer.concat(chunks);
}

/** Never trust the browser MIME. Images are decoded, bounded and stripped of EXIF. */
export async function validateChatFile(input: Buffer, originalName: string) {
  if (!input.length || input.length > CHAT_FILE_LIMIT) throw new Error("File exceeds 3 MB.");
  let bytes: Buffer, mime: string, extension: string;
  if (input.subarray(0, 5).toString() === "%PDF-") {
    const pdf = await PDFDocument.load(input, { ignoreEncryption: false, updateMetadata: false });
    if (pdf.getPageCount() < 1 || pdf.getPageCount() > 100) throw new Error("Use a PDF with 1–100 pages.");
    // PDF is delivered as a download, never embedded into the portal's origin.
    bytes = input; mime = "application/pdf"; extension = "pdf";
  } else {
    const raster = input.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      || input.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      || input.subarray(0, 4).toString() === "RIFF" && input.subarray(8, 12).toString() === "WEBP";
    if (!raster) throw new Error("Use JPG, PNG, WebP or PDF.");
    const image = sharp(input, { limitInputPixels: 24_000_000, animated: false, failOn: "warning" });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) throw new Error("Use JPG, PNG, WebP or PDF.");
    bytes = await image.rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    mime = "image/webp"; extension = "webp";
  }
  if (bytes.length > CHAT_FILE_LIMIT) throw new Error("File exceeds 3 MB.");
  const base = originalName.replace(/\.[^.]*$/, "").replace(/[^\p{L}\p{N} ._-]/gu, "_").trim().slice(0, 180) || "attachment";
  return { bytes, mime, name: `${base}.${extension}`, digest: createHash("sha256").update(bytes).digest("hex") };
}
