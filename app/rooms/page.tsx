import { getManageableCompanies } from "@/lib/auth/companies";
import { createClient } from "@/lib/supabase/server";
import { RoomForms } from "./room-forms";

export default async function RoomsPage() {
  const { companies } = await getManageableCompanies();
  const supabase = await createClient();
  const companyIds = companies.map((company) => company.id);

  const [{ data: properties, error: propertiesError }, { data: units, error: unitsError }, { data: rooms, error: roomsError }] =
    companyIds.length > 0
      ? await Promise.all([
          supabase
            .from("properties")
            .select("id, company_id, name")
            .in("company_id", companyIds)
            .order("created_at", { ascending: false }),
          supabase
            .from("units")
            .select("id, company_id, property_id, name, floor")
            .in("company_id", companyIds)
            .order("created_at", { ascending: false }),
          supabase
            .from("rooms")
            .select("id, company_id, unit_id, room_number, status, notes, created_at")
            .in("company_id", companyIds)
            .order("created_at", { ascending: false }),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ];

  if (propertiesError || unitsError || roomsError) {
    throw new Error("Unable to load room records.");
  }

  const propertyOptions = properties ?? [];
  const unitOptions = units ?? [];
  const roomRecords = rooms ?? [];

  return (
    <section className="w-full space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-normal text-[#126b5f]">
          Rental Core
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal text-gray-950 sm:text-3xl">
          Rooms
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          Create units and rooms. Tenancy assignment will be added in a later phase.
        </p>
      </div>

      <RoomForms
        companies={companies}
        properties={propertyOptions}
        units={unitOptions}
      />

      <section className="rounded-lg border border-[#d7dde5] bg-white shadow-sm">
        <div className="border-b border-[#d7dde5] px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-950">Room list</h2>
          <p className="mt-1 text-sm text-gray-500">
            Room status records stored in Supabase.
          </p>
        </div>
        <div className="divide-y divide-[#d7dde5]">
          {roomRecords.length > 0 ? (
            roomRecords.map((room) => {
              const unit = unitOptions.find((item) => item.id === room.unit_id);
              const property = propertyOptions.find(
                (item) => item.id === unit?.property_id,
              );
              const company = companies.find((item) => item.id === room.company_id);

              return (
                <div
                  className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"
                  key={room.id}
                >
                  <div>
                    <p className="font-medium text-gray-950">
                      Room {room.room_number}
                    </p>
                    <p className="mt-1 text-sm text-gray-500">
                      {company?.name ?? "Company"} · {property?.name ?? "Property"} ·{" "}
                      {unit?.name ?? "Unit"}
                    </p>
                    {room.notes ? (
                      <p className="mt-1 text-sm text-gray-500">{room.notes}</p>
                    ) : null}
                  </div>
                  <span className="w-fit rounded-full bg-[#e7f2f0] px-3 py-1 text-xs font-semibold capitalize text-[#126b5f]">
                    {room.status}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="px-5 py-8 text-sm text-gray-500">No rooms yet.</div>
          )}
        </div>
      </section>
    </section>
  );
}
