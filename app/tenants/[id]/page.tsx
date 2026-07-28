import Link from "next/link";
import { ChevronRight, Home, Phone } from "lucide-react";
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
  TenantAgreementHistory,
  TenantDocuments,
} from "@/components/tenant/tenant-records";
import { requireRole } from "@/lib/auth/session";
import { formatMalaysiaDate } from "@/lib/date-format";
import { getTenantProfile } from "@/lib/data/property-details";
import { statusBadgeClass } from "@/lib/status-styles";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ document?: string }>;
};

const money = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

export default async function TenantProfilePage({
  params,
  searchParams,
}: PageProps) {
  const role = await requireRole(["super_admin", "owner", "admin"]);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const canManage = role === "super_admin" || role === "admin";
  const details = await getTenantProfile(id, {
    includeSensitiveDocuments: canManage,
  });
  const { property, room } = details;

  return (
    <section className="space-y-6">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-gray-500" aria-label="Breadcrumb">
        <Link href="/properties">Properties</Link>
        <ChevronRight className="h-4 w-4" />
        <Link href={`/properties/${property.id}`}>{property.name}</Link>
        <ChevronRight className="h-4 w-4" />
        <Link href={`/properties/${property.id}/rooms/${room.id}`}>{room.roomNumber}</Link>
        <ChevronRight className="h-4 w-4" />
        <span className="font-medium text-gray-950">{room.tenantName}</span>
      </nav>

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase text-[#b17f19]">Tenant Profile</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{room.tenantName}</h1>
          <p className="mt-2 text-sm text-gray-600">{property.name} / {room.roomNumber}</p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/properties/${property.id}/rooms/${room.id}`}>
            <Home className="h-4 w-4" />
            Open Room
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Contact</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="flex items-center gap-2 text-gray-700">
              <Phone className="h-4 w-4 text-[#b17f19]" />
              {room.tenantPhone ?? "-"}
            </p>
            <p className="text-gray-600">IC / Passport: {room.identificationNumber ?? "-"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Rental</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <p><span className="block text-gray-500">Check-in</span>{formatMalaysiaDate(room.contractStart)}</p>
            <p><span className="block text-gray-500">Due day</span>{room.dueDay ?? "-"}</p>
            <p><span className="block text-gray-500">Monthly rent</span>{money.format(room.monthlyRent)}</p>
            <p><span className="block text-gray-500">Contract end</span>{formatMalaysiaDate(room.contractEnd)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Balances</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <p><span className="block text-gray-500">Rent outstanding</span><span className={room.outstanding > 0 ? "font-semibold text-red-600" : "font-semibold text-emerald-700"}>{money.format(room.outstanding)}</span></p>
            <p><span className="block text-gray-500">Deposit outstanding</span><span className={room.depositOutstanding > 0 ? "font-semibold text-red-600" : "font-semibold text-emerald-700"}>{money.format(room.depositOutstanding)}</span></p>
          </CardContent>
        </Card>
      </div>

      <TenantDocuments
        canManageDocuments={canManage}
        documentResult={query.document}
        documents={details.documents}
        propertyId={property.id}
        returnView="tenant"
        roomId={room.id}
        tenantKey={id}
        tenantRecordId={room.tenantRecordId}
      />

      <TenantAgreementHistory agreements={details.agreementHistory} />

      <Card>
        <CardHeader>
          <CardTitle>Monthly Bills</CardTitle>
          <CardDescription>Current and historical rent bills for this room assignment.</CardDescription>
        </CardHeader>
        <CardContent>
          {details.bills.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice No.</TableHead>
                    <TableHead>Bill Month</TableHead>
                    <TableHead>Invoice Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Paid</TableHead>
                    <TableHead>Outstanding</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {details.bills.map((bill) => {
                    const amount = Number(bill.amount ?? 0);
                    const paid = Number(bill.paid_amount ?? 0);
                    const outstanding = ["cancelled", "waived"].includes(
                      bill.status,
                    )
                      ? 0
                      : Math.max(amount - paid, 0);
                    return (
                      <TableRow key={bill.id}>
                        <TableCell className="font-medium">{bill.invoice_number}</TableCell>
                        <TableCell>{bill.bill_month}</TableCell>
                        <TableCell>{formatMalaysiaDate(bill.invoice_date)}</TableCell>
                        <TableCell>{money.format(amount)}</TableCell>
                        <TableCell>{money.format(paid)}</TableCell>
                        <TableCell className={outstanding > 0 ? "font-medium text-red-600" : "font-medium text-emerald-700"}>
                          {money.format(outstanding)}
                        </TableCell>
                        <TableCell><Badge className={statusBadgeClass(bill.status)}>{bill.status}</Badge></TableCell>
                        <TableCell>
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/invoices/${bill.id}`}>View / Print</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : <p className="text-sm text-gray-500">No rent bills found.</p>}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Payment History</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {details.payments.length ? details.payments.map((payment) => (
              <div className="flex items-start justify-between gap-4 border-b border-[#e5e9ef] pb-3 last:border-0" key={payment.id}>
                <div>
                  <p className="font-medium text-gray-950">{money.format(Number(payment.amount ?? 0))}</p>
                  <p className="text-xs text-gray-500">{formatMalaysiaDate(payment.payment_date)} / {payment.payment_method ?? "-"}</p>
                  <p className="text-xs text-gray-500">{payment.reference_number ?? "No reference"}</p>
                </div>
                <Badge className={statusBadgeClass(payment.status)}>{payment.status}</Badge>
              </div>
            )) : <p className="text-sm text-gray-500">No payment records found.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Maintenance Records</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {details.maintenance.length ? details.maintenance.map((ticket) => (
              <div className="flex items-start justify-between gap-3" key={ticket.id}>
                <div>
                  <p className="font-medium text-gray-950">{ticket.ticket_number}</p>
                  <p className="text-sm text-gray-600">{ticket.category}: {ticket.description}</p>
                </div>
                <Badge className={statusBadgeClass(ticket.status)}>{ticket.status}</Badge>
              </div>
            )) : <p className="text-sm text-gray-500">No maintenance records found.</p>}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
