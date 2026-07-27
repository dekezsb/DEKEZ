import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { normalizeInternationalPhone } from "@/lib/auth/phone";
import { normalizeRole, roleHome } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeSupabaseUrl } from "@/lib/supabase/config";

type CookieToSet = {
  name: string;
  value: string;
  options: Parameters<NextResponse["cookies"]["set"]>[2];
};

function responseWithCookies(
  body: Record<string, unknown>,
  cookiesToSet: CookieToSet[],
  status = 200,
) {
  const response = NextResponse.json(body, { status });
  cookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });
  return response;
}

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => null);
  const phone = normalizeInternationalPhone(
    typeof body?.phone === "string" ? body.phone : "",
  );
  const password = typeof body?.password === "string" ? body.password : "";

  if (!phone || !password) {
    return NextResponse.json(
      {
        error:
          "Enter a valid phone number with country code and your password.",
      },
      { status: 400 },
    );
  }

  const cookiesToSet: CookieToSet[] = [];
  const supabase = createServerClient(normalizeSupabaseUrl(url), anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(newCookiesToSet) {
        newCookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        cookiesToSet.push(...newCookiesToSet);
      },
    },
  });

  let signInResult = await supabase.auth.signInWithPassword({
    phone: phone.e164,
    password,
  });

  let admin: ReturnType<typeof createAdminClient> | null = null;
  try {
    admin = createAdminClient();
  } catch {
    admin = null;
  }

  if ((signInResult.error || !signInResult.data.user) && admin) {
    const { data: legacyProfile } = await admin
      .from("profiles")
      .select("id")
      .eq("normalized_phone", phone.digits)
      .maybeSingle();

    if (legacyProfile?.id) {
      const { data: legacyAuthUser } =
        await admin.auth.admin.getUserById(legacyProfile.id);
      const legacyEmail = legacyAuthUser.user?.email;

      if (legacyEmail) {
        signInResult = await supabase.auth.signInWithPassword({
          email: legacyEmail,
          password,
        });
      }
    }
  }

  const signedInUser = signInResult.data.user;
  if (signInResult.error || !signedInUser) {
    return responseWithCookies(
      { error: "Invalid phone number or password." },
      cookiesToSet,
      401,
    );
  }

  const profileClient = admin ?? supabase;
  const { data: profile } = await profileClient
    .from("profiles")
    .select("role, registration_status")
    .eq("id", signedInUser.id)
    .maybeSingle();

  if (!profile) {
    await supabase.auth.signOut();
    return responseWithCookies(
      { error: "This user registration is not complete." },
      cookiesToSet,
      403,
    );
  }

  if (profile.registration_status !== "approved") {
    return responseWithCookies(
      { redirectTo: "/registration-status" },
      cookiesToSet,
    );
  }

  const role =
    normalizeRole(signedInUser.app_metadata?.role) ??
    normalizeRole(profile.role) ??
    "tenant";

  return responseWithCookies(
    {
      redirectTo: roleHome[role],
      role,
    },
    cookiesToSet,
  );
}
