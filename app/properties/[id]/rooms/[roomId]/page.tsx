import Link from "next/link";
import { BatteryCharging, ChevronRight, FileText, Gauge, Phone, QrCode, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  TenantAgreementHistory,
  TenantDocuments,
} from "@/components/tenant/tenant-records";
import { requireRole } from "@/lib/auth/session";
import { getRoomDetails } from "@/lib/data/property-details";
import { statusBadgeClass } from "@/lib/status-styles";
import { checkoutRoom } from "../../actions";
import { PaymentQrPreview } from "../../property-controls";
import { CheckoutForm } from "./checkout-form";

type PageProps = {
  params: Promise<{ id: string; roomId: string }>;
  searchParams: Promise<{ document?: string }>;
};

const money = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

function roomStatusClass(status: string) {
  const classes: Record<string, string> = {
    occupied: "bg-emerald-100 text-emerald-800",
    vacant: "bg-gray-100 text-gray-700",
    reserved: "bg-orange-100 text-orange-800",
    maintenance: "bg-red-100 text-red-700",
  };
  return classes[status] ?? "bg-gray-100 text-gray-700";
}

export default async function RoomDetailsPage({
  params,
  searchParams,
}: PageProps) {
  const role = await requireRole(["super_admin", "owner", "admin"]);
  const canManage = role === "super_admin" || role === "admin";
  const [{ id, roomId }, query] = await Promise.all([params, searchParams]);
  const details = await getRoomDetails(id, roomId, {
    includeSensitiveDocuments: canManage,
  });
  const { property, room } = details;
  const tenantKey = room.tenantRecordId ?? room.tenantId ?? room.id;

  return (
    <section className="space-y-6">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-gray-500" aria-label="Breadcrumb">
        <Link href="/properties">Properties</Link>
        <ChevronRight className="h-4 w-4" />
        <Link href={`/properties/${id}`}>{property.name}</Link>
        <ChevronRight className="h-4 w-4" />
        <span className="font-medium text-gray-950">{room.roomNumber}</span>
      </nav>

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase text-[#b17f19]">Room Details</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{room.roomNumber}</h1>
          <p className="mt-2 text-sm text-gray-600">{property.name}</p>
        </div>
        <Badge className={roomStatusClass(room.status)}>
          {room.status}
        </Badge>
      </div>

      {room.tenantName ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <UserRound className="h-5 w-5 text-[#b17f19]" />
              <CardTitle className="text-base">Tenant Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="font-semibold text-gray-950">{room.tenantName}</p>
              <p className="flex items-center gap-2 text-gray-600"><Phone className="h-4 w-4" />{room.tenantPhone ?? "-"}</p>
              <p className="text-gray-600">IC / Passport: {room.identificationNumber ?? "-"}</p>
              <Button asChild className="mt-2" size="sm" variant="outline">
                <Link href={`/tenants/${tenantKey}`}>View Tenant Profile</Link>
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Rental Terms</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <p><span className="block text-gray-500">Check-in</span>{room.contractStart ?? "-"}</p>
              <p><span className="block text-gray-500">Due day</span>{room.dueDay ?? "-"}</p>
              <p><span className="block text-gray-500">Monthly rent</span>{money.format(room.monthlyRent)}</p>
              <p><span className="block text-gray-500">Contract end</span>{room.contractEnd ?? "-"}</p>
              <p><span className="block text-gray-500">Outstanding</span><span className={room.outstanding > 0 ? "font-semibold text-red-600" : "font-semibold text-emerald-700"}>{money.format(room.outstanding)}</span></p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Agreement & Payment</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Badge className={statusBadgeClass(room.agreementStatus)}>{room.agreementStatus.replaceAll("_", " ")}</Badge>
              <div className="flex flex-wrap gap-2">
                {room.agreementId ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/e-tenancy/${room.agreementId}`}><FileText className="h-4 w-4" /> View Agreement</Link>
                  </Button>
                ) : null}
                <PaymentQrPreview propertyName={property.name} qrUrl={property.paymentQrUrl} />
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-start justify-between gap-4 pt-6 sm:flex-row sm:items-center">
            <div>
              <p className="font-semibold text-gray-950">This room is vacant</p>
              <p className="mt-1 text-sm text-gray-600">Tenant, billing, agreement and payment history actions are not active.</p>
            </div>
            {canManage ? (
              <Button asChild>
                <Link href={`/register-tenant?property=${id}&room=${room.id}`}>
                  Register Tenant
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      )}

      {room.tenantName ? (
        <>
          <TenantDocuments
            canManageDocuments={canManage}
            documentResult={query.document}
            documents={details.documents}
            propertyId={property.id}
            returnView="room"
            roomId={room.id}
            tenantKey={tenantKey}
            tenantRecordId={room.tenantRecordId}
          />
          <TenantAgreementHistory agreements={details.agreementHistory} />
        </>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Monthly Bills</CardTitle>
          <CardDescription>Historical and current rent bills are retained.</CardDescription>
        </CardHeader>
        <CardContent>
          {details.bills.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Bill Month</TableHead><TableHead>Due Date</TableHead><TableHead>Amount</TableHead><TableHead>Paid</TableHead><TableHead>Outstanding</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {details.bills.map((bill) => {
                    const amount = Number(bill.amount ?? 0);
                    const paid = Number(bill.paid_amount ?? 0);
                    return (
                      <TableRow key={bill.id}>
                        <TableCell>{bill.bill_month}</TableCell>
                        <TableCell>{bill.due_date}</TableCell>
                        <TableCell>{money.format(amount)}</TableCell>
                        <TableCell>{money.format(paid)}</TableCell>
                        <TableCell className={amount - paid > 0 ? "font-medium text-red-600" : "text-emerald-700"}>{money.format(Math.max(amount - paid, 0))}</TableCell>
                        <TableCell><Badge className={statusBadgeClass(bill.status)}>{bill.status}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : <p className="text-sm text-gray-500">No rent bills found for this room.</p>}
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
                  <p className="text-xs text-gray-500">{payment.payment_date} · {payment.payment_method}</p>
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
              <div className="flex items-start justify-between gap-4 border-b border-[#e5e9ef] pb-3 last:border-0" key={ticket.id}>
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

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-[#126b5f]" />
            <CardTitle>Tenant Smart Meter Usage</CardTitle>
          </div>
          <CardDescription>
            Individual room consumption and top-ups. These readings are separate from the property utility bills paid by DEKEZ.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {details.smartMeters.length ? (
            <div className="space-y-5">
              {details.smartMeters.map((meter) => (
                <div className="rounded-md border border-[#d7dde5]" key={meter.id}>
                  <div className="flex flex-col justify-between gap-3 border-b border-[#e5e9ef] p-4 sm:flex-row sm:items-center">
                    <div>
                      <p className="font-semibold text-gray-950">
                        {meter.meter_type === "electricity" ? "Electricity" : "Water"} Meter
                      </p>
                      <p className="text-sm text-gray-500">
                        Room {room.roomNumber} · Meter {meter.meter_number}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <BatteryCharging className="h-4 w-4 text-[#126b5f]" />
                      <span className="text-sm font-medium">
                        Credit {money.format(Number(meter.remaining_credit ?? 0))}
                      </span>
                      <Badge className={statusBadgeClass(meter.status)}>{meter.status}</Badge>
                    </div>
                  </div>
                  {meter.readings.length ? (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Billing Month</TableHead>
                            <TableHead>Reading Date</TableHead>
                            <TableHead>Previous</TableHead>
                            <TableHead>Current</TableHead>
                            <TableHead>Usage</TableHead>
                            <TableHead>Rate</TableHead>
                            <TableHead>Charge</TableHead>
                            <TableHead>Top-up</TableHead>
                            <TableHead>Remaining Credit</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {meter.readings.map((reading) => (
                            <TableRow key={reading.id}>
                              <TableCell>{reading.billing_month}</TableCell>
                              <TableCell>{reading.reading_date}</TableCell>
                              <TableCell>{Number(reading.previous_reading ?? 0).toFixed(2)}</TableCell>
                              <TableCell>{Number(reading.current_reading ?? 0).toFixed(2)}</TableCell>
                              <TableCell>{Number(reading.usage ?? 0).toFixed(2)}</TableCell>
                              <TableCell>{money.format(Number(reading.rate ?? meter.rate ?? 0))}</TableCell>
                              <TableCell>{money.format(Number(reading.charge_amount ?? 0))}</TableCell>
                              <TableCell>{money.format(Number(reading.top_up_amount ?? 0))}</TableCell>
                              <TableCell>{money.format(Number(reading.remaining_credit ?? 0))}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <p className="p-4 text-sm text-gray-500">No smart-meter readings recorded yet.</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No smart meter is assigned to this room.</p>
          )}
        </CardContent>
      </Card>

      {room.tenantName && canManage ? (
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="text-base text-red-700">Check Out</CardTitle>
            <CardDescription>Closes the active tenancy, returns the room to Vacant, and stops future rent bills.</CardDescription>
          </CardHeader>
          <CardContent>
            <CheckoutForm action={checkoutRoom} propertyId={id} roomId={room.id} />
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
