import { getCurrentUserContext, isSuperAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { SettingsForms } from "./settings-forms";

export default async function SettingsPage() {
  const { profile, memberships } = await getCurrentUserContext();
  const supabase = await createClient();
  const canCreateCompany = isSuperAdmin(profile.global_role);

  const { data: companies } = canCreateCompany
    ? await supabase
        .from("companies")
        .select("id, name, status")
        .order("created_at", { ascending: false })
    : {
        data: memberships
          .filter((membership) => membership.role === "owner")
          .map((membership) => membership.companies)
          .filter(Boolean),
      };

  const companyOptions = (companies ?? [])
    .filter((company): company is NonNullable<typeof company> => Boolean(company))
    .map((company) => ({
      id: company.id,
      name: company.name,
      status: company.status,
    }));

  return (
    <section className="w-full">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-normal text-[#126b5f]">
          Administration
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal text-gray-950 sm:text-3xl">
          Settings
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          Manage companies and assign users. Business modules remain untouched for
          the next phases.
        </p>
      </div>

      <SettingsForms
        canCreateCompany={canCreateCompany}
        companies={companyOptions}
      />

      <section className="mt-6 rounded-lg border border-[#d7dde5] bg-white shadow-sm">
        <div className="border-b border-[#d7dde5] px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-950">Companies</h2>
          <p className="mt-1 text-sm text-gray-500">
            Companies you can manage from this account.
          </p>
        </div>
        <div className="divide-y divide-[#d7dde5]">
          {companyOptions.length > 0 ? (
            companyOptions.map((company) => (
              <div
                className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                key={company.id}
              >
                <p className="font-medium text-gray-950">{company.name}</p>
                <span className="w-fit rounded-full bg-[#e7f2f0] px-3 py-1 text-xs font-semibold text-[#126b5f]">
                  {company.status}
                </span>
              </div>
            ))
          ) : (
            <div className="px-5 py-8 text-sm text-gray-500">
              No companies available yet.
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
