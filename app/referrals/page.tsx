import { Gift, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { formatMalaysiaDate, formatMalaysiaDateTime } from "@/lib/date-format";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  recheckReferral,
  rejectReferral,
  saveReferralPromotion,
} from "./actions";

const money = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

type PageProps = {
  searchParams: Promise<{
    saved?: string;
    checked?: string;
    rejected?: string;
    error?: string;
  }>;
};

function relationName(value: { full_name?: string; name?: string; room_number?: string | null } | null | undefined) {
  return value?.full_name ?? value?.room_number ?? value?.name ?? "-";
}

export default async function ReferralManagementPage({ searchParams }: PageProps) {
  await requireRole(["super_admin", "admin"], {
    module: "verification",
    level: "view",
  });
  const query = await searchParams;
  const admin = createAdminClient();
  const { data: company } = await admin
    .from("companies")
    .select("id, name")
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle();

  const [{ data: promotion }, { data: referrals }] = company
    ? await Promise.all([
        admin
          .from("referral_promotions")
          .select("id, promotion_name, reward_amount, minimum_contract_months, start_date, end_date, enabled")
          .eq("company_id", company.id)
          .order("start_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin
          .from("tenant_referrals")
          .select("id, referrer_tenant_id, referred_application_id, tenancy_id, property_id, room_id, registration_date, approved_at, reward_amount, status, rejection_reason, applied_invoice_id")
          .eq("company_id", company.id)
          .order("registration_date", { ascending: false }),
      ])
    : [{ data: null }, { data: [] }];

  const rows = referrals ?? [];
  const referrerIds = [...new Set(rows.map((row) => row.referrer_tenant_id))];
  const applicationIds = [...new Set(rows.map((row) => row.referred_application_id))];
  const tenancyIds = rows.map((row) => row.tenancy_id).filter((id): id is string => Boolean(id));
  const propertyIds = [...new Set(rows.map((row) => row.property_id))];
  const roomIds = [...new Set(rows.map((row) => row.room_id))];
  const [referrersResult, applicationsResult, tenanciesResult, propertiesResult, roomsResult, auditResult] =
    await Promise.all([
      referrerIds.length
        ? admin.from("tenants").select("id, full_name, phone").in("id", referrerIds)
        : Promise.resolve({ data: [] }),
      applicationIds.length
        ? admin.from("tenant_applications").select("id, full_name, contract_duration_months, status, verification_status, payment_status").in("id", applicationIds)
        : Promise.resolve({ data: [] }),
      tenancyIds.length
        ? admin.from("tenancies").select("id, check_in_date, checkout_date, status, billing_status").in("id", tenancyIds)
        : Promise.resolve({ data: [] }),
      propertyIds.length
        ? admin.from("properties").select("id, name, property_code").in("id", propertyIds)
        : Promise.resolve({ data: [] }),
      roomIds.length
        ? admin.from("rooms").select("id, name, room_number").in("id", roomIds)
        : Promise.resolve({ data: [] }),
      rows.length
        ? admin.from("referral_audit_logs").select("id, referral_id, action, status, reward_amount, invoice_applied_id, applied_by, created_at").in("referral_id", rows.map((row) => row.id)).order("created_at", { ascending: false }).limit(50)
        : Promise.resolve({ data: [] }),
    ]);

  const referrers = new Map((referrersResult.data ?? []).map((row) => [row.id, row]));
  const applications = new Map((applicationsResult.data ?? []).map((row) => [row.id, row]));
  const tenancies = new Map((tenanciesResult.data ?? []).map((row) => [row.id, row]));
  const properties = new Map((propertiesResult.data ?? []).map((row) => [row.id, row]));
  const rooms = new Map((roomsResult.data ?? []).map((row) => [row.id, row]));
  const pending = rows.filter((row) => row.status === "pending").length;
  const approved = rows.filter((row) => row.status === "approved").length;
  const applied = rows.filter((row) => row.status === "reward_applied").length;
  const rejected = rows.filter((row) => row.status === "rejected").length;

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#b98a2c]">Admin Control</p>
        <h1 className="mt-2 text-3xl font-semibold">Referral Management</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          Track every referral from registration to check-in, then keep the
          RM50 rental credit and invoice application fully auditable.
        </p>
      </div>

      {query.saved || query.checked || query.rejected ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          Referral programme updated successfully.
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          The referral change could not be saved. Check the required details and try again.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Summary label="Pending" value={pending} />
        <Summary label="Approved credit" value={approved} />
        <Summary label="Reward applied" value={applied} />
        <Summary label="Rejected" value={rejected} />
      </div>

      {company ? (
        <Card>
          <CardHeader>
            <CardTitle>Promotion Settings</CardTitle>
            <CardDescription>
              This controls when new registrations may use a referral and what
              must be completed before credit approval.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={saveReferralPromotion} className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              <input name="companyId" type="hidden" value={company.id} />
              <input name="promotionId" type="hidden" value={promotion?.id ?? ""} />
              <label className="md:col-span-2 xl:col-span-2">
                <span className="text-sm font-medium">Promotion name</span>
                <input className="mt-2 h-11 w-full rounded-md border px-3" defaultValue={promotion?.promotion_name ?? "Invite a Friend & Earn RM50"} name="promotionName" required />
              </label>
              <Field defaultValue={promotion?.reward_amount ?? 50} label="Reward amount (RM)" name="rewardAmount" step="0.01" type="number" />
              <Field defaultValue={promotion?.minimum_contract_months ?? 6} label="Minimum contract" name="minimumContractMonths" step="1" type="number" />
              <Field defaultValue={promotion?.start_date ?? "2026-08-01"} label="Start date" name="startDate" type="date" />
              <Field defaultValue={promotion?.end_date ?? "2026-08-31"} label="End date" name="endDate" type="date" />
              <label className="flex items-center gap-3 md:col-span-2">
                <input defaultChecked={promotion?.enabled ?? true} name="enabled" type="checkbox" />
                <span className="text-sm font-medium">Promotion enabled</span>
              </label>
              <Button className="md:col-span-2 xl:col-span-2" type="submit">Save promotion</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Referral Applications</CardTitle>
          <CardDescription>
            Pending rewards are never issued during registration. The system
            approves only after verified payment, identity, signed agreement and check-in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.length ? rows.map((row) => {
            const referrer = referrers.get(row.referrer_tenant_id);
            const application = applications.get(row.referred_application_id);
            const tenancy = row.tenancy_id ? tenancies.get(row.tenancy_id) : null;
            const property = properties.get(row.property_id);
            const room = rooms.get(row.room_id);
            return (
              <article className="rounded-lg border border-gray-200 p-4" key={row.id}>
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="grid flex-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Detail label="Referrer" value={`${relationName(referrer)}${referrer?.phone ? ` · ${referrer.phone}` : ""}`} />
                    <Detail label="New tenant" value={application?.full_name ?? "-"} />
                    <Detail label="Property / Room" value={`${property?.property_code ?? property?.name ?? "-"} / ${relationName(room)}`} />
                    <Detail label="Registered" value={formatMalaysiaDateTime(row.registration_date)} />
                    <Detail label="Contract" value={`${application?.contract_duration_months ?? 0} months`} />
                    <Detail label="Check-in" value={tenancy?.check_in_date ? formatMalaysiaDate(tenancy.check_in_date) : "Not checked in"} />
                    <Detail label="Reward" value={money.format(Number(row.reward_amount))} />
                    <div>
                      <p className="text-xs text-gray-500">Reward status</p>
                      <Badge className={statusClass(row.status)}>{row.status.replaceAll("_", " ")}</Badge>
                    </div>
                  </div>
                  {row.status === "pending" ? (
                    <div className="grid min-w-72 gap-2">
                      <form action={recheckReferral}>
                        <input name="referralId" type="hidden" value={row.id} />
                        <Button className="w-full" type="submit" variant="outline"><ShieldCheck className="h-4 w-4" />Recheck conditions</Button>
                      </form>
                      <form action={rejectReferral} className="grid gap-2">
                        <input name="referralId" type="hidden" value={row.id} />
                        <input className="h-10 rounded-md border px-3 text-sm" name="reason" placeholder="Reason required to reject" required />
                        <Button className="w-full border-red-300 text-red-700 hover:bg-red-50" type="submit" variant="outline">Reject referral</Button>
                      </form>
                    </div>
                  ) : null}
                </div>
                {row.rejection_reason ? <p className="mt-3 text-sm text-red-700">Reason: {row.rejection_reason}</p> : null}
              </article>
            );
          }) : (
            <div className="flex items-center gap-3 rounded-md bg-gray-50 p-5 text-sm text-gray-600">
              <Gift className="h-5 w-5" /> No referral registrations yet.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit Log</CardTitle>
          <CardDescription>Approval, rejection and invoice use are retained here.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-gray-200">
          {(auditResult.data ?? []).length ? (auditResult.data ?? []).map((log) => (
            <div className="grid gap-2 py-3 text-sm sm:grid-cols-4" key={log.id}>
              <span className="font-medium">{log.action.replaceAll("_", " ")}</span>
              <span>{money.format(Number(log.reward_amount ?? 0))}</span>
              <span>{log.invoice_applied_id ? `Invoice ${log.invoice_applied_id.slice(0, 8)}` : "No invoice yet"}</span>
              <span className="text-gray-500">{formatMalaysiaDateTime(log.created_at)}</span>
            </div>
          )) : <p className="py-4 text-sm text-gray-500">No referral audit activity yet.</p>}
        </CardContent>
      </Card>
    </section>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <Card><CardHeader><CardDescription>{label}</CardDescription><CardTitle className="text-3xl">{value}</CardTitle></CardHeader></Card>;
}

function Field({ defaultValue, label, name, step, type }: { defaultValue: number | string; label: string; name: string; step?: string; type: string }) {
  return <label><span className="text-sm font-medium">{label}</span><input className="mt-2 h-11 w-full rounded-md border px-3" defaultValue={defaultValue} min={type === "number" ? "1" : undefined} name={name} required step={step} type={type} /></label>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-sm font-semibold text-gray-950">{value}</p></div>;
}

function statusClass(status: string) {
  if (status === "rejected") return "bg-red-100 text-red-800";
  if (status === "pending") return "bg-amber-100 text-amber-800";
  return "bg-emerald-100 text-emerald-800";
}
