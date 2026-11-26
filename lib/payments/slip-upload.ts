import { OTHER_PAYMENT_MAX_FILE_BYTES } from "@/lib/payments/other-payment";
import {
  formatMegabytes,
  prepareRegistrationUpload,
} from "@/lib/registration/upload-files";

function renamedAsJpeg(name: string) {
  const base = name.replace(/\.[a-z0-9]{1,8}$/i, "") || "slip";
  return `${base}.jpg`;
}

async function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("decode failed"));
    element.src = url;
  });
}

async function shrinkImage(file: File, maxBytes: number) {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    for (const [maxSide, quality] of [
      [2000, 0.82],
      [1600, 0.75],
      [1280, 0.7],
      [1000, 0.65],
    ] as const) {
      const scale = Math.min(1, maxSide / longest);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) break;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (blob && blob.size <= maxBytes) {
        return new File([blob], renamedAsJpeg(file.name), {
          type: "image/jpeg",
          lastModified: file.lastModified,
        });
      }
    }
  } finally {
    URL.revokeObjectURL(url);
  }
  throw new Error(
    "This photo is too large and could not be made smaller. Take a screenshot of the slip instead.",
  );
}

/**
 * Browser-side preparation of a payment slip. Reuses the registration upload
 * rules (HEIC/HEIF and other phone photos are converted to JPG) and then keeps
 * the file under the 3 MB the server accepts for server actions.
 * Throws an Error with a message the tenant can read.
 */
export async function prepareSlipForUpload(file: File): Promise<File> {
  const prepared = await prepareRegistrationUpload(file, true);
  if (prepared.size <= OTHER_PAYMENT_MAX_FILE_BYTES) return prepared;
  if (prepared.type === "application/pdf") {
    throw new Error(
      `This PDF is ${formatMegabytes(prepared.size)}. The limit is 3 MB — take a screenshot of the slip instead.`,
    );
  }
  return shrinkImage(prepared, OTHER_PAYMENT_MAX_FILE_BYTES);
}
