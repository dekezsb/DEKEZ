import { Link } from "@/components/app-link";
import { requireRole } from "@/lib/auth/session";
import { getProperties } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { malaysiaDateString } from "@/lib/data/rent-due";
import { ReservationPaymentForm } from "./payment-form";
import { requestReservationCheckIn, cancelReservation } from "./actions";
import { allocatePaymentPurpose, isPaymentPurpose } from "@/lib/payments/payment-purpose";

const money = (value: number) => `RM ${value.toFixed(2)}`;
export default async function ReservationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(["super_admin", "admin"]);
  const params = await searchParams;
  const properties = await getProperties();
  const db = createAdminClient();
  const { data: applications, error } = await db.from("tenant_applications")
    .select("id, full_name, property_id, monthly_rent, deposit, utility_deposit, proposed_start_date, proposed_end_date, verification_status, rooms(room_number)")
    .eq("registration_mode", "reservation").in("status", ["submitted", "approved", "pending_verification"])
    .in("property_id", properties.map((property) => property.id)).order("submitted_at", { ascending: false });
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
    <h1 className="text-2xl font-semibold">Room reservations & instalments</h1>
    {params.cancelled ? <p className="rounded bg-green-50 p-3">Reservation cancelled. Payment history is retained; no refund or forfeiture was posted.</p> : null}
    <Link className="underline" href="/register-tenant">Register tenant / reserve another room</Link>
    <p>Reservations hold a room before check-in. Keep every payment slip here. Request check-in with the actual date when the tenant arrives; your main account approves the check-in and applies the payment slips to the invoice.</p>
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
        <details><summary className="cursor-pointer font-semibold">Add payment / partial-payment slip</summary><div className="pt-3"><ReservationPaymentForm key={`${application.id}:${slips.length}`} applicationId={application.id} date={malaysiaDateString()} /></div></details>
        <details><summary className="cursor-pointer font-semibold">Tenant arriving — request check-in</summary><form action={requestReservationCheckIn} className="mt-3 flex flex-wrap items-end gap-3">
          <input name="applicationId" type="hidden" value={application.id} />
          <label>Actual check-in date<input className="block rounded border p-2" name="checkInDate" type="date" required defaultValue={malaysiaDateString()} /></label>
          <label>Contract end (if applicable)<input className="block rounded border p-2" name="contractEnd" type="date" defaultValue={application.proposed_end_date ?? ""} /></label>
          <button className="rounded bg-[#b98a2c] px-4 py-2 text-white">Submit check-in for approval</button>
        </form></details>
        <details><summary className="cursor-pointer font-semibold text-red-700">Main account — cancel reservation / release room</summary><form action={cancelReservation} className="mt-3 space-y-3 rounded border border-red-200 p-3">
          <input type="hidden" name="applicationId" value={application.id} />
          <label className="block">Cancellation reason<input className="block w-full rounded border p-2" name="reason" required /></label>
          <label className="flex gap-2"><input type="checkbox" name="confirm" value="1" required />Cancel this reservation and release the room. Retain all payment slips and audit history.</label>
          <button className="rounded bg-red-700 px-4 py-2 text-white">Cancel reservation</button>
        </form></details>
      </article>;
    })}
  </section>;
}
