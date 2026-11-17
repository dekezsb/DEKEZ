import { NextResponse } from "next/server";

import { revokeAccessAfterContractEnd } from "@/lib/ttlock/contract-end-cleanup";

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
    const result = await revokeAccessAfterContractEnd();
    return NextResponse.json(
      { ok: result.errors.length === 0, ...result },
      { status: result.errors.length ? 500 : 200 },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Contract-end access cleanup failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
