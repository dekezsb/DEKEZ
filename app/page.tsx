import { Link } from "@/components/app-link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { normalizeRole, roleHome } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { PhoneSignInForm } from "./phone-sign-in-form";

export default async function Home() {
  let destination: string | null = null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, registration_status")
        .eq("id", user.id)
        .maybeSingle();

      if (profile?.registration_status !== "approved") {
        destination = "/registration-status";
      } else {
        const role =
          normalizeRole(user.app_metadata?.role) ??
          normalizeRole(profile.role) ??
          "tenant";
        destination = roleHome[role];
      }
    }
  } catch {
    // Keep the sign-in page available while local Supabase variables are absent.
  }

  if (destination) {
    redirect(destination);
  }

  return (
    <main className="min-h-screen border-t-4 border-[#b8892c] bg-[#080706] px-4 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-sm">
        <div className="flex items-center justify-center gap-3">
          <BrandLogo className="rounded-md" priority size={54} />
          <div>
            <p className="text-lg font-bold text-[#c99a3e]">DEKEZ</p>
            <p className="text-sm text-[#d7c6a8]">Sign in</p>
          </div>
        </div>

        <section className="mt-6 rounded-md bg-white p-6 shadow-xl sm:p-8">
          <h1 className="text-2xl font-semibold text-[#111827]">Sign in</h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            Use Malaysian 01x format or an international number with country
            code.
          </p>
          <PhoneSignInForm />
        </section>

        <p className="mt-5 text-center text-sm">
          <span className="font-medium text-red-500">New user?</span>{" "}
          <Link
            className="font-semibold underline-offset-4 hover:underline"
            href="/register"
            style={{ color: "#c99a3e" }}
          >
            Register here
          </Link>
        </p>
      </div>
    </main>
  );
}
