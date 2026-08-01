import { Link } from "@/components/app-link";
import { Archive, FileText, Search, Send, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatMalaysiaDate,
  formatMalaysiaDateTime,
} from "@/lib/date-format";
import { statusBadgeClass } from "@/lib/status-styles";
import { DeleteAgreementButton } from "@/app/tenancy-agreements/delete-agreement-button";
import { sendRenewalWhatsAppReminder } from "@/app/tenancy-agreements/actions";
import { RenewalWhatsAppSubmit } from "@/components/tenancy/renewal-whatsapp-submit";

export type AgreementArchiveItem = {
  id: string;
  tenancy_id: string;
  term_type: "original" | "renewal";
  agreement_type: "residential_room" | "commercial_office";
  version_number: number;
  status: string;
  term_start_date: string | null;
  term_end_date: string | null;
  generated_at: string;
  signed_at: string | null;
  admin_verified_at: string | null;
  admin_verified_by: string | null;
  admin_rejected_at: string | null;
  admin_rejected_by: string | null;
  admin_rejection_reason: string | null;
  replacement_agreement_id: string | null;
  retention_until: string | null;
  pdf_url: string | null;
  tenant_name_snapshot: string | null;
  property_name_snapshot: string | null;
  room_name_snapshot: string | null;
  monthly_rent_snapshot: number | string | null;
  renewal_reminder_status: string | null;
  renewal_reminder_at: string | null;
  tenancies:
    | {
        status: string;
        checkout_date: string | null;
        tenants:
          | { full_name: string; phone: string | null }
          | { full_name: string; phone: string | null }[]
          | null;
        properties:
          | { name: string; property_code: string | null; area: string | null }
          | { name: string; property_code: string | null; area: string | null }[]
          | null;
        rooms:
          | { name: string | null; room_number: string }
          | { name: string | null; room_number: string }[]
          | null;
      }
    | {
        status: string;
        checkout_date: string | null;
        tenants:
          | { full_name: string; phone: string | null }
          | { full_name: string; phone: string | null }[]
          | null;
        properties:
          | { name: string; property_code: string | null; area: string | null }
          | { name: string; property_code: string | null; area: string | null }[]
          | null;
        rooms:
          | { name: string | null; room_number: string }
          | { name: string | null; room_number: string }[]
          | null;
      }[]
    | null;
};

function single<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function isCheckedOut(agreement: AgreementArchiveItem) {
  const tenancy = single(agreement.tenancies);
  return Boolean(
    tenancy?.checkout_date ||
      ["ended", "terminated", "completed"].includes(tenancy?.status ?? ""),
  );
}

function details(agreement: AgreementArchiveItem) {
  const tenancy = single(agreement.tenancies);
  const tenant = single(tenancy?.tenants);
  const property = single(tenancy?.properties);
  const room = single(tenancy?.rooms);

  return {
    tenant:
      agreement.tenant_name_snapshot ?? tenant?.full_name ?? "Unknown tenant",
    phone: tenant?.phone ?? null,
    property:
      agreement.property_name_snapshot ??
      property?.name ??
      property?.property_code ??
      "Property",
    propertyCode: property?.property_code ?? "",
    area: property?.area ?? "",
    room:
      agreement.room_name_snapshot ??
      room?.room_number ??
      room?.name ??
      "Room",
    checkedOut: isCheckedOut(agreement),
    checkoutDate: tenancy?.checkout_date ?? null,
  };
}

