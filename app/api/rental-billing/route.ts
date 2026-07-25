import { NextResponse } from "next/server";
import { generateRecurringRentBills } from "@/lib/billing/rent-billing";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createAdminClient();
  const result = await generateRecurringRentBills(supabase);

  return NextResponse.json({
    ok: result.errors.length === 0,
    ...result,
  }, {
    status: result.errors.length ? 500 : 200,
  });
}
