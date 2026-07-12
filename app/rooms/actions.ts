"use server";

import { revalidatePath } from "next/cache";
import { assertCanManageCompany } from "@/lib/auth/companies";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type RoomStatus = Database["public"]["Enums"]["room_status"];

export type RoomActionState = {
  ok: boolean;
  message: string;
};

const roomStatuses: RoomStatus[] = ["vacant", "occupied", "maintenance", "reserved"];

export async function createUnitAction(
  _previousState: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const companyId = String(formData.get("company_id") ?? "").trim();
  const propertyId = String(formData.get("property_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const floor = String(formData.get("floor") ?? "").trim();

  if (!companyId || !propertyId || !name) {
    return {
      ok: false,
      message: "Company, property, and unit name are required.",
    };
  }

  try {
    await assertCanManageCompany(companyId);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Permission denied.",
    };
  }

  const supabase = await createClient();
  const { data: property } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("company_id", companyId)
    .single();

  if (!property) {
    return {
      ok: false,
      message: "Selected property does not belong to this company.",
    };
  }

  const { error } = await supabase.from("units").insert({
    company_id: companyId,
    property_id: propertyId,
    name,
    floor: floor || null,
  });

  if (error) {
    return {
      ok: false,
      message: error.message,
    };
  }

  revalidatePath("/rooms");

  return {
    ok: true,
    message: "Unit created.",
  };
}

export async function createRoomAction(
  _previousState: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const companyId = String(formData.get("company_id") ?? "").trim();
  const unitId = String(formData.get("unit_id") ?? "").trim();
  const roomNumber = String(formData.get("room_number") ?? "").trim();
  const status = String(formData.get("status") ?? "vacant") as RoomStatus;
  const notes = String(formData.get("notes") ?? "").trim();

  if (!companyId || !unitId || !roomNumber || !roomStatuses.includes(status)) {
    return {
      ok: false,
      message: "Company, unit, room number, and valid status are required.",
    };
  }

  try {
    await assertCanManageCompany(companyId);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Permission denied.",
    };
  }

  const supabase = await createClient();
  const { data: unit } = await supabase
    .from("units")
    .select("id")
    .eq("id", unitId)
    .eq("company_id", companyId)
    .single();

  if (!unit) {
    return {
      ok: false,
      message: "Selected unit does not belong to this company.",
    };
  }

  const { error } = await supabase.from("rooms").insert({
    company_id: companyId,
    unit_id: unitId,
    room_number: roomNumber,
    status,
    notes: notes || null,
  });

  if (error) {
    return {
      ok: false,
      message: error.message,
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/rooms");

  return {
    ok: true,
    message: "Room created.",
  };
}
