"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Building2, CreditCard, ReceiptText, Users } from "lucide-react";
import {
  reconcileCompanyExpenseBatchFromBankLine,
  reconcilePaidCompanyExpensesFromBankLine,
  reconcileStaffPayoutFromBankLine,
} from "@/app/reports/actions";
import { Button } from "@/components/ui/button";

export type ReconciliationExpense = {
  id: string;
  amount: number;
  expenseDate: string;
  label: string;
  categoryName: string;
  propertyName: string;
  roomName: string | null;
  receiptCount: number;
};

export type ReconciliationStaffGroup = {
  staffId: string;
  staffName: string;
  total: number;
  items: Array<ReconciliationExpense & { liabilityId: string }>;
};

const currency = new Intl.NumberFormat("en-MY", {
  currency: "MYR",
  minimumFractionDigits: 2,
  style: "currency",
});

function SubmitBatch({
  disabled,
  label,
}: {
  disabled: boolean;
  label: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button className="w-full" disabled={disabled || pending} type="submit">
      {pending ? "Reconciling..." : label}
    </Button>
  );
}

function ReceiptRow({
  checked,
  item,
  name,
  onChange,
  value,
}: {
  checked: boolean;
  item: ReconciliationExpense;
  name: string;
  onChange: (checked: boolean) => void;
  value: string;
}) {
  return (
    <label
      className={`grid cursor-pointer gap-3 px-3 py-3 sm:grid-cols-[auto_1fr_auto] sm:items-center ${
        checked ? "bg-amber-50" : "bg-white hover:bg-gray-50"
      }`}
    >
      <input
        checked={checked}
        className="h-5 w-5"
        name={name}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
        value={value}
      />
      <span>
        <span className="block font-medium text-gray-950">{item.label}</span>
        <span className="mt-1 block text-xs text-gray-600">
          {item.expenseDate} · {item.categoryName} · {item.propertyName}
          {item.roomName ? ` / ${item.roomName}` : ""}
        </span>
        <span
          className={`mt-1 inline-flex items-center gap-1 text-xs font-medium ${
            item.receiptCount ? "text-emerald-700" : "text-amber-700"
          }`}
        >
          <ReceiptText className="h-3.5 w-3.5" />
          {item.receiptCount
            ? `${item.receiptCount} receipt${item.receiptCount === 1 ? "" : "s"} attached`
            : "Receipt attachment missing — review before finalising"}
        </span>
      </span>
      <strong>{currency.format(item.amount)}</strong>
    </label>
  );
}

