import { Link } from "@/components/app-link";
import { adjacentMovementMonth, getMonthlyTenantMovements, type TenantMovement } from "@/lib/data/tenant-movements";
import { formatMalaysiaDate, formatMalaysiaDateTime } from "@/lib/date-format";

export const dynamic = "force-dynamic";

function MovementTable({ items, checkout }: { items: TenantMovement[]; checkout: boolean }) {
  return <div className="overflow-x-auto rounded-xl border bg-white">
    <table className="w-full text-left text-sm">
      <caption className={`p-4 text-left text-lg font-semibold ${checkout ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}>
        {checkout ? "Check-outs" : "New Check-ins"} · {items.length}
      </caption>
      <thead className="border-b bg-slate-50 text-slate-600"><tr>
        <th scope="col" className="p-3">{checkout ? "Check-out date" : "Check-in date"}</th>
        <th scope="col" className="p-3">Tenant</th><th scope="col" className="p-3">Property / outlet</th>
        <th scope="col" className="p-3">Room</th>
        {checkout ? <th scope="col" className="p-3">Recorded by / notes</th> : null}
      </tr></thead>
      <tbody className="divide-y">{items.length ? items.map((item) => <tr key={item.id}>
        <td className="whitespace-nowrap p-3">{formatMalaysiaDate(item.date)}</td>
        <td className="p-3 font-medium">{item.tenantName}</td><td className="p-3">{item.propertyName}</td>
        <td className="whitespace-nowrap p-3">{item.roomName}</td>
        {checkout ? <td className="max-w-sm p-3"><p>{item.recordedBy ?? "Not recorded in older record"}</p>
          {item.recordedAt ? <p className="text-xs text-slate-500">Recorded {formatMalaysiaDateTime(item.recordedAt)}</p> : null}
          {item.note ? <p className="mt-1 break-words text-slate-600">{item.note}</p> : null}
        </td> : null}
      </tr>) : <tr><td colSpan={checkout ? 5 : 4} className="p-6 text-center text-slate-500">No {checkout ? "check-outs" : "new check-ins"} recorded for this month and outlet.</td></tr>}</tbody>
    </table>
  </div>;
}

export default async function TenantMovementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const report = await getMonthlyTenantMovements(typeof params.month === "string" ? params.month : undefined, typeof params.property === "string" ? params.property : undefined);
  const monthLabel = new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${report.month}-01T00:00:00Z`));
  const monthLink = (offset: number) => `/tenant-movements?${new URLSearchParams({ month: adjacentMovementMonth(report.month, offset), ...(report.propertyId ? { property: report.propertyId } : {}) })}`;
  return <section className="mx-auto max-w-7xl space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-sm font-medium uppercase tracking-wide text-[#9d7424]">Tenant activity</p>
        <h1 className="text-2xl font-semibold">Monthly Check-ins & Check-outs</h1>
        <p className="mt-2 text-sm text-slate-600">See who moved in and who checked out, month by month, across all outlets or one property.</p></div>
      <Link href="/reservations" className="rounded-lg border bg-white px-4 py-2 font-medium">Reservations →</Link>
    </header>
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4">
      <label className="text-sm font-medium">Month<input key={report.month} type="month" name="month" defaultValue={report.month} min="1900-01" max="2199-12" required className="mt-1 block rounded-lg border p-2" /></label>
      <label className="min-w-48 flex-1 text-sm font-medium">Property / outlet<select key={report.propertyId} name="property" defaultValue={report.propertyId} className="mt-1 block w-full rounded-lg border bg-white p-2">
        <option value="">All outlets</option>{report.properties.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}
      </select></label>
      <button type="submit" className="rounded-lg bg-[#b98a2c] px-5 py-2 font-medium text-white">Show month</button>
      <div className="flex gap-3 p-2 text-sm"><Link href={monthLink(-1)} className="underline">← Previous month</Link><Link href={monthLink(1)} className="underline">Next month →</Link></div>
    </form>
    <h2 className="text-xl font-semibold">{monthLabel} · {report.properties.find((p) => p.id === report.propertyId)?.name ?? "All outlets"}</h2>
    <p className="text-sm text-slate-600">Uses saved check-in and check-out dates, not registration or payment dates. Reservations awaiting check-in and future dates are excluded. Room changes keep the original check-in date; the check-in list shows the room currently recorded on that tenancy.</p>
    {report.error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{report.error}</p> : <>
      <div className="grid grid-cols-2 gap-3">
        <a href="#check-ins" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"><p>New Check-ins</p><p className="text-3xl font-bold">{report.checkIns.length}</p></a>
        <a href="#check-outs" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900"><p>Check-outs</p><p className="text-3xl font-bold">{report.checkOuts.length}</p></a>
      </div>
      <div id="check-ins" className="scroll-mt-24"><MovementTable items={report.checkIns} checkout={false} /></div>
      <div id="check-outs" className="scroll-mt-24"><MovementTable items={report.checkOuts} checkout /></div>
    </>}
    <p className="text-xs text-slate-500">Read-only report · No tenant, receipt, deposit or accounting records are changed here.</p>
  </section>;
}
