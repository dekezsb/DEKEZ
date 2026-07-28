import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const origin = requestUrl.origin;
  const requestedNext = requestUrl.searchParams.get("next");
  const safeNext = requestedNext === "/reset-password" ? requestedNext : null;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(
        safeNext ? `${origin}${safeNext}` : `${origin}/?verified=1`,
      );
    }
  }

  return NextResponse.redirect(`${origin}/?verified=0`);
}
