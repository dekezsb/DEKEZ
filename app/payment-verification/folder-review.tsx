"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { reviewFolderSlip } from "./folder-review-actions";

export function FolderReview({ id }: { id: string }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  return <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
    <p className="font-semibold">Awaiting bank verification</p>
    <label className="flex gap-2"><input type="checkbox" checked={checked} disabled={busy} onChange={(e) => setChecked(e.target.checked)} />I checked my bank: this transfer was received.</label>
    <button type="button" disabled={!checked || busy} className="rounded bg-[#b98a2c] px-4 py-2 font-semibold text-white disabled:opacity-50" onClick={async () => {
      setBusy(true); setMessage("");
      try { const result = await reviewFolderSlip(id, checked); setMessage(result); router.refresh(); }
      catch { setMessage("Could not confirm verification. Refresh to check; retrying cannot count this slip twice."); }
      finally { setBusy(false); }
    }}>{busy ? "Verifying…" : "Verify this slip"}</button>
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
