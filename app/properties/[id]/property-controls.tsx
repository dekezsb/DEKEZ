"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, ExternalLink, LoaderCircle, QrCode, X } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { updateRoomField } from "./actions";

export function PropertyInformationForm({
  action,
  currentRooms,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  currentRooms: number;
  children: ReactNode;
}) {
  function confirmRoomReduction(event: FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const target = Number(formData.get("totalRooms"));
    if (
      Number.isFinite(target) &&
      target < currentRooms &&
      !window.confirm(
        `Reduce this property from ${currentRooms} to ${target} rooms? Only vacant rooms without history can be removed.`,
      )
    ) {
      event.preventDefault();
    }
  }

  return (
    <form action={action} className="grid gap-4 lg:grid-cols-2" onSubmit={confirmRoomReduction}>
      {children}
    </form>
  );
}

export function PaymentQrPreview({
  propertyName,
  qrUrl,
}: {
  propertyName: string;
  qrUrl: string | null;
}) {
  const [open, setOpen] = useState(false);

  if (!qrUrl) {
    return <span className="text-xs text-gray-400">Not configured</span>;
  }

  return (
    <>
      <Button size="sm" type="button" variant="outline" onClick={() => setOpen(true)}>
        <QrCode className="h-4 w-4" />
        Preview
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-gray-950">{propertyName}</p>
                <p className="text-xs text-gray-500">Property payment QR</p>
              </div>
              <Button aria-label="Close QR preview" size="icon" type="button" variant="ghost" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <Image
              className="mx-auto mt-5 h-auto max-h-[65vh] w-auto max-w-full object-contain"
              src={qrUrl}
              alt={`${propertyName} payment QR`}
              width={720}
              height={720}
              unoptimized
            />
            <Button asChild className="mt-5 w-full" variant="outline">
              <a href={qrUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Open full image
              </a>
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function PaymentQrCell({
  propertyName,
  qrUrl,
}: {
  propertyName: string;
  qrUrl: string | null;
}) {
  if (!qrUrl) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-gray-400">Not set</p>
        <Button asChild className="h-7 px-2 text-xs" size="sm" variant="ghost">
          <a href="#payment-qr-settings">Replace</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-w-28 items-center gap-2">
      <Image
        className="h-10 w-10 rounded border border-[#d7dde5] bg-white object-contain p-0.5"
        src={qrUrl}
        alt={`${propertyName} payment QR`}
        width={80}
        height={80}
        unoptimized
      />
      <div className="flex flex-col items-start gap-1">
        <PaymentQrPreview propertyName={propertyName} qrUrl={qrUrl} />
        <Button asChild className="h-7 px-2 text-xs" size="sm" variant="ghost">
          <a href="#payment-qr-settings">Replace</a>
        </Button>
      </div>
    </div>
  );
}

export function InlineRoomField({
  propertyId,
  roomId,
  tenantRecordId,
  tenancyId,
  field,
  value,
  label,
}: {
  propertyId: string;
  roomId: string;
  tenantRecordId: string | null;
  tenancyId: string | null;
  field: "monthlyRent" | "dueDay";
  value: number;
  label: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const savedValue = useRef(String(value));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save(formData: FormData) {
    setStatus("saving");
    const result = await updateRoomField(formData);
    if (result.ok) {
      savedValue.current = String(formData.get("value") ?? "");
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1600);
      return;
    }
    setStatus("error");
  }

  function submitIfChanged(event: FormEvent<HTMLInputElement>) {
    if (event.currentTarget.value !== savedValue.current) {
      formRef.current?.requestSubmit();
    }
  }

  return (
    <form ref={formRef} action={save} className="min-w-24">
      <input name="propertyId" type="hidden" value={propertyId} />
      <input name="roomId" type="hidden" value={roomId} />
      <input name="tenantRecordId" type="hidden" value={tenantRecordId ?? ""} />
      <input name="tenancyId" type="hidden" value={tenancyId ?? ""} />
      <input name="field" type="hidden" value={field} />
      <input
        aria-label={label}
        className="h-9 w-24 rounded-md border border-[#d7dde5] bg-white px-2 text-sm text-gray-950 outline-none focus:border-[#b98a29] focus:ring-2 focus:ring-[#b98a29]/20"
        defaultValue={value}
        max={field === "dueDay" ? 31 : undefined}
        min={field === "dueDay" ? 1 : 0}
        name="value"
        onBlur={submitIfChanged}
        step={field === "monthlyRent" ? "0.01" : "1"}
        type="number"
      />
      <span
        aria-live="polite"
        className={`mt-1 flex h-4 items-center gap-1 text-[11px] ${
          status === "error" ? "text-red-600" : "text-gray-500"
        }`}
      >
        {status === "saving" ? <><LoaderCircle className="h-3 w-3 animate-spin" /> Saving</> : null}
        {status === "saved" ? <><Check className="h-3 w-3 text-emerald-600" /> Saved</> : null}
        {status === "error" ? "Save failed" : null}
        {status === "idle" ? "Auto-saves" : null}
      </span>
    </form>
  );
}
