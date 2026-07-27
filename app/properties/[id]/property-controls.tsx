"use client";

import {
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Check, ExternalLink, LoaderCircle, QrCode, Upload, X } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TableRow } from "@/components/ui/table";
import { updateRoomField, updateRoomPaymentQr } from "./actions";

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
                <p className="text-xs text-gray-500">Room payment QR</p>
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
  canManage = true,
  hasRoomPaymentQr,
  propertyId,
  propertyName,
  qrUrl,
  roomId,
}: {
  canManage?: boolean;
  hasRoomPaymentQr: boolean;
  propertyId: string;
  propertyName: string;
  qrUrl: string | null;
  roomId: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex min-w-32 items-center gap-2">
      {qrUrl ? (
        <Image
          className="h-11 w-11 rounded border border-[#d7dde5] bg-white object-contain p-0.5"
          src={qrUrl}
          alt={`${propertyName} payment QR`}
          width={88}
          height={88}
          unoptimized
        />
      ) : (
        <div className="flex h-11 w-11 items-center justify-center rounded border border-dashed border-[#c9d1dc] bg-gray-50">
          <QrCode className="h-5 w-5 text-gray-400" />
        </div>
      )}
      <div className="flex flex-col items-start gap-1">
        {qrUrl ? <PaymentQrPreview propertyName={propertyName} qrUrl={qrUrl} /> : (
          <span className="text-xs text-gray-400">Not set</span>
        )}
        {!hasRoomPaymentQr && qrUrl ? (
          <span className="text-[10px] text-amber-700">Property fallback</span>
        ) : null}
        {canManage ? (
          <form ref={formRef} action={updateRoomPaymentQr}>
            <input name="propertyId" type="hidden" value={propertyId} />
            <input name="roomId" type="hidden" value={roomId} />
            <input
              ref={fileInputRef}
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              name="paymentQr"
              onChange={(event) => {
                if (event.currentTarget.files?.length) {
                  formRef.current?.requestSubmit();
                }
              }}
              type="file"
            />
            <Button
              className="h-7 px-2 text-xs"
              onClick={() => fileInputRef.current?.click()}
              size="sm"
              type="button"
              variant="outline"
            >
              <Upload className="h-3.5 w-3.5" />
              {hasRoomPaymentQr ? "Change" : "Add QR"}
            </Button>
          </form>
        ) : null}
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
  maxValue,
  editable = true,
}: {
  propertyId: string;
  roomId: string;
  tenantRecordId: string | null;
  tenancyId: string | null;
  field: "monthlyRent" | "deposit" | "depositReceived" | "dueDay" | "contractEnd";
  value: number | string;
  label: string;
  maxValue?: number;
  editable?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const savedValue = useRef(String(value));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const requiresSave = field === "depositReceived";

  async function save(formData: FormData) {
    setStatus("saving");
    setErrorMessage("");
    const result = await updateRoomField(formData);
    if (result.ok) {
      savedValue.current = String(formData.get("value") ?? "");
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1600);
      return;
    }
    setErrorMessage(result.error ?? "Save failed");
    setStatus("error");
  }

  function submitIfChanged(event: FocusEvent<HTMLInputElement>) {
    if (event.currentTarget.value !== savedValue.current) {
      formRef.current?.requestSubmit();
    }
  }

  if (!editable) {
    const displayValue =
      field === "contractEnd" || field === "dueDay"
        ? String(value || "-")
        : new Intl.NumberFormat("en-MY", {
            style: "currency",
            currency: "MYR",
          }).format(Number(value || 0));
    return <span className="font-medium text-gray-950">{displayValue}</span>;
  }

  return (
    <form
      ref={formRef}
      action={save}
      className={requiresSave ? "flex min-w-40 items-start gap-2" : "min-w-24"}
    >
      <input name="propertyId" type="hidden" value={propertyId} />
      <input name="roomId" type="hidden" value={roomId} />
      <input name="tenantRecordId" type="hidden" value={tenantRecordId ?? ""} />
      <input name="tenancyId" type="hidden" value={tenancyId ?? ""} />
      <input name="field" type="hidden" value={field} />
      <div>
        <input
          aria-label={label}
          className={`h-9 rounded-md border border-[#d7dde5] bg-white px-2 text-sm text-gray-950 outline-none focus:border-[#b98a29] focus:ring-2 focus:ring-[#b98a29]/20 ${
            field === "contractEnd" ? "w-36" : "w-24"
          }`}
          defaultValue={value}
          max={field === "dueDay" ? 31 : maxValue}
          min={
            field === "dueDay"
              ? 1
              : field === "contractEnd"
                ? undefined
                : field === "depositReceived"
                  ? Number(value)
                  : 0
          }
          name="value"
          onBlur={requiresSave ? undefined : submitIfChanged}
          step={field === "dueDay" ? "1" : field === "contractEnd" ? undefined : "0.01"}
          type={field === "contractEnd" ? "date" : "number"}
        />
        <span
          aria-live="polite"
          className={`mt-1 flex min-h-4 max-w-44 items-start gap-1 text-[11px] ${
            status === "error" ? "text-red-600" : "text-gray-500"
          }`}
        >
          {status === "saving" ? <><LoaderCircle className="h-3 w-3 animate-spin" /> Saving</> : null}
          {status === "saved" ? <><Check className="h-3 w-3 text-emerald-600" /> Saved</> : null}
          {status === "error" ? errorMessage : null}
          {status === "idle" && !requiresSave ? "Auto-saves" : null}
        </span>
      </div>
      {requiresSave ? (
        <Button disabled={status === "saving"} size="sm" type="submit">
          Save
        </Button>
      ) : null}
    </form>
  );
}

export function RoomNavigationRow({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();

  function isInteractive(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest("a, button, input, form, label"));
  }

  function openRoom(event: MouseEvent<HTMLTableRowElement>) {
    if (!isInteractive(event.target)) {
      router.push(href);
    }
  }

  function openRoomFromKeyboard(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.key === "Enter" && event.currentTarget === event.target) {
      router.push(href);
    }
  }

  return (
    <TableRow
      className={`cursor-pointer ${className ?? ""}`}
      onClick={openRoom}
      onKeyDown={openRoomFromKeyboard}
      role="link"
      tabIndex={0}
    >
      {children}
    </TableRow>
  );
}
