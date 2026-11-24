import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  hasModuleAccess,
  moduleForPath,
  resolveUserAccess,
} from "@/lib/auth/access";
import { protectedRoutes } from "@/lib/auth/roles";
import { normalizeRole } from "@/lib/auth/roles";
import { TENANCY_ENDED_MESSAGE } from "@/lib/auth/tenant-login-rules";
import { normalizeSupabaseUrl } from "./config";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return response;
  }

  const supabase = createServerClient(normalizeSupabaseUrl(url), anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  let claims = null;

  try {
    const { data, error } = await supabase.auth.getClaims();
    claims = error ? null : data?.claims ?? null;
  } catch {
    // Expired or malformed refresh cookies are handled as a signed-out session.
    claims = null;
  }

  const isProtectedRoute = protectedRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route),
  );

  // Preview users have no operational routes, even outside protectedRoutes.
  // Server pages/actions and database policies independently enforce this role.
  let sessionProfile: { role: string; registration_status: string } | null = null;
  if (claims?.sub) {
    const { data: previewProfile } = await supabase.from("profiles")
      .select("role, registration_status").eq("id", claims.sub).maybeSingle();
    sessionProfile = previewProfile;
    const previewRole = previewProfile?.role === "contractor_preview"
      || claims.app_metadata?.role === "contractor_preview";
    if (previewRole) {
      const path = request.nextUrl.pathname;
      const chatApi = process.env.DEKEZ_CHAT_ENABLED === "true" && (path === "/api/dekez-chat" || path === "/api/dekez-chat/files") && ["GET", "POST"].includes(request.method);
      const allowed = path === "/logout" || path === "/auth/sign-in"
        || path === "/login/contractor"
        || path === "/admin/marketplace/contractor-preview"
        || path.startsWith("/admin/marketplace/contractor-preview/") || chatApi;
      if (previewProfile?.role !== "contractor_preview" || previewProfile.registration_status !== "approved") {
        if (path === "/logout" || path === "/login/contractor" || path === "/auth/sign-in") return response;
        return NextResponse.redirect(new URL("/login/contractor", request.url));
      }
      if (!allowed) {
        if (request.method !== "GET" && request.method !== "HEAD")
          return NextResponse.json({ error: "Contractor preview access only." }, { status: 403 });
        return NextResponse.redirect(new URL("/admin/marketplace/contractor-preview/dashboard", request.url));
      }
      // Preview has no server actions, regardless of the route supplied.
      if (request.method !== "GET" && request.method !== "HEAD" && path !== "/auth/sign-in" && path !== "/logout" && !chatApi)
        return NextResponse.json({ error: "Read-only preview." }, { status: 403 });
      return response;
    }
  }

  // JV rule: a checked-out tenant (no active or upcoming tenancy) cannot use
  // the tenant portal or any API, even with a session issued before checkout.
  if (claims?.sub && sessionProfile && normalizeRole(sessionProfile.role) === "tenant") {
    const path = request.nextUrl.pathname;
    if (isProtectedRoute || path.startsWith("/api/")) {
      let decision: "allowed" | "tenancy_ended" = "allowed";
      try {
        // Loaded only for tenant sessions (needs the service-role client).
        const { getTenantLoginDecision } = await import("@/lib/auth/tenant-login-lookup");
        decision = await getTenantLoginDecision({
          profileId: claims.sub,
          role: "tenant",
          revokedMarker: Boolean(claims.user_metadata?.checkout_login_revoked_at),
        });
      } catch {
        decision = "allowed";
      }
      if (decision === "tenancy_ended") {
        if (path.startsWith("/api/") || (request.method !== "GET" && request.method !== "HEAD")) {
          return NextResponse.json({ error: TENANCY_ENDED_MESSAGE }, { status: 403 });
        }
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = "/tenancy-ended";
        redirectUrl.search = "";
        return NextResponse.redirect(redirectUrl);
      }
    }
  }

  if (isProtectedRoute && !claims?.sub) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.searchParams.set("redirectedFrom", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (isProtectedRoute && claims?.sub) {
    const profile = sessionProfile;

    if (profile?.registration_status !== "approved") {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/registration-status";
      redirectUrl.search = "";
      return NextResponse.redirect(redirectUrl);
    }

    const role =
      normalizeRole(profile.role) ??
      normalizeRole(claims.app_metadata?.role) ??
      "tenant";
    const module = moduleForPath(request.nextUrl.pathname);

    const ownerRoute = request.nextUrl.pathname === "/owner" || request.nextUrl.pathname.startsWith("/owner/");
    if ((role === "client_owner" && !ownerRoute) || (role !== "client_owner" && ownerRoute)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = role === "client_owner" ? "/owner/home" : "/dashboard";
      redirectUrl.search = "";
      return NextResponse.redirect(redirectUrl);
    }
    if (role === "client_owner") return response;

    if (module && role !== "super_admin") {
      const { data: permissionRows } = await supabase
        .from("user_module_permissions")
        .select("module_key, access_level")
        .eq("profile_id", claims.sub);
      const access = resolveUserAccess(role, permissionRows ?? []);

      if (!hasModuleAccess(access, module)) {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = "/dashboard";
        redirectUrl.search = "";
        redirectUrl.searchParams.set("error", "access_denied");
        return NextResponse.redirect(redirectUrl);
      }
    }
  }

  return response;
}
