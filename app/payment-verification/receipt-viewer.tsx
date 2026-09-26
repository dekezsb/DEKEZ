"use client";

import { useId, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ReceiptViewer({ url, isImage, label = "Payment receipt", thumbnail = true }: {
  url: string; isImage: boolean; label?: string; thumbnail?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" aria-label={`View receipt: ${label}`} aria-haspopup="dialog"
      className={thumbnail ? "block rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b8892c]" : "mt-3 text-sm font-medium text-[#126b5f] underline"}
      onClick={() => { setOpen(true); dialog.current?.showModal(); }}>
      {thumbnail ? <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-[#d7dde5] bg-[#f4f6f8]">
        {isImage ? <img alt="Payment slip thumbnail" src={url} loading="lazy" className="h-full w-full object-cover" /> : <FileText aria-hidden="true" className="h-7 w-7 text-[#9a6b12]" />}
      </span> : "View full receipt"}
    </button>
    <dialog ref={dialog} aria-labelledby={headingId}
      className="fixed inset-0 m-auto max-h-[92vh] w-[calc(100%-2rem)] max-w-4xl overflow-auto rounded-xl border-0 bg-white p-4 text-gray-950 shadow-xl backdrop:bg-black/65"
      onClose={() => setOpen(false)}
      onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div onClick={event => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 id={headingId} className="font-semibold">{label}</h2>
          <Button autoFocus type="button" variant="outline" onClick={() => dialog.current?.close()}>Close</Button>
        </div>
        {open ? isImage
          ? <img src={url} alt={label} className="max-h-[76vh] w-full object-contain" />
          : <iframe src={url} title={label} className="h-[76vh] w-full rounded-md border" />
          : null}
      </div>
    </dialog>
  </>;
}
