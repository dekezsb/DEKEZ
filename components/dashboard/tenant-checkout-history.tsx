import { Link } from "@/components/app-link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TenantCheckoutHistoryItem } from "@/lib/data/tenant-checkouts";
import { formatMalaysiaDate, formatMalaysiaDateTime } from "@/lib/date-format";

function moveMonth(month: string, amount: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + amount, 1))
    .toISOString()
    .slice(0, 7);
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function sourceLabel(value: string) {
  if (value === "management_portal") return "Management portal";
  if (value === "admin_portal") return "Admin portal";
  return "Older checkout record";
}

export function TenantCheckoutHistory({
  items,
  month,
}: {
  items: TenantCheckoutHistoryItem[];
  month: string;
}) {
  return (
    <Card className="mx-auto max-w-4xl shadow-sm">
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#f7ecd2] text-[#9d7424]">
              <CalendarDays className="h-5 w-5" />
            </span>
            <div>
              <CardTitle>Tenant Checkout History</CardTitle>
              <CardDescription className="mt-1 leading-6">
                Month-by-month proof of former tenants, rooms, checkout dates
                and the staff account that completed each checkout.
              </CardDescription>
            </div>
          </div>
          <span className="rounded-full bg-[#f7ecd2] px-3 py-1 text-sm font-semibold text-[#7e5a16]">
            {items.length} checkout{items.length === 1 ? "" : "s"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 rounded-lg border border-[#d7dde5] bg-[#f7f9fb] p-3 sm:flex-row sm:items-end sm:justify-between">
          <Button asChild size="sm" variant="outline">
            <Link href={`/dashboard?checkoutMonth=${moveMonth(month, -1)}`}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Previous
            </Link>
          </Button>
          <form className="flex items-end gap-2" method="get">
            <div>
              <label className="text-xs font-medium text-gray-600" htmlFor="checkout-month">
                Checkout month
              </label>
              <input
                className="mt-1 min-h-9 rounded-md border border-[#cfd8e3] bg-white px-3 py-1 text-sm"
                defaultValue={month}
                id="checkout-month"
                name="checkoutMonth"
                type="month"
              />
            </div>
            <Button size="sm" type="submit" variant="outline">
              View
            </Button>
          </form>
          <Button asChild size="sm" variant="outline">
            <Link href={`/dashboard?checkoutMonth=${moveMonth(month, 1)}`}>
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div>
          <h3 className="text-base font-semibold text-[#07142f]">
            {monthLabel(month)}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Signed agreements and invoices remain in their permanent archive.
          </p>
        </div>

        {items.length ? (
          <div className="overflow-x-auto rounded-lg border border-[#d7dde5]">
            <table className="min-w-[840px] w-full text-left text-sm">
              <thead className="bg-[#f3f6f9] text-xs uppercase text-[#496386]">
                <tr>
                  <th className="px-4 py-3">Checkout date</th>
                  <th className="px-4 py-3">Former tenant</th>
                  <th className="px-4 py-3">Property / room</th>
                  <th className="px-4 py-3">Checked out by</th>
                  <th className="px-4 py-3">Proof recorded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e3e8ef] bg-white">
                {items.map((item) => (
                  <tr key={item.tenancyId}>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-[#07142f]">
                      {formatMalaysiaDate(item.checkoutDate)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#07142f]">{item.tenantName}</p>
                      {item.tenantPhone ? (
                        <p className="mt-1 text-xs text-gray-500">{item.tenantPhone}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#214066]">{item.propertyName}</p>
                      <p className="mt-1 text-xs text-gray-500">Room {item.roomName}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#07142f]">{item.performedBy}</p>
                      <p className="mt-1 text-xs text-gray-500">{sourceLabel(item.source)}</p>
                      {item.note ? (
                        <p className="mt-1 max-w-56 text-xs text-gray-600">{item.note}</p>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {item.recordedAt
                        ? formatMalaysiaDateTime(item.recordedAt)
                        : "Not available for older record"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg border border-[#d7dde5] bg-[#f7f9fb] px-4 py-5 text-sm text-gray-600">
            No tenant checkout is recorded for {monthLabel(month)}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
