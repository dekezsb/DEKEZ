import { Clock3, ShieldCheck, XCircle } from "lucide-react";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { normalizeRole, roleHome } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export default async function RegistrationStatusPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, requested_role, registration_status, registration_rejection_reason")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.registration_status === "approved") {
    const role =
      normalizeRole(profile.role) ??
      normalizeRole(user.app_metadata?.role) ??
      "tenant";
    redirect(roleHome[role]);
  }

  const rejected = profile?.registration_status === "rejected";
  const requestedRole = profile?.requested_role;
  const StatusIcon = rejected ? XCircle : Clock3;

  return (
    <main className="min-h-screen border-t-4 border-[#b8892c] bg-[#080706] px-4 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-sm">
        <BrandLogo className="mx-auto rounded-md" priority size={72} />
        <section className="mt-6 rounded-md bg-white p-6 text-center shadow-xl sm:p-8">
          <span
            className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${
              rejected
                ? "bg-red-100 text-red-700"
                : "bg-[#f6edd9] text-[#8a641d]"
            }`}
          >
            <StatusIcon className="h-6 w-6" />
          </span>
          <h1 className="mt-5 text-2xl font-semibold text-gray-950">
            {rejected ? "Permission not approved" : "Permission pending"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-gray-600">
            {rejected
              ? "An Admin did not approve this registration."
              : requestedRole === "tenant"
                ? "Your tenant details, room choice, identity documents and payment slip are waiting for Admin review. After approval, DEKEZ prepares your tenancy agreement."
                : requestedRole === "owner"
                  ? "Your Owner identity and supporting documents are waiting for Admin review. After approval, an Admin assigns the properties you may view."
                  : "Your phone is registered. An Admin must assign your user permission before you can enter DEKEZ."}
          </p>
          {profile?.registration_rejection_reason ? (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {profile.registration_rejection_reason}
            </p>
          ) : null}
          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-gray-500">
            <ShieldCheck className="h-4 w-4 text-[#8a641d]" />
            User permissions are controlled by DEKEZ Admin.
          </div>
          <form action="/logout" className="mt-6" method="post">
            <Button className="w-full" type="submit" variant="outline">
              Sign out
            </Button>
          </form>
        </section>
      </div>
    </main>
  );
}
