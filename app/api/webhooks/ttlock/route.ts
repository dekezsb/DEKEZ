import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type EventRecord = Record<string, unknown>;

const sensitiveFieldPattern =
  /password|passwd|pwd|secret|token|lockdata|lockkey|aeskey|adminkey/i;

function isRecord(value: unknown): value is EventRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function authorized(request: Request) {
  const expected = process.env.TTLOCK_CALLBACK_TOKEN ?? "";
  const received = new URL(request.url).searchParams.get("token") ?? "";
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveFieldPattern.test(key))
      .map(([key, nestedValue]) => [key, sanitize(nestedValue)]),
  );
}

function scalar(record: EventRecord, names: string[]) {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" || typeof value === "number") return value;
  }
  return null;
}

function eventTime(record: EventRecord) {
  const value = scalar(record, [
    "lockDate",
    "recordTime",
    "unlockDate",
    "eventTime",
    "date",
  ]);
  if (value === null) return null;
  if (typeof value === "string" && !/^\d+$/.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = new Date(milliseconds);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function payload(request: Request) {
  const raw = await request.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

function records(value: unknown) {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["list", "records", "events", "data"]) {
    if (Array.isArray(value[key])) return value[key].filter(isRecord);
  }
  return [value];
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const incoming = records(await payload(request));
  const admin = createAdminClient();
  let accepted = 0;

  for (const record of incoming) {
    const lockId = Number(scalar(record, ["lockId", "lock_id"]));
    if (!Number.isSafeInteger(lockId) || lockId <= 0) continue;
    const { data: device } = await admin
      .from("smart_lock_devices")
      .select("id,company_id,property_id,room_id")
      .eq("provider", "ttlock")
      .eq("provider_lock_id", lockId)
      .maybeSingle();
    if (!device) continue;

    const safePayload = sanitize(record) as EventRecord;
    const explicitRecordId = scalar(record, [
      "recordId",
      "unlockRecordId",
      "record_id",
      "id",
    ]);
    const providerRecordId =
      explicitRecordId === null
        ? createHash("sha256")
            .update(JSON.stringify(safePayload))
            .digest("hex")
        : String(explicitRecordId);
    const eventType = scalar(record, [
      "recordType",
      "recordTypeFromLock",
      "eventType",
      "type",
    ]);

    const { error } = await admin.from("smart_lock_unlock_events").upsert(
      {
        device_id: device.id,
        company_id: device.company_id,
        property_id: device.property_id,
        room_id: device.room_id,
        provider_record_id: providerRecordId,
        provider_lock_id: lockId,
        event_type: eventType === null ? null : String(eventType),
        occurred_at: eventTime(record),
        event_payload: safePayload,
      },
      { onConflict: "device_id,provider_record_id", ignoreDuplicates: true },
    );
    if (!error) accepted += 1;
  }

  return NextResponse.json({ ok: true, accepted });
}
