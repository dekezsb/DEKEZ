import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureCurrentAgreementTerms } from "@/lib/tenancy/agreement";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
  }

  const supabase = createAdminClient();
  const [{ data: tenancies }, { data: superAdmin }] = await Promise.all([
    supabase
      .from("tenancies")
      .select("id, created_by")
      .eq("status", "active")
      .is("checkout_date", null)
      .not("billing_status", "in", "(terminated,completed)"),
    supabase
      .from("profiles")
      .select("id")
      .eq("role", "super_admin")
      .limit(1)
      .maybeSingle(),
  ]);

  let processed = 0;
  let prepared = 0;
  const errors: Array<{ tenancyId: string; message: string }> = [];

  for (const tenancy of tenancies ?? []) {
    const actorId = tenancy.created_by ?? superAdmin?.id;
    if (!actorId) {
      errors.push({
        tenancyId: tenancy.id,
        message: "No Admin actor is available for agreement generation.",
      });
      continue;
    }

    try {
      const agreementIds = await ensureCurrentAgreementTerms(
        supabase,
        tenancy.id,
        actorId,
      );
      processed += 1;
      prepared += agreementIds.length;
    } catch (error) {
      errors.push({
        tenancyId: tenancy.id,
        message:
          error instanceof Error
            ? error.message
            : "Agreement generation failed.",
      });
    }
  }

  return NextResponse.json(
    {
      ok: errors.length === 0,
      processed,
      prepared,
      errors,
    },
    { status: errors.length ? 500 : 200 },
  );
}