export function BankReceiptBatchForm({
  paidCompanyExpenses,
  lineAmount,
  lineId,
  staffGroups,
  unpaidCompanyExpenses,
}: {
  paidCompanyExpenses: ReconciliationExpense[];
  lineAmount: number;
  lineId: string;
  staffGroups: ReconciliationStaffGroup[];
  unpaidCompanyExpenses: ReconciliationExpense[];
}) {
  const target = Math.abs(lineAmount);
  const [mode, setMode] = useState<"paid" | "unpaid" | "staff">("paid");
  const [query, setQuery] = useState("");
  const [selectedPaidExpenseIds, setSelectedPaidExpenseIds] = useState<string[]>([]);
  const [selectedUnpaidExpenseIds, setSelectedUnpaidExpenseIds] = useState<string[]>([]);
  const [staffId, setStaffId] = useState(staffGroups[0]?.staffId ?? "");
  const [selectedLiabilityIds, setSelectedLiabilityIds] = useState<string[]>([]);
  const selectedPaidExpenses = useMemo(
    () => new Set(selectedPaidExpenseIds),
    [selectedPaidExpenseIds],
  );
  const selectedUnpaidExpenses = useMemo(
    () => new Set(selectedUnpaidExpenseIds),
    [selectedUnpaidExpenseIds],
  );
  const selectedLiabilities = useMemo(
    () => new Set(selectedLiabilityIds),
    [selectedLiabilityIds],
  );
  const activeStaff = staffGroups.find((group) => group.staffId === staffId);
  const normalizedQuery = query.trim().toLowerCase();
  const paidCompanyRows = paidCompanyExpenses.filter((item) =>
    !normalizedQuery
      ? true
      : `${item.label} ${item.categoryName} ${item.propertyName} ${item.roomName ?? ""}`
          .toLowerCase()
          .includes(normalizedQuery),
  );
  const unpaidCompanyRows = unpaidCompanyExpenses.filter((item) =>
    !normalizedQuery
      ? true
      : `${item.label} ${item.categoryName} ${item.propertyName} ${item.roomName ?? ""}`
          .toLowerCase()
          .includes(normalizedQuery),
  );
  const staffRows = (activeStaff?.items ?? []).filter((item) =>
    !normalizedQuery
      ? true
      : `${item.label} ${item.categoryName} ${item.propertyName} ${item.roomName ?? ""}`
          .toLowerCase()
          .includes(normalizedQuery),
  );
  const paidCompanyTotal = paidCompanyExpenses.reduce(
    (sum, item) => sum + (selectedPaidExpenses.has(item.id) ? item.amount : 0),
    0,
  );
  const unpaidCompanyTotal = unpaidCompanyExpenses.reduce(
    (sum, item) => sum + (selectedUnpaidExpenses.has(item.id) ? item.amount : 0),
    0,
  );
  const staffTotal = (activeStaff?.items ?? []).reduce(
    (sum, item) =>
      sum + (selectedLiabilities.has(item.liabilityId) ? item.amount : 0),
    0,
  );
  const selectedTotal =
    mode === "paid"
      ? paidCompanyTotal
      : mode === "unpaid"
        ? unpaidCompanyTotal
        : staffTotal;
  const difference = target - selectedTotal;
  const exact = Math.abs(difference) < 0.005;
  const selectedCount =
    mode === "paid"
      ? selectedPaidExpenseIds.length
      : mode === "unpaid"
        ? selectedUnpaidExpenseIds.length
        : selectedLiabilityIds.length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-3">
        <button
          className={`rounded-lg border-2 p-4 text-left ${
            mode === "paid"
              ? "border-[#b8892c] bg-amber-50"
              : "border-[#d7dde5] bg-white"
          }`}
          onClick={() => {
            setMode("paid");
            setQuery("");
          }}
          type="button"
        >
          <span className="flex items-center gap-2 font-semibold">
            <CreditCard className="h-4 w-4" /> Company card / paid receipts
          </span>
          <span className="mt-1 block text-xs text-gray-600">
            The expense already exists. Link several receipts to this statement charge without posting them again.
          </span>
        </button>
        <button
          className={`rounded-lg border-2 p-4 text-left ${
            mode === "unpaid"
              ? "border-[#b8892c] bg-amber-50"
              : "border-[#d7dde5] bg-white"
          }`}
          onClick={() => {
            setMode("unpaid");
            setQuery("");
          }}
          type="button"
        >
          <span className="flex items-center gap-2 font-semibold">
            <Building2 className="h-4 w-4" /> Pay unpaid company bills
          </span>
          <span className="mt-1 block text-xs text-gray-600">
            Record one bank/card settlement for several verified bills that are still unpaid.
          </span>
        </button>
        <button
          className={`rounded-lg border-2 p-4 text-left ${
            mode === "staff"
              ? "border-[#b8892c] bg-amber-50"
              : "border-[#d7dde5] bg-white"
          }`}
          onClick={() => {
            setMode("staff");
            setQuery("");
          }}
          type="button"
        >
          <span className="flex items-center gap-2 font-semibold">
            <Users className="h-4 w-4" /> Reimburse one staff member
          </span>
          <span className="mt-1 block text-xs text-gray-600">
            One transfer clears several approved claim receipts for the same payee.
          </span>
        </button>
      </div>

      {mode === "paid" ? (
        <form action={reconcilePaidCompanyExpensesFromBankLine} className="space-y-4">
          <input name="lineId" type="hidden" value={lineId} />
          <input
            className="h-10 w-full rounded-md border border-[#d7dde5] px-3 text-sm"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search receipt, supplier, property or room"
            value={query}
          />
          <div className="max-h-80 divide-y divide-[#e3e8ef] overflow-y-auto rounded-lg border border-[#d7dde5]">
            {paidCompanyRows.map((item) => (
              <ReceiptRow
                checked={selectedPaidExpenses.has(item.id)}
                item={item}
                key={item.id}
                name="expenseIds"
                onChange={(checked) =>
                  setSelectedPaidExpenseIds((current) =>
                    checked
                      ? [...new Set([...current, item.id])]
                      : current.filter((id) => id !== item.id),
                  )
                }
                value={item.id}
              />
            ))}
            {!paidCompanyRows.length ? (
              <p className="p-4 text-sm text-gray-600">
                No unmatched paid company receipts match this search.
              </p>
            ) : null}
          </div>
          <BatchSummary
            difference={difference}
            selectedCount={selectedCount}
            selectedTotal={selectedTotal}
            target={target}
          />
          <SubmitBatch
            disabled={!selectedCount || !exact}
            label={`Link ${selectedCount} paid receipt${selectedCount === 1 ? "" : "s"} & reconcile`}
          />
        </form>
      ) : mode === "unpaid" ? (
        <form action={reconcileCompanyExpenseBatchFromBankLine} className="space-y-4">
          <input name="lineId" type="hidden" value={lineId} />
          <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
            <input
              className="h-10 rounded-md border border-[#d7dde5] px-3 text-sm"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search supplier, receipt, property or room"
              value={query}
            />
            <select
              className="h-10 rounded-md border border-[#d7dde5] bg-white px-3 text-sm"
              defaultValue="company_bank"
              name="paymentMethod"
            >
              <option value="company_bank">Paid from company bank</option>
              <option value="company_card">Charged to company card</option>
            </select>
          </div>
          <div className="max-h-80 divide-y divide-[#e3e8ef] overflow-y-auto rounded-lg border border-[#d7dde5]">
            {unpaidCompanyRows.map((item) => (
              <ReceiptRow
                checked={selectedUnpaidExpenses.has(item.id)}
                item={item}
                key={item.id}
                name="expenseIds"
                onChange={(checked) =>
                  setSelectedUnpaidExpenseIds((current) =>
                    checked
                      ? [...new Set([...current, item.id])]
                      : current.filter((id) => id !== item.id),
                  )
                }
                value={item.id}
              />
            ))}
            {!unpaidCompanyRows.length ? (
              <p className="p-4 text-sm text-gray-600">
                No verified unpaid company receipts match this search.
              </p>
            ) : null}
          </div>
          <BatchSummary
            difference={difference}
            selectedCount={selectedCount}
            selectedTotal={selectedTotal}
            target={target}
          />
          <SubmitBatch
            disabled={!selectedCount || !exact}
            label={`Create receipt batch & reconcile ${selectedCount} bill${selectedCount === 1 ? "" : "s"}`}
          />
        </form>
      ) : (
        <form action={reconcileStaffPayoutFromBankLine} className="space-y-4">
          <input name="lineId" type="hidden" value={lineId} />
          <label className="block text-sm font-medium text-gray-700">
            Payee — all selected claims must belong to this person
            <select
              className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] bg-white px-3 text-sm"
              name="staffId"
              onChange={(event) => {
                setStaffId(event.target.value);
                setSelectedLiabilityIds([]);
              }}
              required
              value={staffId}
            >
              <option value="">Choose staff member</option>
              {staffGroups.map((group) => (
                <option key={group.staffId} value={group.staffId}>
                  {group.staffName} · owing {currency.format(group.total)}
                </option>
              ))}
            </select>
          </label>
          <input
            className="h-10 w-full rounded-md border border-[#d7dde5] px-3 text-sm"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search claim, property or room"
            value={query}
          />
          <div className="max-h-80 divide-y divide-[#e3e8ef] overflow-y-auto rounded-lg border border-[#d7dde5]">
            {staffRows.map((item) => (
              <ReceiptRow
                checked={selectedLiabilities.has(item.liabilityId)}
                item={item}
                key={item.liabilityId}
                name="liabilityIds"
                onChange={(checked) =>
                  setSelectedLiabilityIds((current) =>
                    checked
                      ? [...new Set([...current, item.liabilityId])]
                      : current.filter((id) => id !== item.liabilityId),
                  )
                }
                value={item.liabilityId}
              />
            ))}
            {!staffRows.length ? (
              <p className="p-4 text-sm text-gray-600">
                Choose a staff member with approved unpaid claims.
              </p>
            ) : null}
          </div>
          <BatchSummary
            difference={difference}
            selectedCount={selectedCount}
            selectedTotal={selectedTotal}
            target={target}
          />
          <SubmitBatch
            disabled={!staffId || !selectedCount || !exact}
            label={`Pay staff, clear ${selectedCount} claim${selectedCount === 1 ? "" : "s"} & reconcile`}
          />
        </form>
      )}

      <p className="flex items-start gap-2 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">
        <Building2 className="mt-0.5 h-4 w-4 shrink-0" />
        Accounting rule: the receipts record the expense; this bank/card line records settlement. DEKEZ links them without posting the expense twice.
      </p>
    </div>
  );
}

function BatchSummary({
  difference,
  selectedCount,
  selectedTotal,
  target,
}: {
  difference: number;
  selectedCount: number;
  selectedTotal: number;
  target: number;
}) {
  const exact = Math.abs(difference) < 0.005;
  return (
    <div className="grid gap-2 rounded-lg border border-[#d7dde5] bg-white p-4 text-sm sm:grid-cols-3">
      <div>
        <span className="text-gray-600">Statement payment</span>
        <strong className="mt-1 block text-lg">{currency.format(target)}</strong>
      </div>
      <div>
        <span className="text-gray-600">{selectedCount} selected receipts</span>
        <strong className="mt-1 block text-lg">{currency.format(selectedTotal)}</strong>
      </div>
      <div>
        <span className="text-gray-600">Difference must be RM0.00</span>
        <strong className={`mt-1 block text-lg ${exact ? "text-emerald-700" : "text-red-600"}`}>
          {currency.format(difference)}
        </strong>
      </div>
    </div>
  );
}
