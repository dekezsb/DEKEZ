"use client";

import { Link } from "@/components/app-link";
import { useState } from "react";
import type { ReactNode } from "react";
import { Banknote, MessageCircle, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentPreview } from "@/components/ui/document-preview";
import {
  markRentBillPaid,
  rejectRentSubmission,
  sendRentReminder,
  uploadRentPaymentSlip,
  verifyRentSubmission,
} from "./actions";

type RentDueActionsProps = {
  billId: string;
  tenantName: string;
  propertyName: string;
  roomName: string;
  billMonth: string;
  amountDue: string;
  outstandingAmount: string;
  outstandingAmountValue: number;
  paidDateDefault: string;
  reminderMessage: string;
  receiptUrl?: string | null;
  latestSubmissionId?: string | null;
  latestSubmissionStatus?: string | null;
  compact?: boolean;
};

export function RentDueActions({
  billId,
  tenantName,
  propertyName,
  roomName,
  billMonth,
  amountDue,
  outstandingAmount,
  outstandingAmountValue,
  paidDateDefault,
  reminderMessage,
  receiptUrl,
  latestSubmissionId,
  latestSubmissionStatus,
  compact = false,
}: RentDueActionsProps) {
  const [reminderOpen, setReminderOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const canVerify = Boolean(latestSubmissionId && latestSubmissionStatus === "pending_verification");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="button" variant="outline" onClick={() => setReminderOpen(true)}>
          {compact ? null : <MessageCircle aria-hidden="true" className="size-4" />}
          WhatsApp
        </Button>
        <Button
          className="bg-[#b98a2c] text-white hover:bg-[#9d7322]"
          size="sm"
          type="button"
          onClick={() => setPaidOpen(true)}
        >
          {compact ? null : <Banknote aria-hidden="true" className="size-4" />}
          Cash received
        </Button>
        <Button
          className="border-[#d9bf84] text-[#8a641d] hover:bg-[#fff8e8]"
          disabled={canVerify}
          size="sm"
          type="button"
          variant="outline"
          onClick={() => setOnlineOpen(true)}
        >
          <Paperclip aria-hidden="true" className="size-4" />
          {canVerify ? "Slip submitted" : "Online"}
        </Button>
      </div>
      {compact ? null : (
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link href={`/payments?bill=${billId}`}>View Bill</Link>
          </Button>
          {receiptUrl ? (
            <DocumentPreview
              label="Payment slip"
              showName={false}
              size="sm"
              url={receiptUrl}
            />
          ) : null}
          {canVerify ? (
            <Button size="sm" type="button" onClick={() => setVerifyOpen(true)}>
              Verify Payment
            </Button>
          ) : null}
          {canVerify ? (
            <Button
              className="border-red-200 text-red-700 hover:bg-red-50"
              size="sm"
              type="button"
              variant="outline"
              onClick={() => setRejectOpen(true)}
            >
              Reject Payment
            </Button>
          ) : null}
        </div>
      )}

      {reminderOpen ? (
        <Modal title="Send WhatsApp reminder" onClose={() => setReminderOpen(false)}>
          <form action={sendRentReminder} className="space-y-4">
            <input name="billId" type="hidden" value={billId} />
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Message preview</span>
              <textarea className="mt-2 min-h-40 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm" name="message" defaultValue={reminderMessage} required />
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setReminderOpen(false)}>Cancel</Button>
              <Button type="submit">Confirm & Send</Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {paidOpen ? (
        <Modal title="Confirm cash received" onClose={() => setPaidOpen(false)}>
          <div className="mb-4 grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
            <p>Tenant: <span className="font-medium text-gray-950">{tenantName}</span></p>
            <p>Property: <span className="font-medium text-gray-950">{propertyName}</span></p>
            <p>Room: <span className="font-medium text-gray-950">{roomName}</span></p>
            <p>Bill month: <span className="font-medium text-gray-950">{billMonth}</span></p>
            <p>Amount due: <span className="font-medium text-gray-950">{amountDue}</span></p>
            <p>Outstanding: <span className="font-medium text-gray-950">{outstandingAmount}</span></p>
          </div>
          <form action={markRentBillPaid} className="grid gap-4 sm:grid-cols-2">
            <input name="billId" type="hidden" value={billId} />
            <input name="paymentType" type="hidden" value="cash" />
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Paid amount RM</span>
              <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" defaultValue={outstandingAmountValue} max={outstandingAmountValue} name="paidAmount" type="number" min="0.01" step="0.01" required />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Paid date</span>
              <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="paidDate" type="date" defaultValue={paidDateDefault} required />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Reference number</span>
              <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="referenceNumber" />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-gray-700">Note</span>
              <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" defaultValue="Cash received by management" name="notes" />
            </label>
            <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setPaidOpen(false)}>Cancel</Button>
              <Button type="submit">Confirm Cash Received</Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {onlineOpen ? (
        <Modal title="Upload online payment slip" onClose={() => setOnlineOpen(false)}>
          <div className="mb-4 grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
            <p>Tenant: <span className="font-medium text-gray-950">{tenantName}</span></p>
            <p>Property: <span className="font-medium text-gray-950">{propertyName}</span></p>
            <p>Room: <span className="font-medium text-gray-950">{roomName}</span></p>
            <p>Bill month: <span className="font-medium text-gray-950">{billMonth}</span></p>
            <p>Amount due: <span className="font-medium text-gray-950">{amountDue}</span></p>
            <p>Outstanding: <span className="font-medium text-gray-950">{outstandingAmount}</span></p>
          </div>
          <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Uploading a slip keeps this bill pending. Rent is counted as paid only after an authorized user verifies the payment.
          </p>
          <form action={uploadRentPaymentSlip} className="grid gap-4 sm:grid-cols-2">
            <input name="billId" type="hidden" value={billId} />
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Amount submitted RM</span>
              <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" defaultValue={outstandingAmountValue} min="0.01" name="amount" required step="0.01" type="number" />
              <span className="mt-1 block text-xs text-gray-500">
                A higher amount is allowed. Admin will classify the extra
                charge during verification.
              </span>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Payment date</span>
              <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" defaultValue={paidDateDefault} name="paymentDate" required type="date" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Payment method</span>
              <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" defaultValue="bank_transfer" name="paymentMethod">
                <option value="bank_transfer">Bank transfer</option>
                <option value="duitnow">DuitNow</option>
                <option value="online_payment">Online payment</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Reference number optional</span>
              <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="referenceNumber" />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-gray-700">Payment slip</span>
              <input accept="image/*,.pdf" capture="environment" className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="receipt" required type="file" />
              <span className="mt-1 block text-xs text-gray-500">Image or PDF, maximum 10 MB.</span>
            </label>
            <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setOnlineOpen(false)}>Cancel</Button>
              <Button type="submit">Upload for Verification</Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {verifyOpen && latestSubmissionId ? (
        <Modal title="Verify payment slip" onClose={() => setVerifyOpen(false)}>
          <div className="space-y-3 text-sm text-gray-600">
            <p>Confirm this payment was received before marking the bill paid or partially paid.</p>
            {receiptUrl ? (
              <DocumentPreview
                label="Payment receipt"
                url={receiptUrl}
              />
            ) : null}
          </div>
          <form action={verifyRentSubmission} className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <input name="submissionId" type="hidden" value={latestSubmissionId} />
            <Button type="button" variant="outline" onClick={() => setVerifyOpen(false)}>Cancel</Button>
            <Button type="submit">Confirm & Verify</Button>
          </form>
        </Modal>
      ) : null}

      {rejectOpen && latestSubmissionId ? (
        <Modal title="Reject payment slip" onClose={() => setRejectOpen(false)}>
          <form action={rejectRentSubmission} className="space-y-4">
            <input name="submissionId" type="hidden" value={latestSubmissionId} />
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Reason</span>
              <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="reason" required>
                <option value="">Choose reason</option>
                <option value="Amount not received">Amount not received</option>
                <option value="Wrong amount">Wrong amount</option>
                <option value="Duplicate slip">Duplicate slip</option>
                <option value="Invalid receipt">Invalid receipt</option>
                <option value="Wrong bank account">Wrong bank account</option>
              </select>
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
              <Button className="bg-red-600 text-white hover:bg-red-700" type="submit">Reject Payment</Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-gray-950">{title}</h2>
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </div>
        {children}
      </div>
    </div>
  );
}
