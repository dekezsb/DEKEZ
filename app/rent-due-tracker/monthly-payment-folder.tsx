"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PaymentSlipFile } from "@/components/payment-slip-file";
import { getMonthlyPaymentFolder, submitPaymentFolderSlip } from "./actions";

type Folder = Awaited<ReturnType<typeof getMonthlyPaymentFolder>>;
type Slot = { id: string; saved?: boolean; message?: string; warning?: boolean };
const money = (n: number) => `RM ${n.toFixed(2)}`;
const newSlot = (): Slot => ({ id: crypto.randomUUID() });

export function MonthlyPaymentFolder({ billId, tenantName, roomName, propertyName, initial, onClose, paymentDateDefault }: {
  billId: string; tenantName: string; roomName: string; propertyName: string; initial: Folder; onClose: () => void; paymentDateDefault: string;
}) {
  const router = useRouter();
  const [folder, setFolder] = useState(initial);
  const [tab, setTab] = useState<"rental" | "deposit">(initial.rental.outstanding > 0 ? "rental" : "deposit");
  const [slots, setSlots] = useState<Record<"rental" | "deposit", Slot[]>>(() => ({ rental: [newSlot(), newSlot(), newSlot()], deposit: [newSlot(), newSlot(), newSlot()] }));
  const forms = useRef(new Map<string, HTMLFormElement>());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function save() {
    if (busy) return;
    const selected = slots[tab].filter((slot) => !slot.saved && (forms.current.get(slot.id)?.querySelector<HTMLInputElement>('input[type="file"]')?.files?.length ?? 0) > 0);
    if (!selected.length) { setNotice("Choose a bank-in slip in at least one box."); return; }
    if (selected.some((slot) => !forms.current.get(slot.id)?.reportValidity())) return;
    // Snapshot every form before disabling fields: disabled fields are omitted by FormData.
    const uploads = selected.map((slot) => ({ slot, data: new FormData(forms.current.get(slot.id)!) }));
    setBusy(true); setNotice("");
    try {
      for (const { slot, data } of uploads) {
        data.set("billId", billId); data.set("key", slot.id); data.set("purpose", tab === "rental" ? "monthly_rent" : "deposit");
        try {
          const result = await submitPaymentFolderSlip(data);
          setSlots((state) => ({ ...state, [tab]: state[tab].map((s) => s.id === slot.id ? { ...s, saved: result.ok, message: result.message, warning: result.warning } : s) }));
        } catch { setSlots((state) => ({ ...state, [tab]: state[tab].map((s) => s.id === slot.id ? { ...s, message: "Could not confirm saving. Retry this box; saved payments are protected from duplicates." } : s) })); }
      }
      setFolder(await getMonthlyPaymentFolder(billId));
      router.refresh();
      setNotice("Review the result under each box. Saved slips stay in this folder; only retry boxes that did not save.");
    } catch { setNotice("Could not refresh the history. Close and reopen the folder to check. Do not create another copy of a saved slip."); }
    finally { setBusy(false); }
  }

  function close() {
    const hasDrafts = Object.values(slots).flat().some((s) => !s.saved && (forms.current.get(s.id)?.querySelector<HTMLInputElement>('input[type="file"]')?.files?.length ?? 0) > 0);
    if (!busy && (!hasDrafts || window.confirm("Close without uploading the unsaved slips? Saved slips will stay in the folder."))) onClose();
  }
  return <div role="dialog" aria-modal="true" aria-labelledby="payment-folder-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
    <div className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white p-4 shadow-xl sm:p-6">
      <div className="flex items-start justify-between gap-3"><div><h2 id="payment-folder-title" className="text-xl font-semibold">{tenantName} — Payment folder</h2><p className="text-sm text-gray-600">{propertyName} / {roomName} · Rental month {folder.month.slice(0, 7)}</p></div><button type="button" className="rounded border px-3 py-2" disabled={busy} onClick={close}>Close</button></div>
      <div role="tablist" aria-label="Payment type" className="my-4 flex gap-2">
        {(["rental", "deposit"] as const).map((value) => <button type="button" role="tab" aria-selected={tab === value} aria-controls={`folder-${value}`} id={`tab-${value}`} key={value} disabled={busy} onClick={() => setTab(value)} className={`rounded-lg border px-5 py-3 font-semibold ${tab === value ? "border-[#b98a2c] bg-amber-50" : "bg-white"}`}>{value === "rental" ? "Rental — this month" : "Deposit — total balance"}</button>)}
      </div>
      {folder.mixedPending ? <p className="mb-3 rounded bg-amber-50 p-3 text-sm">An older combined rent/deposit slip is pending. Review its allocation in Verification; it is shown below but excluded from the separate pending totals to avoid guessing.</p> : null}
      {(["rental", "deposit"] as const).map((kind) => {
        const summary = folder[kind];
        const history = folder.slips.filter((s) => kind === "deposit" ? ["deposit", "rent_and_deposit"].includes(s.purpose) : s.billId === billId && s.purpose !== "deposit");
        return <section key={kind} id={`folder-${kind}`} role="tabpanel" aria-labelledby={`tab-${kind}`} hidden={tab !== kind}>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            {[["Required", summary.required], ["Verified paid", summary.verified], ["Awaiting verification", summary.pending], ["Official balance owing", summary.outstanding], ["Still to submit", summary.toSubmit]].map(([label, amount]) => <div key={String(label)} className="rounded-lg border bg-slate-50 p-3"><p className="text-xs text-gray-600">{label}</p><p className="mt-1 font-bold">{money(Number(amount))}</p></div>)}
          </div>
          {summary.excess > 0 ? <p className="mt-2 text-sm text-red-700">Pending slips exceed the outstanding balance by {money(summary.excess)}. Check for duplicates before verifying.</p> : null}
          <p className="my-3 text-sm text-gray-600">{kind === "deposit" ? "Deposit payments stay together across months for this tenancy, separately from rental." : "All instalments for this rental month stay together here."} Uploading is not verification.</p>
          <h3 className="font-semibold">Saved slips — check these before uploading</h3>
          <div className="my-3 grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-3">{history.length ? history.map((s, index) => <article key={s.id} className={`rounded-lg border p-3 text-sm ${s.status === "verified" ? "border-green-200 bg-green-50" : s.status === "rejected" ? "bg-gray-100" : "border-amber-200 bg-amber-50"}`}>
            <p className="font-semibold">Slip {index + 1} · {money(s.amount)}</p><p>{s.date}</p><p className="font-medium">{s.status === "verified" ? "Verified — already counted" : s.status === "pending_verification" ? "Awaiting bank verification" : s.status.replaceAll("_", " ")}</p>
            <p className="break-words">Reference: {s.reference || "Not entered"}</p>{s.note ? <p className="whitespace-pre-wrap">{s.note}</p> : null}{s.purpose === "rent_and_deposit" ? <p>Combined rent + deposit — review allocation</p> : null}
            {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="mt-2 inline-block underline">View bank-in slip</a> : <p>No slip available</p>}
          </article>) : <p className="text-sm text-gray-500">No saved slips yet.</p>}</div>
          <h3 className="mt-4 font-semibold">New bank-in slips</h3><p className="mb-3 text-sm text-gray-600">Use only the boxes you need. Enter the amount for each separate transfer, not the combined total.</p>
          <div className="grid gap-3 lg:grid-cols-3">{slots[kind].map((slot, index) => <form key={slot.id} ref={(el) => { if (el) forms.current.set(slot.id, el); else forms.current.delete(slot.id); }} onSubmit={(e) => e.preventDefault()} className="rounded-lg border p-3">
            <fieldset disabled={busy || slot.saved} className="space-y-2">
              <legend className="font-semibold">New slip {index + 1}{slot.saved ? " — Saved" : ""}</legend>
              <label className="block text-sm">Amount (RM)<input name="amount" type="number" min="0.01" step="0.01" required className="mt-1 w-full rounded border p-2" /></label>
              <label className="block text-sm">Bank-in date<input name="date" type="date" defaultValue={paymentDateDefault} required className="mt-1 w-full rounded border p-2" /></label>
              <label className="block text-sm">Bank reference<input name="reference" className="mt-1 w-full rounded border p-2" placeholder="Unique transaction reference" /></label>
              <label className="block text-sm">Note<input name="note" className="mt-1 w-full rounded border p-2" /></label>
              <label className="block text-sm">Bank-in photo / PDF<PaymentSlipFile /></label>
              {slot.warning ? <label className="flex gap-2 text-sm"><input type="checkbox" name="confirmSimilar" value="1" required />I checked: this is a different bank transfer.</label> : null}
            </fieldset>
            {slot.message ? <p role="status" className={`mt-2 text-sm ${slot.saved ? "text-green-800" : "text-red-700"}`}>{slot.message}</p> : null}
          </form>)}</div>
          <button type="button" disabled={busy} className="my-3 rounded border px-4 py-2" onClick={() => setSlots((s) => ({ ...s, [kind]: [...s[kind], newSlot()] }))}>+ Add one more slip box</button>
        </section>;
      })}
      {notice ? <p role="status" className="my-3 rounded bg-blue-50 p-3 text-sm">{notice}</p> : null}
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t bg-white py-3"><p className="text-sm">Your main account verifies each transfer against the bank.</p><button type="button" disabled={busy} onClick={save} className="rounded-lg bg-[#b98a2c] px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Saving slips…" : `Save ${tab === "rental" ? "rental" : "deposit"} slips together`}</button></div>
    </div>
  </div>;
}
