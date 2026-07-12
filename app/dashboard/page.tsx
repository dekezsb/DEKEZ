import { MetricCard } from "@/components/metric-card";
import { getCurrentUserContext, isSuperAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const { profile, memberships } = await getCurrentUserContext();
  const supabase = await createClient();
  const canSeeAllCompanies = isSuperAdmin(profile.global_role);

  const [{ count: companiesCount }, { count: usersCount }] = await Promise.all([
    canSeeAllCompanies
      ? supabase.from("companies").select("id", { count: "exact", head: true })
      : Promise.resolve({ count: memberships.length }),
    canSeeAllCompanies
      ? supabase.from("company_users").select("id", { count: "exact", head: true })
      : Promise.resolve({ count: memberships.length }),
  ]);

  return (
    <section className="w-full">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-normal text-[#126b5f]">
          Phase 2
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal text-gray-950 sm:text-3xl">
          Dashboard
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          Company and user management foundation is active.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Your role"
          value={profile.global_role.replaceAll("_", " ")}
          helper="Current access level"
        />
        <MetricCard
          label="Companies"
          value={companiesCount ?? 0}
          helper={canSeeAllCompanies ? "Total companies" : "Assigned companies"}
        />
        <MetricCard
          label="Company users"
          value={usersCount ?? 0}
          helper="Active assignments"
        />
        <MetricCard label="Modules" value="5" helper="Page shells online" />
      </div>

      <div className="mt-6 rounded-lg border border-[#d7dde5] bg-white shadow-sm">
        <div className="border-b border-[#d7dde5] px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-950">Company access</h2>
          <p className="mt-1 text-sm text-gray-500">
            Companies available to your current user.
          </p>
        </div>
        <div className="divide-y divide-[#d7dde5]">
          {memberships.length > 0 ? (
            memberships.map((membership) => (
              <div
                className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                key={membership.id}
              >
                <div>
                  <p className="font-medium text-gray-950">
                    {membership.companies?.name ?? "Company"}
                  </p>
                  <p className="text-sm text-gray-500">
                    {membership.role.replaceAll("_", " ")}
                  </p>
                </div>
                <span className="w-fit rounded-full bg-[#e7f2f0] px-3 py-1 text-xs font-semibold text-[#126b5f]">
                  {membership.status}
                </span>
              </div>
            ))
          ) : (
            <div className="px-5 py-8 text-sm text-gray-500">
              No company assignment yet.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
