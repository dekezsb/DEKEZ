import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { normalizeRole, roleHome, roleLabels, type AppRole } from "@/lib/auth/roles";
import { normalizeSupabaseUrl } from "@/lib/supabase/config";

const staffRoles: AppRole[] = ["technician", "maintenance_staff", "cleaning_staff"];

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return jsonError("Supabase is not configured.", 500);
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const expectedRole = normalizeRole(body?.expectedRole);

  if (!email || !password || !expectedRole) {
    return jsonError("Email, password and role are required.");
  }

  const cookiesToSet: Array<{
    name: string;
    value: string;
    options: Parameters<NextResponse["cookies"]["set"]>[2];
  }> = [];
  const supabase = createServerClient(normalizeSupabaseUrl(url), anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(newCookiesToSet) {
        newCookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.push(...newCookiesToSet);
      },
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return jsonError(error?.message ?? "Unable to login.", 401);
  }

  let actualRole = normalizeRole(data.user.user_metadata?.role);

  if (!actualRole) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();

    actualRole = normalizeRole(profile?.role);
  }

  actualRole = actualRole ?? "tenant";

  const isExpectedStaffLogin =
    expectedRole === "technician" && staffRoles.includes(actualRole);
  const isAllowedRole =
    actualRole === expectedRole || actualRole === "super_admin" || isExpectedStaffLogin;

  if (!isAllowedRole) {
    await supabase.auth.signOut();
    return jsonError(
      `This account is registered as ${roleLabels[actualRole]}, not ${roleLabels[expectedRole]}.`,
      403,
    );
  }

  const response = NextResponse.json(
    {
      redirectTo: roleHome[actualRole],
      role: actualRole,
    },
  );

  cookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });

  return response;
}
