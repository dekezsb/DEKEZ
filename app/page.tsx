import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Building2,
  House,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { normalizeRole, roleHome, roleLabels, type AppRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

const loginCards: Array<{
  role: AppRole;
  description: string;
  action: string;
  icon: LucideIcon;
}> = [
  {
    role: "owner",
    description: "Create or access your owner account for portfolio operations.",
    action: "Login or sign up",
    icon: Building2,
  },
  {
    role: "admin",
    description: "Manage daily room-rental operations and tenant activity.",
    action: "Continue to login",
    icon: ShieldCheck,
  },
  {
    role: "technician",
    description: "View assigned repair work and update maintenance status.",
    action: "Continue to login",
    icon: Wrench,
  },
  {
    role: "tenant",
    description: "Create or access your tenant account for rental information.",
    action: "Login or sign up",
    icon: House,
  },
];

type HomeProps = {
  searchParams: Promise<{
    verified?: string;
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const { verified } = await searchParams;
  let signedInHome: string | null = null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user && verified !== "1" && verified !== "0") {
      let role = normalizeRole(user.user_metadata?.role);

      if (!role) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();
        role = normalizeRole(profile?.role);
      }

      signedInHome = roleHome[role ?? "tenant"];
    }
  } catch {
    // Public home should still render if Supabase is not configured yet.
  }

  if (signedInHome) {
    redirect(signedInHome);
  }

  return (
    <section className="min-h-screen bg-[#f2f4f7]">
      <header className="border-b border-[#2b2316] bg-[#080706] text-white">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-5 px-4 py-7 sm:gap-7 sm:px-6">
          <BrandLogo className="rounded-md" priority size={118} />
          <div>
            <p className="text-xs font-semibold uppercase text-[#c99a3e]">
              Rental Management System
            </p>
            <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
              DEKEZ
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#cfc6b7]">
              Property operations, tenancy records and rent management in one secure workspace.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        {verified === "1" ? (
          <div className="mb-6 rounded-md border border-emerald-200 bg-white px-4 py-3 text-sm font-medium text-emerald-700 shadow-sm">
            Email verified successfully. Please choose your category and login.
          </div>
        ) : null}
        {verified === "0" ? (
          <div className="mb-6 rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
            Email verification failed or expired. Please try signing up again.
          </div>
        ) : null}
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase text-[#8a641d]">
            Secure access
          </p>
          <h2 className="mt-3 text-3xl font-bold text-gray-950 sm:text-4xl">
            Choose your login category
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-7 text-gray-600">
            This only opens the correct login screen. Your real permissions are
            verified from your Supabase account role after login.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {loginCards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                className="group rounded-md border border-[#d7dde5] bg-white p-5 shadow-sm transition hover:border-[#b8892c] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#b8892c] focus:ring-offset-2"
                href={`/login/${card.role}`}
                key={card.role}
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[#f6edd9] text-[#8a641d]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <ArrowRight className="h-5 w-5 text-gray-400 transition group-hover:text-[#8a641d]" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-gray-950">
                  {roleLabels[card.role]}
                </h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  {card.description}
                </p>
                <p className="mt-4 text-sm font-semibold text-[#8a641d]">
                  {card.action}
                </p>
              </Link>
            );
          })}
        </div>
        <div className="mt-6 text-center">
          <Link
            className="text-sm font-semibold text-[#8a641d] underline-offset-4 hover:underline"
            href="/login/super_admin"
          >
            Backend access
          </Link>
        </div>
      </main>
    </section>
  );
}