export function AgreementArchive({
  agreements,
  occupancy,
  searchQuery = "",
  canManage = false,
}: {
  agreements: AgreementArchiveItem[];
  occupancy: string;
  searchQuery?: string;
  canManage?: boolean;
}) {
  const selected =
    occupancy === "current" || occupancy === "checked_out" ? occupancy : "all";
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const filtered = agreements.filter((agreement) => {
    const checkedOut = isCheckedOut(agreement);
    if (selected === "current") {
      if (checkedOut) {
        return false;
      }
    }
    if (selected === "checked_out") {
      if (!checkedOut) {
        return false;
      }
    }
    if (!normalizedSearch) {
      return true;
    }
    const item = details(agreement);
    return [
      item.tenant,
      item.property,
      item.propertyCode,
      item.area,
      item.room,
      `room ${item.room}`,
      `r${item.room}`,
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedSearch);
  });
  const latestRenewalByTenancy = new Map<string, AgreementArchiveItem>();
  for (const agreement of agreements) {
    if (
      agreement.term_type !== "renewal" ||
      isCheckedOut(agreement) ||
      latestRenewalByTenancy.has(agreement.tenancy_id)
    ) {
      continue;
    }
    latestRenewalByTenancy.set(agreement.tenancy_id, agreement);
  }
  const unsignedRenewals = [...latestRenewalByTenancy.values()]
    .filter(
      (agreement) =>
        !agreement.signed_at &&
        !["signed", "renewal_signed"].includes(agreement.status) &&
        !agreement.admin_rejected_at,
    )
    .sort((left, right) =>
      String(left.term_start_date ?? "").localeCompare(
        String(right.term_start_date ?? ""),
      ),
    );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5 text-[#b98a2c]" />
              Agreement Archive
            </CardTitle>
            <CardDescription>
              Every original and renewal term is retained for at least seven
              years, including checked-out tenants.
            </CardDescription>
          </div>
          <Badge>{filtered.length} terms</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {canManage ? (
          <section
            className="rounded-lg border border-[#dbc38e] bg-[#fffaf0] p-4"
            id="renewal-signature-reminders"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-gray-950">
                  Renewal TA Waiting for Tenant Signature
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  Send the tenant a WhatsApp reminder with the secure agreement
                  link. Each attempt and send time is recorded.
                </p>
              </div>
              <Badge className="bg-[#f6edd9] text-[#7a5618]">
                {unsignedRenewals.length} waiting
              </Badge>
            </div>

            {unsignedRenewals.length ? (
              <div className="mt-4 divide-y divide-[#e4d7ba]">
                {unsignedRenewals.map((agreement) => {
                  const item = details(agreement);
                  const sent =
                    agreement.renewal_reminder_status === "sent" ||
                    agreement.status === "renewal_sent";
                  const failed =
                    agreement.renewal_reminder_status === "failed";
                  return (
                    <div
                      className="grid gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                      key={agreement.id}
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-gray-950">
                            {item.tenant}
                          </p>
                          <Badge className={statusBadgeClass(agreement.status)}>
                            {agreement.status.replaceAll("_", " ")}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-gray-600">
                          {item.property} - Room {item.room} - Renewal {" "}
                          {formatMalaysiaDate(agreement.term_start_date)} to {" "}
                          {formatMalaysiaDate(agreement.term_end_date)}
                        </p>
                        <p
                          className={`mt-1 text-xs font-medium ${
                            failed
                              ? "text-red-600"
                              : sent
                                ? "text-emerald-700"
                                : "text-amber-700"
                          }`}
                        >
                          {failed
                            ? `Last send failed ${formatMalaysiaDateTime(agreement.renewal_reminder_at)}`
                            : sent
                              ? agreement.renewal_reminder_at
                                ? `Last WhatsApp sent ${formatMalaysiaDateTime(agreement.renewal_reminder_at)}`
                                : "WhatsApp sent previously"
                              : agreement.renewal_reminder_status ===
                                  "missing_phone"
                                ? "Tenant WhatsApp number is missing"
                                : "WhatsApp reminder not sent yet"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/e-tenancy/${agreement.id}`}>
                            <FileText className="h-4 w-4" />
                            View TA
                          </Link>
                        </Button>
                        {item.phone ? (
                          <form action={sendRenewalWhatsAppReminder}>
                            <input
                              name="agreementId"
                              type="hidden"
                              value={agreement.id}
                            />
                            <RenewalWhatsAppSubmit resend={sent || failed} />
                          </form>
                        ) : (
                          <Button disabled size="sm">
                            <Send className="h-4 w-4" />
                            No WhatsApp number
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
                All current renewal agreements have been signed.
              </p>
            )}
          </section>
        ) : null}

        <form
          className="flex flex-wrap items-end gap-3"
          method="get"
        >
          <input name="view" type="hidden" value="agreements" />
          <label className="grid gap-1.5 text-sm font-medium">
            Tenant status
            <select
              className="min-w-48 rounded-md border border-[#d7dde5] bg-white px-3 py-2"
              defaultValue={selected}
              name="occupancy"
            >
              <option value="all">All tenants</option>
              <option value="current">Current tenants</option>
              <option value="checked_out">Checked-out tenants</option>
            </select>
          </label>
          <label className="grid min-w-64 flex-1 gap-1.5 text-sm font-medium">
            Tenant, area or room
            <input
              className="w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2"
              defaultValue={searchQuery}
              name="q"
              placeholder="Search name, area, property or room"
              type="search"
            />
          </label>
          <Button type="submit">
            <Search className="h-4 w-4" />
            Search
          </Button>
          {normalizedSearch || selected !== "all" ? (
            <Button asChild variant="outline">
              <Link href="/tenancy-agreements">
                <X className="h-4 w-4" />
                Clear
              </Link>
            </Button>
          ) : null}
        </form>

        <div className="hidden overflow-x-auto md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Property / Room</TableHead>
                <TableHead>Term</TableHead>
                <TableHead>Agreement</TableHead>
                <TableHead>Tenant status</TableHead>
                <TableHead>Signed</TableHead>
                <TableHead>Keep until</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((agreement) => {
                const item = details(agreement);
                return (
                  <TableRow key={agreement.id}>
                    <TableCell className="font-medium">{item.tenant}</TableCell>
                    <TableCell>
                      {item.property}
                      <br />
                      <span className="text-xs text-gray-500">
                        Room {item.room}
                      </span>
                    </TableCell>
                    <TableCell>
                      {formatMalaysiaDate(agreement.term_start_date)}
                      <br />
                      <span className="text-xs text-gray-500">
                        to {formatMalaysiaDate(agreement.term_end_date)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          agreement.admin_rejected_at
                            ? "bg-red-100 text-red-700"
                            : statusBadgeClass(agreement.status)
                        }
                      >
                        {agreement.admin_rejected_at
                          ? "signature rejected"
                          : agreement.status.replaceAll("_", " ")}
                      </Badge>
                      {agreement.admin_rejection_reason ? (
                        <p className="mt-1 max-w-56 text-xs text-red-600">
                          {agreement.admin_rejection_reason}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-gray-500">
                        {agreement.term_type} ·{" "}
                        {agreement.agreement_type === "commercial_office"
                          ? "Commercial Office"
                          : "Residential Room"}{" "}
                        · v{agreement.version_number}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          item.checkedOut
                            ? "bg-gray-100 text-gray-600"
                            : "bg-emerald-100 text-emerald-700"
                        }
                      >
                        {item.checkedOut ? "Checked out" : "Current"}
                      </Badge>
                      {item.checkoutDate ? (
                        <p className="mt-1 text-xs text-gray-500">
                          {formatMalaysiaDate(item.checkoutDate)}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {formatMalaysiaDateTime(agreement.signed_at)}
                    </TableCell>
                    <TableCell>
                      {formatMalaysiaDate(agreement.retention_until)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/e-tenancy/${agreement.id}`}>
                            <FileText className="h-4 w-4" />
                            View
                          </Link>
                        </Button>
                        {agreement.admin_rejected_at &&
                        agreement.replacement_agreement_id ? (
                          <Button asChild size="sm">
                            <Link
                              href={`/e-tenancy/${agreement.replacement_agreement_id}`}
                            >
                              Replacement
                            </Link>
                          </Button>
                        ) : null}
                        {canManage &&
                        !agreement.signed_at &&
                        !["signed", "renewal_signed"].includes(
                          agreement.status,
                        ) ? (
                          <DeleteAgreementButton
                            agreementId={agreement.id}
                            agreementLabel={`${item.tenant} - ${item.property}, Room ${item.room}`}
                          />
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="grid gap-3 md:hidden">
          {filtered.map((agreement) => {
            const item = details(agreement);
            return (
              <div
                className="rounded-md border border-[#d7dde5] p-4"
                key={agreement.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{item.tenant}</p>
                    <p className="mt-1 text-sm text-gray-600">
                      {item.property} - Room {item.room}
                    </p>
                  </div>
                  <Badge
                    className={
                      item.checkedOut
                        ? "bg-gray-100 text-gray-600"
                        : "bg-emerald-100 text-emerald-700"
                    }
                  >
                    {item.checkedOut ? "Checked out" : "Current"}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <p>
                    <span className="text-gray-500">Term</span>
                    <br />
                    {formatMalaysiaDate(agreement.term_start_date)} to{" "}
                    {formatMalaysiaDate(agreement.term_end_date)}
                  </p>
                  <p>
                    <span className="text-gray-500">Keep until</span>
                    <br />
                    {formatMalaysiaDate(agreement.retention_until)}
                  </p>
                </div>
                {agreement.admin_rejection_reason ? (
                  <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <p className="font-semibold">Signature rejected</p>
                    <p className="mt-1">
                      {agreement.admin_rejection_reason}
                    </p>
                  </div>
                ) : null}
                <Button asChild className="mt-4 w-full" variant="outline">
                  <Link href={`/e-tenancy/${agreement.id}`}>View agreement</Link>
                </Button>
                {agreement.admin_rejected_at &&
                agreement.replacement_agreement_id ? (
                  <Button asChild className="mt-2 w-full">
                    <Link
                      href={`/e-tenancy/${agreement.replacement_agreement_id}`}
                    >
                      View replacement
                    </Link>
                  </Button>
                ) : null}
                {canManage &&
                !agreement.signed_at &&
                !["signed", "renewal_signed"].includes(agreement.status) ? (
                  <div className="mt-2">
                    <DeleteAgreementButton
                      agreementId={agreement.id}
                      agreementLabel={`${item.tenant} - ${item.property}, Room ${item.room}`}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {!filtered.length ? (
          <p className="py-6 text-center text-sm text-gray-500">
            No agreements match this filter.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
