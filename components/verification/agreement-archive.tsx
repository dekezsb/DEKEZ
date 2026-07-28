import Link from "next/link";
import { Archive, FileText } from "lucide-react";
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

export type AgreementArchiveItem = {
  id: string;
  agreement_type: "original" | "renewal";
  version_number: number;
  status: string;
  term_start_date: string | null;
  term_end_date: string | null;
  generated_at: string;
  signed_at: string | null;
  retention_until: string | null;
  pdf_url: string | null;
  tenant_name_snapshot: string | null;
  property_name_snapshot: string | null;
  room_name_snapshot: string | null;
  tenancies:
    | {
        status: string;
        checkout_date: string | null;
        tenants: { full_name: string } | { full_name: string }[] | null;
        properties:
          | { name: string; property_code: string | null }
          | { name: string; property_code: string | null }[]
          | null;
        rooms:
          | { name: string | null; room_number: string }
          | { name: string | null; room_number: string }[]
          | null;
      }
    | {
        status: string;
        checkout_date: string | null;
        tenants: { full_name: string } | { full_name: string }[] | null;
        properties:
          | { name: string; property_code: string | null }
          | { name: string; property_code: string | null }[]
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
    property:
      agreement.property_name_snapshot ??
      property?.name ??
      property?.property_code ??
      "Property",
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
}: {
  agreements: AgreementArchiveItem[];
  occupancy: string;
}) {
  const selected =
    occupancy === "current" || occupancy === "checked_out" ? occupancy : "all";
  const filtered = agreements.filter((agreement) => {
    const checkedOut = isCheckedOut(agreement);
    if (selected === "current") {
      return !checkedOut;
    }
    if (selected === "checked_out") {
      return checkedOut;
    }
    return true;
  });

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
          <Button type="submit" variant="outline">
            Apply filter
          </Button>
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
                      <Badge className={statusBadgeClass(agreement.status)}>
                        {agreement.status.replaceAll("_", " ")}
                      </Badge>
                      <p className="mt-1 text-xs text-gray-500">
                        {agreement.agreement_type} v{agreement.version_number}
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
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/e-tenancy/${agreement.id}`}>
                          <FileText className="h-4 w-4" />
                          View
                        </Link>
                      </Button>
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
                <Button asChild className="mt-4 w-full" variant="outline">
                  <Link href={`/e-tenancy/${agreement.id}`}>View agreement</Link>
                </Button>
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
