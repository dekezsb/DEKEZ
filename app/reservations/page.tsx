import { Link } from "@/components/app-link";
import { getCurrentUserAccess, requireRole } from "@/lib/auth/session";
import { hasModuleAccess } from "@/lib/auth/access";
import { getProperties } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { malaysiaDateString } from "@/lib/data/rent-due";
import { ReservationPaymentForm } from "./payment-form";
import { requestReservationCheckIn, cancelReservation } from "./actions";
import { allocatePaymentPurpose, isPaymentPurpose } from "@/lib/payments/payment-purpose";

const money = (value: number) => `RM ${value.toFixed(2)}`;
export default async function ReservationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const role = await requireRole(["super_admin", "admin"], { module: "properties", level: "view" });
  const { access } = await getCurrentUserAccess();
  const canManage = hasModuleAccess(access, "properties", "manage");
  const params = await searchParams;
  const properties = await getProperties();
  const propertyId = properties.some((property) => property.id === params.property) ? params.property : "";
  const db = createAdminClient();
  const { data: applications, error } = await db.from("tenant_applications")
    .select("id, full_name, property_id, monthly_rent, deposit, utility_deposit, proposed_start_date, proposed_end_date, verification_status, rooms(room_number)")
    .eq("registration_mode", "reservation").in("status", ["submitted", "approved", "pending_verification"])
    .in("property_id", properties.filter((property) => !propertyId || property.id === propertyId).map((property) => property.id)).order("submitted_at", { ascending: false });
  const { data: payments, error: paymentsError } = applications?.length ? await db.from("payment_submissions")
    .select("id, tenant_application_id, amount, payment_date, payment_type, verification_status, receipt_url, payment_note")
    .in("tenant_application_id", applications.map((application) => application.id)).order("payment_date") : { data: [], error: null };
  const receipts = new Map<string, string>();
  await Promise.all((payments ?? []).map(async (payment) => {
    if (!payment.receipt_url) return;
    const { data } = await db.storage.from("payment-receipts").createSignedUrl(payment.receipt_url, 600);
    if (data?.signedUrl) receipts.set(payment.id, data.signedUrl);
  }));
  return <section className="mx-auto max-w-5xl space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Reservations</h1><p className="mt-1 text-sm text-slate-600">Room reservations & instalments · Before tenant check-in</p></div>
      <Link className="rounded-lg border bg-white px-4 py-2" href="/tenant-movements">Monthly Check-ins & Check-outs →</Link>
    </header>
    {params.cancelled ? <p className="rounded bg-green-50 p-3">Reservation cancelled. Payment history is retained; no refund or forfeiture was posted.</p> : null}
    <div className="flex flex-wrap gap-3">
      {canManage ? <Link className="rounded-lg bg-[#b98a2c] px-4 py-2 font-medium text-white" href="/register-tenant">+ Register tenant / reserve another room</Link> : null}
      {hasModuleAccess(access, "verification") ? <Link className="rounded-lg border bg-white px-4 py-2" href="/verification">Reservation & check-in approvals</Link> : null}
    </div>
    <p>Reservations hold a room before check-in. Keep every payment slip here. Request check-in with the actual date when the tenant arrives; your main account approves the check-in and applies the payment slips to the invoice.</p>
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
      <label className="min-w-48 flex-1 text-sm font-medium">Property / outlet<select key={propertyId} name="property" defaultValue={propertyId} className="mt-1 block w-full rounded border bg-white p-2"><option value="">All outlets</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
      <button className="rounded bg-[#b98a2c] px-4 py-2 text-white">Show reservations</button>
    </form>
    {!error ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 font-semibold text-amber-900">{applications?.length ?? 0} active reservations {propertyId ? "at this outlet" : "across all outlets"}</p> : null}
    {params.error || error || paymentsError ? <p role="alert" className="rounded bg-red-50 p-3 text-red-800">Unable to complete this request. Check the amount, payment slip and dates, then refresh and try again.</p> : null}
    {params.saved ? <p className="rounded bg-green-50 p-3">Instalment saved for verification.</p> : null}
    {params.requested ? <p className="rounded bg-green-50 p-3">Check-in requested. Your main account can approve it in Tenant Verification.</p> : null}
    {!applications?.length && !error ? <p>No active reservations. Choose “Reserve room only” on the registration form.</p> : null}
    {(applications ?? []).map((application) => {
      const slips = (payments ?? []).filter((payment) => payment.tenant_application_id === application.id);
      const submitted = slips.filter((payment) => payment.verification_status !== "rejected").reduce((total, payment) => total + Number(payment.amount), 0);
      let rentRemaining = Number(application.monthly_rent);
      let depositRemaining = Number(application.deposit) + Number(application.utility_deposit);
      for (const slip of slips.filter((payment) => payment.verification_status !== "rejected")) {
        const allocation = allocatePaymentPurpose({ purpose: isPaymentPurpose(slip.payment_type) ? slip.payment_type : "other", amount: Number(slip.amount), rentOutstanding: rentRemaining, depositOutstanding: depositRemaining });
        rentRemaining -= allocation.rent;
        depositRemaining -= allocation.deposit;
      }
      const room = Array.isArray(application.rooms) ? application.rooms[0] : application.rooms;
      return <article key={application.id} className="space-y-4 rounded-lg border bg-white p-5">
        <h2 className="text-lg font-semibold">{properties.find((property) => property.id === application.property_id)?.name} / {room?.room_number} — {application.full_name}</h2>
        <p>Reservation: {application.verification_status.replaceAll("_", " ")} · Expected arrival: {application.proposed_start_date}</p>
        <p>First rent: {money(Number(application.monthly_rent))} · Required deposit: {money(Number(application.deposit) + Number(application.utility_deposit))}</p>
        <p>Slips submitted: {money(submitted)} · Remaining before verification: rent {money(rentRemaining)}, deposit {money(depositRemaining)}</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Date</th><th>Purpose</th><th>Amount</th><th>Status / note</th><th>Slip</th></tr></thead><tbody>{slips.map((payment) => <tr key={payment.id}><td className="py-2">{payment.payment_date}</td><td>{payment.payment_type.replaceAll("_", " ")}</td><td>{money(Number(payment.amount))}</td><td>{payment.verification_status.replaceAll("_", " ")} {payment.payment_note}</td><td>{receipts.get(payment.id) ? <a href={receipts.get(payment.id)} target="_blank" rel="noreferrer" className="underline">View</a> : "—"}</td></tr>)}</tbody></table></div>
        {canManage ? <><details><summary className="cursor-pointer font-semibold">Add payment / partial-payment slip</summary><div className="pt-3"><ReservationPaymentForm key={`${application.id}:${slips.length}`} applicationId={application.id} date={malaysiaDateString()} /></div></details>
        <details><summary className="cursor-pointer font-semibold">Tenant arriving — request check-in</summary><form action={requestReservationCheckIn} className="mt-3 flex flex-wrap items-end gap-3">
          <input name="applicationId" type="hidden" value={application.id} />
          <label>Actual check-in date<input className="block rounded border p-2" name="checkInDate" type="date" required defaultValue={malaysiaDateString()} /></label>
          <label>Contract end (if applicable)<input className="block rounded border p-2" name="contractEnd" type="date" defaultValue={application.proposed_end_date ?? ""} /></label>
          <details className="w-full rounded border p-3"><summary className="cursor-pointer">Add IC / passport photos and emergency contact for check-in</summary>
            <p className="my-2 text-sm text-slate-600">These are check-in documents, not additional deposit slips. Existing documents stay attached.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>IC front<input className="block w-full text-sm" name="icFront" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></label>
              <label>IC back<input className="block w-full text-sm" name="icBack" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></label>
              <label>Passport photo page (instead of IC)<input className="block w-full text-sm" name="passportPhoto" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></label>
              <label>Emergency contact name<input className="block w-full rounded border p-2" name="emergencyContactName" /></label>
              <label>Emergency contact number<input className="block w-full rounded border p-2" name="emergencyContactNumber" type="tel" /></label>
            </div>
          </details>
          <button className="rounded bg-[#b98a2c] px-4 py-2 text-white">Submit check-in for approval</button>
        </form></details></> : null}
        {role === "super_admin" && canManage ? <details><summary className="cursor-pointer font-semibold text-red-700">Main account — cancel reservation / release room</summary><form action={cancelReservation} className="mt-3 space-y-3 rounded border border-red-200 p-3">
          <input type="hidden" name="applicationId" value={application.id} />
          <label className="block">Cancellation reason<input className="block w-full rounded border p-2" name="reason" required /></label>
          <label className="flex gap-2"><input type="checkbox" name="confirm" value="1" required />Cancel this reservation and release the room. Retain all payment slips and audit history.</label>
          <button className="rounded bg-red-700 px-4 py-2 text-white">Cancel reservation</button>
        </form></details> : null}
      </article>;
    })}
  </section>;
}
