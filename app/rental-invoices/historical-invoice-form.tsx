"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createHistoricalRentalInvoice } from "./actions";

type TenantOption = {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  propertyId: string | null;
  propertyName: string | null;
  roomId: string | null;
  roomName: string | null;
  monthlyRent: number;
  tenancyId: string | null;
};

type PropertyOption = {
  id: string;
  name: string;
  code: string | null;
};

type RoomOption = {
  id: string;
  propertyId: string;
  name: string;
};

type HistoricalInvoiceFormProps = {
  tenants: TenantOption[];
  properties: PropertyOption[];
  rooms: RoomOption[];
};

function malaysiaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const fieldClass =
  "mt-1.5 h-10 w-full rounded-md border border-[#cfd6df] bg-white px-3 text-sm text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20";

export function HistoricalInvoiceForm({
  tenants,
  properties,
  rooms,
}: HistoricalInvoiceFormProps) {
  const today = malaysiaDate();
  const [tenantId, setTenantId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [amount, setAmount] = useState("");
  const [outstanding, setOutstanding] = useState("");
  const [status, setStatus] = useState("unpaid");
  const availableRooms = useMemo(
    () => rooms.filter((room) => room.propertyId === propertyId),
    [propertyId, rooms],
  );

  function selectTenant(nextTenantId: string) {
    setTenantId(nextTenantId);
    const tenant = tenants.find((option) => option.id === nextTenantId);
    if (!tenant) return;
    setPropertyId(tenant.propertyId ?? "");
    setRoomId(tenant.roomId ?? "");
    const rent = tenant.monthlyRent > 0 ? String(tenant.monthlyRent) : "";
    setAmount(rent);
    setOutstanding(status === "paid" ? "0" : rent);
  }

  function changeAmount(nextAmount: string) {
    setAmount(nextAmount);
    if (status === "draft" || status === "unpaid") {
      setOutstanding(nextAmount);
    }
    if (status === "paid") {
      setOutstanding("0");
    }
  }

  function changeStatus(nextStatus: string) {
    setStatus(nextStatus);
    if (nextStatus === "paid") {
      setOutstanding("0");
    } else if (nextStatus === "draft" || nextStatus === "unpaid") {
      setOutstanding(amount);
    }
  }

  return (
    <form
      action={createHistoricalRentalInvoice}
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <label className="block text-sm font-medium text-gray-700 lg:col-span-2">
        Former tenant
        <select
          className={fieldClass}
          name="tenantRecordId"
          onChange={(event) => selectTenant(event.target.value)}
          required
          value={tenantId}
        >
          <option value="">Choose a tenant record</option>
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}
              {tenant.phone ? ` / ${tenant.phone}` : ""}
              {tenant.propertyName ? ` / ${tenant.propertyName}` : ""}
              {tenant.roomName ? ` / Room ${tenant.roomName}` : ""}
              {tenant.status !== "active" ? ` / ${tenant.status}` : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm font-medium text-gray-700">
        Payment status
        <select
          className={fieldClass}
          name="status"
          onChange={(event) => changeStatus(event.target.value)}
          value={status}
        >
          <option value="draft">Draft</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partially Paid</option>
          <option value="paid">Paid</option>
        </select>
      </label>

      <label className="block text-sm font-medium text-gray-700">
        Property
        <select
          className={fieldClass}
          name="propertyId"
          onChange={(event) => {
            setPropertyId(event.target.value);
            setRoomId("");
          }}
          required
          value={propertyId}
        >
          <option value="">Choose a property</option>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.code ? `${property.code} - ` : ""}
              {property.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm font-medium text-gray-700">
        Room
        <select
          className={fieldClass}
          disabled={!propertyId}
          name="roomId"
          onChange={(event) => setRoomId(event.target.value)}
          required
          value={roomId}
        >
          <option value="">
            {propertyId ? "Choose a room" : "Choose a property first"}
          </option>
          {availableRooms.map((room) => (
            <option key={room.id} value={room.id}>
              Room {room.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm font-medium text-gray-700">
        Invoice month
        <input
          className={fieldClass}
          defaultValue={today.slice(0, 7)}
          name="invoiceMonth"
          required
          type="month"
        />
      </label>

      <label className="block text-sm font-medium text-gray-700">
        Invoice date
        <input
          className={fieldClass}
          defaultValue={today}
          name="invoiceDate"
          required
          type="date"
        />
      </label>

      <label className="block text-sm font-medium text-gray-700">
        Due date
        <input
          className={fieldClass}
          defaultValue={today}
          name="dueDate"
          required
          type="date"
        />
      </label>

      <label className="block text-sm font-medium text-gray-700">
        Rental amount (RM)
        <input
          className={fieldClass}
          min="0.01"
          name="amount"
          onChange={(event) => changeAmount(event.target.value)}
          required
          step="0.01"
          type="number"
          value={amount}
        />
      </label>

      <label className="block text-sm font-medium text-gray-700">
        Outstanding amount (RM)
        <input
          className={fieldClass}
          min="0"
          name="outstanding"
          onChange={(event) => setOutstanding(event.target.value)}
          required
          step="0.01"
          type="number"
          value={outstanding}
        />
      </label>

      <label className="block text-sm font-medium text-gray-700 sm:col-span-2 lg:col-span-3">
        Notes
        <textarea
          className="mt-1.5 min-h-24 w-full rounded-md border border-[#cfd6df] bg-white px-3 py-2 text-sm text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
          name="notes"
          placeholder="Reason for adding this historical invoice or other accounting notes"
        />
      </label>

      <div className="sm:col-span-2 lg:col-span-3">
        <Button type="submit">
          <Plus className="h-4 w-4" />
          Add Historical Invoice
        </Button>
      </div>
    </form>
  );
}
