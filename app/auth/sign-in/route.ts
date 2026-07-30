import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { normalizeInternationalPhone } from "@/lib/auth/phone";
import {
  derivePinPassword,
  phoneRateLimitKey,
} from "@/lib/auth/registration";
import { normalizeRole, roleHome } from "@/lib/auth/roles";
import { activateTenantAccount } from "@/lib/auth/tenant-account";
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
          "Enter a valid phone number and your 4-digit PIN or password.",
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

  let admin: ReturnType<typeof createAdminClient> | null = null;
  try {
    admin = createAdminClient();
  } catch {
    admin = null;
  }

  const rateLimitKey = admin ? phoneRateLimitKey(phone) : null;
  if (admin && rateLimitKey) {
    const { data: rateLimit } = await admin
      .from("auth_login_rate_limits")
      .select("locked_until")
      .eq("phone_hash", rateLimitKey)
      .maybeSingle();
    if (
      rateLimit?.locked_until &&
      new Date(rateLimit.locked_until).getTime() > Date.now()
    ) {
      return NextResponse.json(
        {
          error:
            "Too many unsuccessful attempts. Please wait 15 minutes before trying again.",
        },
        { status: 429 },
      );
    }
  }

  const pinPassword = /^\d{4}$/.test(password)
    ? derivePinPassword(phone, password)
    : null;
  let profileLookup: { id: string } | null = null;
  let signInResult:
    | Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>
    | null = null;

  if (admin) {
    const { data } = await admin
      .from("profiles")
      .select("id")
      .in("normalized_phone", phone.lookupDigits)
      .maybeSingle();
    profileLookup = data;

    if (!profileLookup && pinPassword) {
      const { data: activeTenants, error: tenantLookupError } = await admin
        .from("tenants")
        .select("id, company_id, phone")
        .eq("status", "active");
      const matchingTenants = (activeTenants ?? []).filter((tenant) => {
        const candidatePhone = normalizeInternationalPhone(tenant.phone ?? "");
        return candidatePhone?.digits === phone.digits;
      });
      const matchingCompanies = new Set(
        matchingTenants.map((tenant) => tenant.company_id),
      );

      if (
        !tenantLookupError &&
        matchingTenants.length > 0 &&
        matchingCompanies.size === 1
      ) {
        const activation = await activateTenantAccount(
          matchingTenants[0].id,
          null,
        );
        if (activation.ok) {
          profileLookup = { id: activation.profileId };
        }
      }
    }

    if (profileLookup?.id) {
      const { data: authUser } = await admin.auth.admin.getUserById(
        profileLookup.id,
      );
      const email = authUser.user?.email;

      if (email && (!/^\d{4}$/.test(password) || pinPassword)) {
        signInResult = await supabase.auth.signInWithPassword({
          email,
          password: pinPassword ?? password,
        });
      }
    }
  }

  if (!signInResult) {
    signInResult = await supabase.auth.signInWithPassword({
      phone: phone.e164,
      password: pinPassword ?? password,
    });
  }

  const signedInUser = signInResult.data.user;
  if (signInResult.error || !signedInUser) {
    if (admin && rateLimitKey) {
      const { data: existing } = await admin
        .from("auth_login_rate_limits")
        .select("failed_attempts, window_started_at")
        .eq("phone_hash", rateLimitKey)
        .maybeSingle();
      const now = new Date();
      const windowStarted = existing?.window_started_at
        ? new Date(existing.window_started_at)
        : now;
      const inWindow =
        now.getTime() - windowStarted.getTime() < 15 * 60 * 1000;
      const failedAttempts = inWindow
        ? Number(existing?.failed_attempts ?? 0) + 1
        : 1;
      await admin.from("auth_login_rate_limits").upsert({
        phone_hash: rateLimitKey,
        failed_attempts: failedAttempts,
        window_started_at: inWindow
          ? windowStarted.toISOString()
          : now.toISOString(),
        locked_until:
          failedAttempts >= 5
            ? new Date(now.getTime() + 15 * 60 * 1000).toISOString()
            : null,
        updated_at: now.toISOString(),
      });
    }
    return responseWithCookies(
      { error: "Invalid phone number or PIN/password." },
      cookiesToSet,
      401,
    );
  }

  if (admin && rateLimitKey) {
    await admin
      .from("auth_login_rate_limits")
      .delete()
      .eq("phone_hash", rateLimitKey);
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
    normalizeRole(profile.role) ??
    normalizeRole(signedInUser.app_metadata?.role) ??
    "tenant";

  return responseWithCookies(
    {
      redirectTo: roleHome[role],
      role,
    },
    cookiesToSet,
  );
}
