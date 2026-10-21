'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { previewHistoricalCredits, clearHistoricalCredits } from '@/app/reports/historical-credit-actions';
import { historicalCreditSummary, historicalExclusionLabels, type HistoricalCreditPreview } from '@/lib/accounting/historical-credit';

const money = (amount: number) => new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(amount);
export function HistoricalCreditCleanup({ bankId }: { bankId: string }) {
  const [preview, setPreview] = useState<HistoricalCreditPreview | null>(null);
  const [runId, setRunId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  const summary = historicalCreditSummary(preview?.rows ?? []);
  const ready = summary.reduce((n, row) => n + row.ready, 0);
  const newCredit = summary.reduce((n, row) => n + row.newCredit, 0);
  const exclusions = preview?.rows.filter(row => row.reason && row.reason !== 'already_completed') ?? [];
  function load() {
    setConfirmed(false); setPreview(null); setMessage('');
    start(async () => {
      try {
        const response = await previewHistoricalCredits(bankId);
        if (!response.ok) { setMessage(response.error); return; }
        setPreview(response.preview); setRunId(response.runId);
      } catch { setMessage('Unable to load the preview. No accounting records were changed.'); }
    });
  }
  function apply() {
    if (!preview || !confirmed) return;
    start(async () => {
      try {
        const response = await clearHistoricalCredits(bankId, runId, preview.hash, confirmed);
        if (!response.ok) { setMessage(response.error); return; }
        setMessage(`Processed ${response.result.cleared_count} bank items (${money(response.result.cleared_amount)}). New credit to Rental Receivable: ${money(response.result.new_ar_credit)}. ${response.result.completed_statements.length} statements completed. Any partial balances and exclusions remain unresolved.`);
        setPreview(null); setConfirmed(false); router.refresh();
      } catch { setMessage('Confirmation response was interrupted. Retry this same batch to retrieve its result without posting twice.'); }
    });
  }
  return <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm" aria-labelledby="historical-credit-title">
    <h2 id="historical-credit-title" className="font-semibold text-gray-950">March–August 2026 · Historical Money In cleanup</h2>
    <p className="mt-2">One confirmed batch for this bank account, across all six historical months. Destination: <strong>1100 · Rental Receivable</strong>. No tenant, room, invoice or receipt selection is required.</p>
    <p className="mt-2">Existing settlements are linked, not posted again. Transfers, security deposits, ambiguous or unsupported accounting sources are excluded. No new Bank, Income, payment, receipt or invoice is created. Money Out and September onward are unchanged.</p>
    <button type="button" onClick={load} disabled={pending} className="mt-3 rounded border border-gray-400 bg-white px-3 py-2 disabled:opacity-50">{pending ? 'Checking…' : 'Preview historical bulk cleanup'}</button>
    {message && <p role="status" className="mt-3 font-medium">{message}</p>}
    {preview && <>
      <div className="mt-4 overflow-x-auto"><table className="w-full border-collapse bg-white text-right">
        <caption className="py-2 text-left">Confirmation totals · adjustments dated {preview.adjustment_date}; original bank dates retained</caption>
        <thead><tr>{['Month', 'Transactions', 'Money In', 'Already completed / allocated', 'Ready to clear', 'New credit to 1100', 'Excluded / remaining'].map(label => <th scope="col" key={label} className="border p-2">{label}</th>)}</tr></thead>
        <tbody>{summary.map(row => <tr key={row.month}><th scope="row" className="border p-2">{row.month}</th><td className="border p-2">{row.count}</td>{[row.total, row.completed, row.ready, row.newCredit, row.excluded].map((value, index) => <td className="border p-2" key={index}>{money(value)}</td>)}</tr>)}</tbody>
      </table></div>
      <p className="mt-3">Ready: <strong>{money(ready)}</strong>. Of this, <strong>{money(newCredit)}</strong> is a new receivable reclassification; the rest is already recorded and receives links only. Missing accounting evidence is not treated as an unpaid receivable.</p>
      <details className="mt-3"><summary className="cursor-pointer">Protected exclusions ({exclusions.length})</summary><ul className="mt-2 max-h-72 overflow-y-auto bg-white p-3">{exclusions.map(row => <li className="border-b py-2" key={row.id}>{row.date} · {money(row.remaining)} · {row.reference || 'No reference'} · {row.description}<br /><strong>{historicalExclusionLabels[row.reason ?? ''] ?? 'Accounting safeguard'}</strong></li>)}</ul></details>
      <label className="mt-4 flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={pending || ready <= 0} onChange={event => setConfirmed(event.target.checked)} /><span>I approve the displayed eligible amounts only. Exclusions stay protected. A month completes only when both Money In and Money Out have no remaining work.</span></label>
      <button type="button" disabled={pending || !confirmed || ready <= 0} onClick={apply} className="mt-3 rounded bg-emerald-800 px-4 py-2 font-semibold text-white disabled:opacity-50">Clear eligible historical credits</button>
    </>}
  </section>;
}
