"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { ExternalLink, QrCode, X } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";

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
