import Link from "next/link";
import { ChevronRight, FileText, Home, Plus, QrCode, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { getPropertyDetails, type PropertyRoomView } from "@/lib/data/property-details";
import { statusBadgeClass } from "@/lib/status-styles";
import {
  generateRoomAgreement,
  sendRoomAgreement,
  updatePaymentQr,
  updateProperty,
  updateRoomTerms,
} from "./actions";
import { PaymentQrPreview, PropertyInformationForm } from "./property-controls";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

const money = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

const messages: Record<string, string> = {
  property: "Property information could not be saved.",
  room_structure: "This property has no legacy room group available for adding rooms.",
  rooms_add: "The new rooms could not be added.",
  occupied_remove: "Total rooms cannot be reduced that far because occupied rooms must be kept.",
  room_history: "A selected vacant room has historical records and was kept.",
  rooms_remove: "The vacant rooms could not be removed.",
  received_decrease: "Amount received cannot be reduced here because verified payment history is preserved.",
  tenancy: "A tenancy could not be prepared for this tenant.",
  agreement: "The tenancy agreement could not be generated.",
};

function fieldClass() {
  return "mt-1.5 w-full min-w-24 rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-sm text-gray-950 outline-none focus:border-[#b98a29] focus:ring-2 focus:ring-[#b98a29]/20";
}

function agreementLabel(status: string) {
  const labels: Record<string, string> = {
    not_generated: "Not generated",
    draft: "Not sent",
    pending_signature: "Awaiting signature",
    signed: "Signed",
    expired: "Expired",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}

function paymentLabel(room: PropertyRoomView) {
  if (!room.billId) return "No current bill";
  if (room.billStatus === "paid" || room.outstanding <= 0) return "Paid";
  if (room.amountReceived > 0) return "Partially paid";
  if (room.billStatus === "pending_verification" || room.billStatus === "submitted") return "Pending verification";
  return room.billStatus?.replaceAll("_", " ") ?? "Unpaid";
}

export default async function PropertyDetailsPage({ params, searchParams }: PageProps) {
  await requireRole(["super_admin", "owner", "admin"]);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const details = await getPropertyDetails(id);

  return (
    <section className="space-y-6">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-gray-500" aria-label="Breadcrumb">
        <Link className="hover:text-[#126b5f]" href="/properties">Properties</Link>
        <ChevronRight className="h-4 w-4" />
        <span className="font-medium text-gray-950">{details.property.name}</span>
      </nav>

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase text-[#b17f19]">Property Management</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{details.property.name}</h1>
          <p className="mt-2 text-sm text-gray-600">
            {details.occupiedCount} / {details.rooms.length} rooms occupied
          </p>
        </div>
        <Button asChild>
          <Link href={`/properties/${id}/register-tenant`}>
            <UserPlus className="h-4 w-4" />
            Register New Tenant
          </Link>
        </Button>
      </div>

      {query.saved ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          Changes saved successfully.
        </div>
      ) : null}
      {query.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {messages[query.error] ?? "The requested change could not be completed."}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Property Information</CardTitle>
          <CardDescription>Edit property details and control the room count.</CardDescription>
        </CardHeader>
        <CardContent>
          <PropertyInformationForm action={updateProperty} currentRooms={details.rooms.length}>
            <input name="propertyId" type="hidden" value={details.property.id} />
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Property name</span>
              <input className={fieldClass()} name="name" defaultValue={details.property.name} required />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Property code</span>
              <input className={fieldClass()} name="propertyCode" defaultValue={details.property.code} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Area</span>
              <input className={fieldClass()} name="area" defaultValue={details.property.area} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Total rooms</span>
              <input className={fieldClass()} name="totalRooms" type="number" min={details.occupiedCount} defaultValue={details.rooms.length} required />
              <span className="mt-1 block text-xs text-gray-500">
                {details.occupiedCount} occupied, {details.vacantCount} vacant
              </span>
            </label>
            <label className="block lg:col-span-2">
              <span className="text-sm font-medium text-gray-700">Full address</span>
              <textarea className={`${fieldClass()} min-h-24 resize-y`} name="address" defaultValue={details.property.address} required />
            </label>
            <div className="lg:col-span-2">
              <Button type="submit">Save Property</Button>
            </div>
          </PropertyInformationForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <CardTitle>Property Payment QR</CardTitle>
              <CardDescription>One property-level QR is reused for every occupied room.</CardDescription>
            </div>
            <PaymentQrPreview propertyName={details.property.name} qrUrl={details.property.paymentQrUrl} />
          </div>
        </CardHeader>
        <CardContent>
          <form action={updatePaymentQr} className="flex flex-col gap-3 sm:flex-row">
            <input name="propertyId" type="hidden" value={details.property.id} />
            <label className="flex-1">
              <span className="sr-only">Payment QR image URL</span>
              <input className={fieldClass()} name="paymentQrUrl" type="url" defaultValue={details.property.paymentQrUrl ?? ""} placeholder="https://.../payment-qr.png" />
            </label>
            <Button className="sm:self-end" type="submit" variant="outline">
              <QrCode className="h-4 w-4" />
              Change QR
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <CardTitle>Rooms</CardTitle>
              <CardDescription>Manage rent, tenancy, billing and agreements without a Units step.</CardDescription>
            </div>
            <Button asChild size="sm">
              <Link href={`/properties/${id}/register-tenant`}>
                <Plus className="h-4 w-4" />
                Register New Tenant
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="hidden overflow-x-auto xl:block">
            <Table className="min-w-[1700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Room</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Monthly Rent</TableHead>
                  <TableHead>Deposit</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Due Day</TableHead>
                  <TableHead>Contract Start</TableHead>
                  <TableHead>Contract End</TableHead>
                  <TableHead>Agreement</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Outstanding</TableHead>
                  <TableHead>Payment QR</TableHead>
                  <TableHead className="min-w-52">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {details.rooms.map((room) => (
                  <DesktopRoomRow key={room.id} propertyId={id} room={room} qrUrl={details.property.paymentQrUrl} />
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-4 xl:hidden">
            {details.rooms.map((room) => (
              <MobileRoomCard key={room.id} propertyId={id} room={room} qrUrl={details.property.paymentQrUrl} />
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function RoomEditFields({ room }: { room: PropertyRoomView }) {
  return (
    <>
      <input name="monthlyRent" className={fieldClass()} type="number" min="0" step="0.01" defaultValue={room.monthlyRent} aria-label="Monthly rent" />
      <input name="deposit" className={fieldClass()} type="number" min="0" step="0.01" defaultValue={room.deposit} aria-label="Deposit" />
      <input name="amountReceived" className={fieldClass()} type="number" min={room.amountReceived} step="0.01" defaultValue={room.amountReceived} aria-label="Amount received" />
      <input name="dueDay" className={fieldClass()} type="number" min="1" max="31" defaultValue={room.dueDay ?? 1} aria-label="Rent due day" />
      <input name="contractEnd" className={fieldClass()} type="date" defaultValue={room.contractEnd ?? ""} aria-label="Contract end" />
    </>
  );
}

function HiddenRoomFields({ propertyId, room }: { propertyId: string; room: PropertyRoomView }) {
  return (
    <>
      <input name="propertyId" type="hidden" value={propertyId} />
      <input name="roomId" type="hidden" value={room.id} />
      <input name="tenantRecordId" type="hidden" value={room.tenantRecordId ?? ""} />
      <input name="tenancyId" type="hidden" value={room.tenancyId ?? ""} />
      <input name="billId" type="hidden" value={room.billId ?? ""} />
    </>
  );
}

function AgreementActions({ propertyId, room }: { propertyId: string; room: PropertyRoomView }) {
  if (!room.tenantName) return null;
  if (!room.agreementId) {
    return (
      <form action={generateRoomAgreement}>
        <HiddenRoomFields propertyId={propertyId} room={room} />
        <Button size="sm" type="submit" variant="outline">Generate</Button>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild size="sm" variant="outline">
        <Link href={`/e-tenancy/${room.agreementId}`}>View / Print</Link>
      </Button>
      {room.agreementStatus !== "signed" ? (
        <form action={sendRoomAgreement}>
          <HiddenRoomFields propertyId={propertyId} room={room} />
          <input name="agreementId" type="hidden" value={room.agreementId} />
          <Button size="sm" type="submit" variant="outline">
            {room.agreementStatus === "draft" ? "Send" : "Resend"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function DesktopRoomRow({ propertyId, room, qrUrl }: { propertyId: string; room: PropertyRoomView; qrUrl: string | null }) {
  if (room.status === "vacant") {
    return (
      <TableRow className="bg-red-50/60">
        <TableCell>
          <Link className="font-semibold text-gray-950 hover:text-[#126b5f]" href={`/properties/${propertyId}/rooms/${room.id}`}>
            {room.roomNumber}
          </Link>
        </TableCell>
        <TableCell className="text-gray-400">No tenant</TableCell>
        <TableCell><Badge className="bg-red-100 text-red-700">Vacant</Badge></TableCell>
        <TableCell>{money.format(room.monthlyRent)}</TableCell>
        <TableCell>{money.format(room.deposit)}</TableCell>
        <TableCell colSpan={8} className="text-sm text-gray-400">Tenant billing and agreement actions are hidden while vacant.</TableCell>
        <TableCell>
          <Button asChild size="sm">
            <Link href={`/properties/${propertyId}/register-tenant?room=${room.id}`}>Register Tenant</Link>
          </Button>
        </TableCell>
      </TableRow>
    );
  }

  if (!room.tenantName) {
    return (
      <TableRow className="bg-amber-50/60">
        <TableCell>
          <Link className="font-semibold text-gray-950 hover:text-[#126b5f]" href={`/properties/${propertyId}/rooms/${room.id}`}>
            {room.roomNumber}
          </Link>
        </TableCell>
        <TableCell className="font-medium text-amber-800">Tenant assignment missing</TableCell>
        <TableCell><Badge className={statusBadgeClass(room.status)}>{room.status}</Badge></TableCell>
        <TableCell>{money.format(room.monthlyRent)}</TableCell>
        <TableCell colSpan={9} className="text-sm text-amber-800">
          This occupied room was kept unchanged. Open the room to review its tenant assignment.
        </TableCell>
        <TableCell>
          <Button asChild size="sm" variant="outline">
            <Link href={`/properties/${propertyId}/rooms/${room.id}`}>Review Room</Link>
          </Button>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell>
        <Link className="font-semibold text-gray-950 hover:text-[#126b5f]" href={`/properties/${propertyId}/rooms/${room.id}`}>
          {room.roomNumber}
        </Link>
      </TableCell>
      <TableCell>
        <Link className="font-medium hover:text-[#126b5f]" href={`/properties/${propertyId}/rooms/${room.id}`}>{room.tenantName}</Link>
      </TableCell>
      <TableCell><Badge className={statusBadgeClass(room.status)}>{room.status}</Badge></TableCell>
      <TableCell colSpan={6} className="p-2 align-top">
        <form action={updateRoomTerms} className="grid grid-cols-5 gap-2">
          <HiddenRoomFields propertyId={propertyId} room={room} />
          <RoomEditFields room={room} />
          <div className="col-span-5 flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500">Start: {room.contractStart ?? "-"}</span>
            <Button size="sm" type="submit">Save row</Button>
          </div>
        </form>
      </TableCell>
      <TableCell>
        <Badge className={statusBadgeClass(room.agreementStatus)}>{agreementLabel(room.agreementStatus)}</Badge>
      </TableCell>
      <TableCell><Badge className={statusBadgeClass(room.billStatus ?? "unpaid")}>{paymentLabel(room)}</Badge></TableCell>
      <TableCell className={room.outstanding > 0 ? "font-semibold text-red-600" : "font-semibold text-emerald-700"}>
        {money.format(room.outstanding)}
      </TableCell>
      <TableCell>{qrUrl ? <QrCode className="h-5 w-5 text-[#b17f19]" /> : <span className="text-xs text-gray-400">None</span>}</TableCell>
      <TableCell>
        <div className="flex flex-col gap-2">
          <AgreementActions propertyId={propertyId} room={room} />
          <Button asChild size="sm" variant="ghost">
            <Link href={`/properties/${propertyId}/rooms/${room.id}`}>Open details <ChevronRight className="h-4 w-4" /></Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function MobileRoomCard({ propertyId, room, qrUrl }: { propertyId: string; room: PropertyRoomView; qrUrl: string | null }) {
  const vacant = room.status === "vacant";
  const missingTenant = !vacant && !room.tenantName;
  return (
    <div className={`rounded-md border p-4 ${vacant ? "border-red-200 bg-red-50" : "border-[#d7dde5] bg-white"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link className="font-semibold text-gray-950" href={`/properties/${propertyId}/rooms/${room.id}`}>{room.roomNumber}</Link>
          <p className="mt-1 text-sm text-gray-600">{room.tenantName ?? "No tenant"}</p>
        </div>
        <Badge className={vacant ? "bg-red-100 text-red-700" : statusBadgeClass(room.status)}>{vacant ? "Vacant" : room.status}</Badge>
      </div>
      {vacant ? (
        <Button asChild className="mt-4 w-full">
          <Link href={`/properties/${propertyId}/register-tenant?room=${room.id}`}>
            <UserPlus className="h-4 w-4" /> Register Tenant
          </Link>
        </Button>
      ) : missingTenant ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Tenant assignment is missing. The occupied room was not changed.
          <Button asChild className="mt-3 w-full" size="sm" variant="outline">
            <Link href={`/properties/${propertyId}/rooms/${room.id}`}>Review Room</Link>
          </Button>
        </div>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-gray-500">Rent</dt><dd className="font-medium">{money.format(room.monthlyRent)}</dd></div>
            <div><dt className="text-gray-500">Due day</dt><dd className="font-medium">{room.dueDay ?? "-"}</dd></div>
            <div><dt className="text-gray-500">Outstanding</dt><dd className={room.outstanding > 0 ? "font-semibold text-red-600" : "font-semibold text-emerald-700"}>{money.format(room.outstanding)}</dd></div>
            <div><dt className="text-gray-500">Agreement</dt><dd className="font-medium">{agreementLabel(room.agreementStatus)}</dd></div>
            <div><dt className="text-gray-500">Payment</dt><dd className="font-medium">{paymentLabel(room)}</dd></div>
            <div><dt className="text-gray-500">Payment QR</dt><dd className="font-medium">{qrUrl ? "Available" : "Not set"}</dd></div>
          </dl>
          <details className="mt-4 rounded-md border border-[#d7dde5] p-3">
            <summary className="cursor-pointer text-sm font-semibold">Edit room terms</summary>
            <form action={updateRoomTerms} className="mt-3 grid gap-3">
              <HiddenRoomFields propertyId={propertyId} room={room} />
              <RoomEditFields room={room} />
              <Button type="submit">Save Changes</Button>
            </form>
          </details>
          <div className="mt-4 flex flex-wrap gap-2">
            <AgreementActions propertyId={propertyId} room={room} />
            <Button asChild size="sm" variant="outline">
              <Link href={`/properties/${propertyId}/rooms/${room.id}`}>
                <Home className="h-4 w-4" /> Open Room
              </Link>
            </Button>
            {room.agreementId ? (
              <Button asChild size="sm" variant="ghost">
                <Link href={`/e-tenancy/${room.agreementId}`}><FileText className="h-4 w-4" /> Agreement</Link>
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
