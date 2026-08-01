import { FileSignature } from "lucide-react";
import { AgreementArchive } from "@/components/verification/agreement-archive";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/lib/auth/session";
import { loadTenancyAgreementArchive } from "@/lib/data/tenancy-agreements";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { RegenerateMasterButton } from "./regenerate-master-button";

type PageProps = {
  searchParams: Promise<{
    occupancy?: string;
    q?: string;
    regenerated?: string;
    skipped?: string;
    errors?: string;
    detail?: string;
    deleted?: string;
    deleteError?: string;
    reminder?: string;
  }>;
};

export default async function TenancyAgreementsPage({
  searchParams,
}: PageProps) {
  const role = await requireRole(["super_admin", "admin", "owner"], {
    module: "tenancy_agreements",
  });
  const params = await searchParams;
  const supabase =
    role === "owner" ? await createClient() : createAdminClient();
  const archive = await loadTenancyAgreementArchive(supabase);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase text-[#b98a2c]">
            <FileSignature className="h-4 w-4" />
            Tenancy Records
          </p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
            Tenancy Agreements
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
            View every original and renewal term, including agreements retained
            after a tenant checks out.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge className="w-fit bg-[#f6edd9] text-[#7a5618]">
            {archive.agreements.length} agreement terms
          </Badge>
          {role !== "owner" ? <RegenerateMasterButton /> : null}
        </div>
      </div>

      {params.regenerated ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 shadow-sm">
          {params.regenerated} agreement
          {params.regenerated === "1" ? "" : "s"} regenerated with the latest
          DEKEZ master wording.
          {params.skipped && params.skipped !== "0"
            ? ` ${params.skipped} agreement(s) were skipped.`
            : ""}
          {params.errors && params.errors !== "0"
            ? ` ${params.errors} agreement(s) need review.`
            : ""}
          {params.detail ? ` ${params.detail}` : ""}
        </div>
      ) : null}

      {params.deleted === "1" ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 shadow-sm">
          The wrong unsigned agreement was deleted and is no longer visible to
          the tenant.
        </div>
      ) : null}

      {params.deleteError ? (
        <div className="rounded-md border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {params.deleteError === "signed"
            ? "This agreement has a tenant signature and cannot be deleted."
            : params.deleteError === "audit"
              ? "The deletion audit record could not be saved, so the agreement was not deleted."
              : "The agreement could not be deleted. Please refresh and try again."}
        </div>
      ) : null}

      {params.reminder ? (
        <div
          className={`rounded-md border px-4 py-3 text-sm font-medium shadow-sm ${
            params.reminder === "sent"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-white text-red-600"
          }`}
        >
          {params.reminder === "sent"
            ? "The WhatsApp renewal signing reminder was sent and recorded."
            : params.reminder === "missing"
              ? "This tenant does not have a valid WhatsApp number. Update the tenant phone number, then send again."
              : params.reminder === "invalid"
                ? "This renewal is no longer waiting for a signature. Refresh the list and check its latest status."
                : "WhatsApp could not deliver this reminder. The failed attempt was recorded so it can be checked and sent again."}
        </div>
      ) : null}

      {archive.error ? (
        <div className="rounded-md border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {archive.error}
        </div>
      ) : null}

      <AgreementArchive
        agreements={archive.agreements}
        occupancy={params.occupancy ?? "all"}
        searchQuery={params.q ?? ""}
        canManage={role !== "owner"}
      />
    </section>
  );
}
