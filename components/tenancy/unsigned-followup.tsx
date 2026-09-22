import { Link } from "@/components/app-link";
import type { AgreementArchiveItem } from "@/components/verification/agreement-archive";
import { neverSignedTenancies } from "@/lib/tenancy/unsigned-followup";
import { malaysiaToday } from "@/lib/tenancy/agreement";
import { formatMalaysiaDate } from "@/lib/date-format";

export function UnsignedTenancyFollowup({ agreements }: { agreements: AgreementArchiveItem[] }) {
  const today = malaysiaToday();
  const rows = neverSignedTenancies(agreements, today);
  const overdue = rows.filter(row => row.expired && row.standby).length;
  return (
    <details className="rounded-lg border border-amber-300 bg-white p-4" open={overdue > 0}>
      <summary className="cursor-pointer font-semibold">Never signed any TA: {rows.length} rooms · Expired with next version ready: {overdue}</summary>
      <p className="my-3 text-sm text-gray-600">Live list of current tenants with no signature on any version. Expiry is calculated from term dates. Signed or processing copies stay in the archive below. Review overlapping terms before asking for signatures; never ask a tenant to sign conflicting copies.</p>
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead><tr><th className="p-2">Property / room / tenant</th><th className="p-2">Unsigned versions and dates</th><th className="p-2">Follow-up</th></tr></thead>
          <tbody>{rows.map(row => <tr className="border-t" key={row.tenancyId}>
            <td className="p-2 align-top">{row.pending[0].property_name_snapshot} · {row.pending[0].room_name_snapshot}<br />{row.pending[0].tenant_name_snapshot}</td>
            <td className="p-2">{row.pending.map(a => <p key={a.id} className="mb-2"><Link className="underline" href={`/e-tenancy/${a.id}`}>V{a.version_number} · {formatMalaysiaDate(a.term_start_date)}–{formatMalaysiaDate(a.term_end_date)}</Link>{a.term_end_date && a.term_end_date < today ? " · Expired / unsigned" : " · Awaiting signature"}</p>)}</td>
            <td className="p-2 align-top">{row.overlap ? "Date overlap — management review first" : row.expired && row.standby ? "Ask tenant to review and sign old and next terms" : row.expired ? "Expired — next term needs review" : "Request signature"}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}
