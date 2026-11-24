import { DoorClosed, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { TENANCY_ENDED_MESSAGE } from "@/lib/auth/tenant-login-rules";

export const dynamic = "force-dynamic";

// Shown to a tenant whose tenancy was checked out. Deliberately reads no
// session data so it can never redirect back into the portal.
export default function TenancyEndedPage() {
  return (
    <main className="min-h-screen border-t-4 border-[#b8892c] bg-[#080706] px-4 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-sm">
        <BrandLogo className="mx-auto rounded-md" priority size={72} />
        <section className="mt-6 rounded-md bg-white p-6 text-center shadow-xl sm:p-8">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#f6edd9] text-[#8a641d]">
            <DoorClosed className="h-6 w-6" />
          </span>
          <h1 className="mt-5 text-2xl font-semibold text-gray-950">
            Tenancy ended
          </h1>
          <p className="mt-3 text-sm leading-6 text-gray-600">
            {TENANCY_ENDED_MESSAGE}
          </p>
          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-gray-500">
            <ShieldCheck className="h-4 w-4 text-[#8a641d]" />
            Tenant access closes automatically at checkout.
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
