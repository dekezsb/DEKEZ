/**
 * Registration upload rules. Storage only accepts JPG, PNG, WebP and PDF up to
 * 10 MB, so the browser converts other phone photos (HEIC/HEIF, very large
 * camera images) to JPG before upload, and both sides explain any refusal.
 */
export const registrationUploadTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const registrationMaxFileBytes = 10 * 1024 * 1024;

const extensionTypes: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  heic: "image/heic",
  heif: "image/heif",
};

export function inferUploadType(name: string, type: string) {
  const declared = (type || "").toLowerCase();
  if (declared === "image/jpg" || declared === "image/pjpeg") return "image/jpeg";
  if (declared && declared !== "application/octet-stream") return declared;
  const extension = name.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() ?? "";
  return extensionTypes[extension] ?? declared;
}

export function formatMegabytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function uploadMetadataProblem(upload: { name?: unknown; size?: unknown; type?: unknown }) {
  if (typeof upload.name !== "string" || typeof upload.size !== "number" || typeof upload.type !== "string") {
    return "This file could not be read. Please choose it again.";
  }
  if (upload.size <= 0) return "This file is empty. Please choose it again.";
  if (upload.size > registrationMaxFileBytes) {
    return `This file is ${formatMegabytes(upload.size)}. The limit is 10 MB — take a screenshot of it or choose a smaller photo.`;
  }
  if (!(registrationUploadTypes as readonly string[]).includes(inferUploadType(upload.name, upload.type))) {
    return "Use a JPG, PNG, WebP photo or a PDF. Other formats (for example HEIC) cannot be stored — take a screenshot of it instead.";
  }
  return null;
}

function renamedAsJpeg(name: string) {
  const base = name.replace(/\.[a-z0-9]{1,8}$/i, "") || "photo";
  return `${base}.jpg`;
}

async function decodeImage(file: File): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { width: bitmap.width, height: bitmap.height, draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h) };
    } catch {
      // Fall back to an <img> element below (Safari decodes HEIC there).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("decode failed"));
      element.src = url;
    });
    await image.decode?.().catch(() => undefined);
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw: (ctx, w, h) => ctx.drawImage(image, 0, 0, w, h),
    };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Returns a file storage will accept, converting images when needed.
 * Throws an Error with a user-facing message when that is impossible.
 */
export async function prepareRegistrationUpload(file: File, allowPdf: boolean): Promise<File> {
  const type = inferUploadType(file.name, file.type);
  const accepted = (registrationUploadTypes as readonly string[]).includes(type);
  if (type === "application/pdf") {
    if (!allowPdf) throw new Error("Choose a photo (JPG or PNG) here, not a PDF.");
    if (file.size > registrationMaxFileBytes) {
      throw new Error(`This PDF is ${formatMegabytes(file.size)}. The limit is 10 MB — take a screenshot of it instead.`);
    }
    return file.type === type ? file : new File([file], file.name, { type });
  }
  if (file.size <= 0) throw new Error("This file is empty. Please choose it again.");
  if (accepted && file.size <= registrationMaxFileBytes) {
    return file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
  }
  if (!type.startsWith("image/") && type) {
    throw new Error("Use a JPG, PNG or WebP photo, or a PDF.");
  }
  try {
    const decoded = await decodeImage(file);
    const maxSide = 2560;
    const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    decoded.draw(context, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size > registrationMaxFileBytes) throw new Error("too large");
    return new File([blob], renamedAsJpeg(file.name), { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    throw new Error(
      file.size > registrationMaxFileBytes && accepted
        ? `This photo is ${formatMegabytes(file.size)} and could not be made smaller. The limit is 10 MB — take a screenshot of it instead.`
        : "This photo format could not be opened. Take a screenshot of it, or save it as JPG/PNG, then attach that.",
    );
  }
}
