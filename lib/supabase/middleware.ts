import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  hasModuleAccess,
  moduleForPath,
  resolveUserAccess,
} from "@/lib/auth/access";
import { protectedRoutes } from "@/lib/auth/roles";
import { normalizeRole } from "@/lib/auth/roles";
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
      const allowed = path === "/logout" || path === "/auth/sign-in"
        || path === "/login/contractor"
        || path === "/admin/marketplace/contractor-preview"
        || path.startsWith("/admin/marketplace/contractor-preview/");
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
      if (request.method !== "GET" && request.method !== "HEAD" && path !== "/auth/sign-in" && path !== "/logout")
        return NextResponse.json({ error: "Read-only preview." }, { status: 403 });
      return response;
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
