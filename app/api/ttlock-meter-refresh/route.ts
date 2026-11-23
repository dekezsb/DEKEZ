import { NextResponse } from "next/server";

import { refreshAllTTLockMeters } from "@/lib/ttlock/meter-refresh-all";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const result = await refreshAllTTLockMeters();
    // Individual meter failures are stored on the meter and shown to staff;
    // the run itself still succeeded, so it returns 200.
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Meter refresh run failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
