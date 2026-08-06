import { BrandLogo } from "@/components/brand-logo";
import { createAdminClient } from "@/lib/supabase/admin";
import { RegistrationForm } from "./registration-form";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  let properties: {
    contractDurations: number[];
    id: string;
    isCommercial: boolean;
    label: string;
    rentalModel: "tenancy" | "monthly_stay";
  }[] = [];
  let rooms: { id: string; propertyId: string; roomNumber: string }[] = [];

  try {
    const admin = createAdminClient();
    const [propertiesResult, roomsResult] = await Promise.all([
      admin
        .from("properties")
        .select(
          "id, name, property_code, is_commercial, rental_model, contract_duration_options",
        )
        .eq("status", "active")
        .order("name"),
      admin
        .from("rooms")
        .select("id, property_id, room_number, name")
        .eq("status", "vacant")
        .order("room_number"),
    ]);

    properties = (propertiesResult.data ?? []).map((property) => ({
      contractDurations:
        property.contract_duration_options?.length
          ? property.contract_duration_options
          : [6, 12],
      id: property.id,
      isCommercial: Boolean(property.is_commercial),
      rentalModel:
        property.rental_model === "monthly_stay" ? "monthly_stay" : "tenancy",
      label:
        property.property_code &&
        !property.name.toUpperCase().startsWith(property.property_code.toUpperCase())
          ? `${property.property_code} - ${property.name}`
          : property.name,
    }));
    rooms = (roomsResult.data ?? []).map((room) => ({
      id: room.id,
      propertyId: room.property_id,
      roomNumber: room.room_number ?? room.name ?? "Room",
    }));
  } catch {
    // The form remains visible with a clear no-room state if Supabase is unavailable.
  }

  return (
    <main className="min-h-screen border-t-4 border-[#b8892c] bg-[#080706] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-center gap-3">
          <BrandLogo className="rounded-md" priority size={54} />
          <div>
            <p className="text-lg font-bold text-[#c99a3e]">DEKEZ</p>
            <p className="text-sm text-[#d7c6a8]">New user</p>
          </div>
        </div>

        <section className="mt-6 rounded-md bg-white p-5 shadow-xl sm:p-8">
          <h1 className="text-2xl font-semibold text-[#111827]">Register</h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            No password setup is needed. Use a Malaysian 01x number or an
            international number with country code; your initial PIN is the
            last 4 digits of that number.
          </p>
          <RegistrationForm properties={properties} rooms={rooms} />
        </section>
      </div>
    </main>
  );
}
