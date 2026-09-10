"use client";
import { useState } from "react";

export function PaymentSlipFile() {
  const [message, setMessage] = useState("");
  return <>
    <input className="mt-2 block w-full rounded border p-2" name="receipt" type="file" accept="image/*,.pdf" required onChange={async (event) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      input.setCustomValidity("");
      setMessage("");
      if (!file || file.size <= 3 * 1024 * 1024) return;
      input.setCustomValidity("Preparing payment slip. Please wait.");
      setMessage("Preparing photo...");
      let url = "";
      try {
        if (!file.type.startsWith("image/")) throw new Error("Please choose a PDF smaller than 3 MB.");
        url = URL.createObjectURL(file);
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("Unable to read this photo. Please choose a JPG or PNG.")); img.src = url;
        });
        const scale = Math.min(1, 2000 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Unable to prepare this photo.");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
        if (!blob || blob.size > 3 * 1024 * 1024) throw new Error("Please choose a smaller photo (under 3 MB).");
        const transfer = new DataTransfer(); transfer.items.add(new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }));
        input.files = transfer.files;
        input.setCustomValidity(""); setMessage("Photo ready to upload.");
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unable to prepare this slip.";
        input.value = ""; input.setCustomValidity(reason); setMessage(reason);
      } finally { if (url) URL.revokeObjectURL(url); }
    }} />
    <span className="mt-1 block text-xs text-gray-600" role="status">{message || "Photos are optimized automatically. PDFs must be under 3 MB."}</span>
  </>;
}
