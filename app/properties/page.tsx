import { getManageableCompanies } from "@/lib/auth/companies";
import { createClient } from "@/lib/supabase/server";
import { PropertyForm } from "./property-form";

export default async function PropertiesPage() {
  const { companies } = await getManageableCompanies();
  const supabase = await createClient();
  const companyIds = companies.map((company) => company.id);

  const { data: properties, error } =
    companyIds.length > 0
      ? await supabase
          .from("properties")
          .select("id, company_id, name, address, city, state, postcode, property_type, created_at")
          .in("company_id", companyIds)
          .order("created_at", { ascending: false })
      : { data: [], error: null };

  if (error) {
    throw new Error("Unable to load properties.");
  }

  return (
    <section className="w-full space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-normal text-[#126b5f]">
          Rental Core
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal text-gray-950 sm:text-3xl">
          Properties
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          Create and view properties for companies you manage.
        </p>
      </div>

      <PropertyForm companies={companies} />

      <section className="rounded-lg border border-[#d7dde5] bg-white shadow-sm">
        <div className="border-b border-[#d7dde5] px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-950">Property list</h2>
          <p className="mt-1 text-sm text-gray-500">
            These records are stored in Supabase.
          </p>
        </div>
        <div className="divide-y divide-[#d7dde5]">
          {properties && properties.length > 0 ? (
            properties.map((property) => {
              const company = companies.find(
                (item) => item.id === property.company_id,
              );

              return (
                <div
                  className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"
                  key={property.id}
                >
                  <div>
                    <p className="font-medium text-gray-950">{property.name}</p>
                    <p className="mt-1 text-sm text-gray-500">
                      {company?.name ?? "Company"} · {property.property_type ?? "Property"}
                    </p>
                    <p className="mt-1 text-sm text-gray-500">
                      {[property.address, property.city, property.state, property.postcode]
                        .filter(Boolean)
                        .join(", ") || "No address added"}
                    </p>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="px-5 py-8 text-sm text-gray-500">
              No properties yet.
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
