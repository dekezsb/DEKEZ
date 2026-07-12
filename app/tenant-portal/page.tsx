import { getCurrentUserContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function TenantPortalPage() {
  const { profile } = await getCurrentUserContext();
  const supabase = await createClient();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, full_name")
    .eq("profile_id", profile.id)
    .maybeSingle();

  const { data: tenancy } = tenant
    ? await supabase
        .from("tenancies")
        .select("id, monthly_rent, deposit, start_date, end_date, due_day, status")
        .eq("tenant_id", tenant.id)
        .eq("status", "active")
        .maybeSingle()
    : { data: null };

  return (
    <section className="w-full">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-normal text-[#126b5f]">
          Tenant Portal
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal text-gray-950 sm:text-3xl">
          Welcome{profile.full_name ? `, ${profile.full_name}` : ""}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          View your rental details, payment history and maintenance requests.
        </p>
      </div>

      {tenancy ? (
        <div className="rounded-lg border border-[#d7dde5] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-950">Current tenancy</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-gray-500">Monthly rent</dt>
              <dd className="mt-1 font-semibold text-gray-950">
                RM {Number(tenancy.monthly_rent).toFixed(2)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Deposit</dt>
              <dd className="mt-1 font-semibold text-gray-950">
                RM {Number(tenancy.deposit).toFixed(2)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Contract start</dt>
              <dd className="mt-1 font-semibold text-gray-950">
                {tenancy.start_date}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Due day</dt>
              <dd className="mt-1 font-semibold text-gray-950">
                Day {tenancy.due_day} each month
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="rounded-lg border border-[#d7dde5] bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-950">
            Your room or tenancy has not been assigned yet.
          </h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            The Owner or Admin Team can later assign your account to a company,
            room and tenancy contract.
          </p>
        </div>
      )}
    </section>
  );
}
