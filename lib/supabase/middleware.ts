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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtectedRoute = protectedRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route),
  );

  if (isProtectedRoute && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.searchParams.set("redirectedFrom", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (isProtectedRoute && user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("registration_status, role")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.registration_status !== "approved") {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/registration-status";
      redirectUrl.search = "";
      return NextResponse.redirect(redirectUrl);
    }

    const role =
      normalizeRole(user.app_metadata?.role) ??
      normalizeRole(profile.role) ??
      "tenant";
    const module = moduleForPath(request.nextUrl.pathname);

    if (module && role !== "super_admin") {
      const { data: permissionRows } = await supabase
        .from("user_module_permissions")
        .select("module_key, access_level")
        .eq("profile_id", user.id);
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
