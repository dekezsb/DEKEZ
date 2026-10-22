"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createExpense } from "@/app/expenses/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Option = {
  id: string;
  name: string;
};

export function AddExpenseForm({
  categories,
  claims,
  profiles,
  properties,
  rooms,
  tickets,
  units,
  submissionId,
}: {
  categories: Option[];
  claims: Array<{
    id: string;
    description: string | null;
    status: string;
  }>;
  profiles: Array<{ id: string; full_name: string | null }>;
  properties: Option[];
  rooms: Array<{ id: string; name: string; room_number: string | null }>;
  tickets: Array<{
    id: string;
    ticket_number: string | null;
    status: string;
  }>;
  units: Option[];
  submissionId: string;
}) {
  const [fundingSource, setFundingSource] = useState("company_cash");
  const inputClass =
    "mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2";

  return (
    <Card id="add-expense">
      <CardHeader>
        <CardTitle>+ Add Expense</CardTitle>
        <CardDescription>
          Submit the bill at the top first. Bank slips and company-card
          statements can be attached later when knocking off multiple verified
          bills.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={createExpense} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <input type="hidden" name="submissionId" value={submissionId} />
          <label className="block md:col-span-2">
            <span className="text-sm font-medium text-gray-700">
              Receipt / invoice
            </span>
            <input
              accept="image/jpeg,image/png,image/webp,application/pdf"
              capture="environment"
              className={inputClass}
              name="receipt"
              required
              type="file"
            />
            <span className="text-xs text-gray-500">PDF, JPG, PNG or WebP, up to 3 MB.</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              Expense date
            </span>
            <input className={inputClass} name="expenseDate" type="date" required />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Amount RM</span>
            <input
              className={inputClass}
              min="0.01"
              name="amount"
              required
              step="0.01"
              type="number"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              Tax amount RM
            </span>
            <input
              className={inputClass}
              min="0"
              name="taxAmount"
              step="0.01"
              type="number"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Category (optional)</span>
            <select className={inputClass} name="categoryId">
              <option value="">Admin will select during verification</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              Property optional
            </span>
            <select className={inputClass} name="propertyId">
              <option value="">General Company Expense</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              Unit optional
            </span>
            <select className={inputClass} name="unitId">
              <option value="">No unit</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              Room optional
            </span>
            <select className={inputClass} name="roomId">
              <option value="">No room</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.room_number ?? room.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              Maintenance ticket optional
            </span>
            <select className={inputClass} name="maintenanceTicketId">
              <option value="">No ticket</option>
              {tickets.map((ticket) => (
                <option key={ticket.id} value={ticket.id}>
                  {ticket.ticket_number ?? ticket.id} - {ticket.status}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              Claim optional
            </span>
            <select className={inputClass} name="claimId">
              <option value="">No claim link</option>
              {claims.map((claim) => (
                <option key={claim.id} value={claim.id}>
                  {claim.description ?? claim.id} - {claim.status}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Supplier</span>
            <input className={inputClass} name="supplier" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              Receipt number
            </span>
            <input className={inputClass} name="receiptNumber" />
          </label>
          {fundingSource === "staff_personal" ? <label className="block">
            <span className="text-sm font-medium text-gray-700">Claimant — Staff / Director *</span>
            <select className={inputClass} name="paidBy" required>
              <option value="">Select claimant</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.full_name ?? profile.id}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-gray-500">Unpaid claim · awaiting admin verification. No company bank payment is recorded.</span>
          </label> : null}
          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              Payment method
            </span>
            <select className={inputClass} defaultValue="cash" name="paymentMethod">
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="duitnow">DuitNow</option>
              <option value="online_payment">Online payment</option>
              <option value="cheque">Cheque</option>
              <option value="card">Company card</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Paid by / Payment source *</span>
            <select
              className={inputClass}
              value={fundingSource}
              onChange={(event) => setFundingSource(event.target.value)}
              name="fundingSource"
            >
              <option value="company_cash">Company cash in hand</option>
              <option value="company_bank">Company bank / company card</option>
              <option value="staff_personal">
                Staff / Director - Claimable
              </option>
            </select>
            <span className="mt-1 block text-xs text-gray-500">
              All submissions await admin review. Company cash follows the existing cash flow after verification; claimable bills create a payable, not a company bank payment.
            </span>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Charge to</span>
            <select
              className={inputClass}
              defaultValue="company"
              name="chargeTo"
            >
              <option value="company">Company</option>
              <option value="owner">Owner</option>
              <option value="tenant">Tenant</option>
            </select>
          </label>
          <label className="block md:col-span-2 xl:col-span-3">
            <span className="text-sm font-medium text-gray-700">
              Claim reference / notes (optional)
            </span>
            <textarea
              className={`${inputClass} min-h-24`}
              name="description"
            />
          </label>
          <label className="flex items-center gap-2 self-end pb-3 text-sm text-gray-700">
            <input name="taxClaimable" type="checkbox" />
            Tax claimable
          </label>
          <SubmitExpenseButton />
        </form>
      </CardContent>
    </Card>
  );
}

function SubmitExpenseButton() {
  const { pending } = useFormStatus();
  return <Button className="md:col-span-2 xl:col-span-4" type="submit" disabled={pending}>{pending ? "Submitting…" : "Submit for verification"}</Button>;
}
