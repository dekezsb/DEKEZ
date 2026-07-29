import { CheckCircle2, KeyRound } from "lucide-react";
import { Link } from "@/components/app-link";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { updateRecoveredPassword } from "./actions";

type ResetPasswordPageProps = {
  searchParams: Promise<{
    error?: string;
    updated?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  link_invalid:
    "This reset link is invalid or has expired. Ask an Admin to send a new WhatsApp reset link.",
  password_mismatch: "The two passwords do not match.",
  password_short: "Use a password with at least 8 characters.",
  update_failed: "The password could not be changed. Request a new reset link.",
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const query = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="min-h-screen border-t-4 border-[#b8892c] bg-[#080706] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-md">
        <div className="flex items-center justify-center gap-3">
          <BrandLogo className="rounded-md" priority size={54} />
          <div>
            <p className="text-lg font-bold text-[#c99a3e]">DEKEZ</p>
            <p className="text-sm text-[#d7c6a8]">Secure password reset</p>
          </div>
        </div>

        <section className="mt-6 rounded-md bg-white p-5 shadow-xl sm:p-8">
          {query.updated ? (
            <div className="text-center">
              <CheckCircle2
                aria-hidden="true"
                className="mx-auto h-10 w-10 text-emerald-600"
              />
              <h1 className="mt-4 text-2xl font-semibold text-gray-950">
                Password updated
              </h1>
              <p className="mt-2 text-sm leading-6 text-gray-600">
                Your new password is ready. You can continue to your DEKEZ
                dashboard.
              </p>
              <Button asChild className="mt-6 w-full">
                <Link href="/dashboard">Continue</Link>
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <KeyRound
                  aria-hidden="true"
                  className="h-5 w-5 text-[#b8892c]"
                />
                <h1 className="text-2xl font-semibold text-gray-950">
                  Set a new password
                </h1>
              </div>
              <p className="mt-2 text-sm leading-6 text-gray-600">
                Enter a new password for your DEKEZ phone-login account.
              </p>

              {query.error ? (
                <div className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
                  {errorMessages[query.error] ??
                    "The password could not be updated."}
                </div>
              ) : null}

              {!user ? (
                <div className="mt-5 space-y-4">
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                    This link is invalid or has expired. Ask an Admin to send a
                    new WhatsApp reset link.
                  </div>
                  <Button asChild className="w-full" variant="outline">
                    <Link href="/">Return to sign in</Link>
                  </Button>
                </div>
              ) : (
                <form action={updateRecoveredPassword} className="mt-6 space-y-4">
                  <label className="block">
                    <span className="text-sm font-medium text-gray-800">
                      New password
                    </span>
                    <input
                      autoComplete="new-password"
                      className="mt-2 h-11 w-full rounded-md border border-[#d7dde5] px-3 outline-none focus:border-[#b8892c] focus:ring-2 focus:ring-[#b8892c]/20"
                      minLength={8}
                      name="password"
                      required
                      type="password"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-gray-800">
                      Confirm new password
                    </span>
                    <input
                      autoComplete="new-password"
                      className="mt-2 h-11 w-full rounded-md border border-[#d7dde5] px-3 outline-none focus:border-[#b8892c] focus:ring-2 focus:ring-[#b8892c]/20"
                      minLength={8}
                      name="confirmPassword"
                      required
                      type="password"
                    />
                  </label>
                  <Button className="w-full" type="submit">
                    Save new password
                  </Button>
                </form>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
