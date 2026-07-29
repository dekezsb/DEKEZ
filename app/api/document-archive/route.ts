import { NextResponse } from "next/server";
import { getDriveArchiveConfig } from "@/lib/archive/config";
import { processDocumentArchiveJobs } from "@/lib/archive/processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      {
        ok: true,
        configured: false,
        processed: 0,
        reason: "Document archive scheduler is not configured.",
      },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    getDriveArchiveConfig();
    const result = await processDocumentArchiveJobs(4);
    return NextResponse.json({
      ok: result.failed === 0,
      ...result,
    }, {
      status: result.failed ? 207 : 200,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Document archive failed.";
    console.error("[document-archive]", message);
    if (
      message.includes("credentials are not configured") ||
      message.includes("archive root is not configured")
    ) {
      return NextResponse.json({
        ok: true,
        configured: false,
        processed: 0,
        reason: message,
      });
    }
    return NextResponse.json(
      { ok: false, error: message },
      { status: 503 },
    );
  }
}
