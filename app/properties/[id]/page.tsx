import { Link } from "@/components/app-link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Droplets,
  FileText,
  Home,
  Plus,
  ReceiptText,
  UserPlus,
  Zap,
} from "lucide-react";
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
import { requireRole } from "@/lib/auth/session";
import { formatMalaysiaDate } from "@/lib/date-format";
import {
  getPropertyDetails,
  type PropertyRoomView,
} from "@/lib/data/property-details";
import { statusBadgeClass } from "@/lib/status-styles";
import {
  generateRoomAgreement,
  sendRoomAgreement,
  updateProperty,
  updatePropertyTenancySettings,
} from "./actions";
import { AgreementSettingsForm } from "./agreement-settings-form";
import {
  InlineRoomField,
  InlineTermSelector,
  PaymentQrCell,
  PropertyInformationForm,
  RoomNavigationRow,
} from "./property-controls";

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
  room_structure: "This property has no room structure available for adding rooms.",
  rooms_add: "The new rooms could not be added.",
  occupied_remove: "Total rooms cannot be reduced that far because occupied rooms must be kept.",
  room_history: "A selected vacant room has historical records and was kept.",
  rooms_remove: "The vacant rooms could not be removed.",
  tenancy: "A tenancy could not be prepared for this tenant.",
  agreement: "The tenancy agreement could not be generated.",
  agreement_settings: "The master agreement settings could not be saved.",
  qr_file: "Choose a JPG, PNG or WebP QR image smaller than 5 MB.",
  qr_room: "The selected room could not be found.",
  qr_upload: "The room payment QR could not be uploaded.",
  qr_save: "The room payment QR could not be saved.",
  lock_access:
    "Checkout was stopped because the tenant's TTLock passcode could not be revoked. Review Smart Devices before trying again.",
};

function fieldClass() {
  return "mt-1.5 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-sm text-gray-950 outline-none focus:border-[#b98a29] focus:ring-2 focus:ring-[#b98a29]/20";
}

function roomStatusClass(status: string) {
  const classes: Record<string, string> = {
    occupied: "bg-emerald-100 text-emerald-800",
    vacant: "bg-gray-100 text-gray-700",
    reserved: "bg-orange-100 text-orange-800",
    maintenance: "bg-red-100 text-red-700",
  };
  return classes[status] ?? "bg-gray-100 text-gray-700";
}

function contractWarning(contractEnd: string | null) {
  if (!contractEnd) return null;
  const todayText = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const day = 86_400_000;
  const remaining = Math.ceil(
    (Date.parse(`${contractEnd}T00:00:00Z`) - Date.parse(`${todayText}T00:00:00Z`)) / day,
  );
  if (remaining < 0) return { label: "Expired", className: "text-red-600" };
  if (remaining <= 30) {
    return {
      label: remaining === 0 ? "Expires today" : `Expires in ${remaining} day${remaining === 1 ? "" : "s"}`,
      className: "text-amber-700",
    };
  }
  return null;
}

function tenantHref(room: PropertyRoomView) {
  const tenantKey = room.tenantRecordId ?? room.tenantId;
  return tenantKey ? `/tenants/${tenantKey}` : null;
}

function malaysiaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function paymentStatus(room: PropertyRoomView) {
  if (!room.billId) return { label: "No Current Bill", status: "draft" };
  if (room.billStatus === "paid" || room.outstanding <= 0) {
    return { label: "Paid", status: "paid" };
  }
  if (room.billStatus === "pending_verification" || room.billStatus === "submitted") {
    return { label: "Pending Verification", status: "pending_verification" };
  }
  if (room.amountReceived > 0 || room.billStatus === "partial") {
    return { label: "Partially Paid", status: "partial" };
  }
  if (room.billDueDate && room.billDueDate < malaysiaDate()) {
    return { label: "Overdue", status: "overdue" };
  }
  return { label: "Unpaid", status: "unpaid" };
}

function isOverdue(room: PropertyRoomView) {
  return Boolean(
    room.billId &&
    room.billDueDate &&
    room.billDueDate < malaysiaDate() &&
    room.outstanding > 0,
  );
}

export default async function PropertyDetailsPage({ params, searchParams }: PageProps) {
  const role = await requireRole(["super_admin", "owner", "admin"]);
  const canManage = role === "super_admin" || role === "admin";
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const details = await getPropertyDetails(id);

  return (
    <section className="space-y-6">
      <Link
        className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-[#126b5f]"
        href="/properties"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Properties
      </Link>

      <div>
        <p className="text-xs font-semibold uppercase text-[#b17f19]">Property Management</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{details.property.name}</h1>
        <p className="mt-2 text-sm text-gray-600">
          {canManage
            ? "Manage property information, rooms, tenants and active rental terms."
            : "View property information, rooms, tenants and active rental terms."}
        </p>
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
          <CardDescription>
            {canManage
              ? "Edit the property and safely control its total room count."
              : "Owner access is read-only. Contact Admin when property information needs to change."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canManage ? (
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
                <input
                  className={fieldClass()}
                  name="totalRooms"
                  type="number"
                  min={details.occupiedCount}
                  defaultValue={details.rooms.length}
                  required
                />
              </label>
              <label className="block lg:col-span-2">
                <span className="text-sm font-medium text-gray-700">Full address</span>
                <textarea
                  className={`${fieldClass()} min-h-24 resize-y`}
                  name="address"
                  defaultValue={details.property.address}
                  required
                />
              </label>
              <div className="flex flex-col justify-between gap-4 border-t border-[#e5e9ef] pt-4 sm:flex-row sm:items-end lg:col-span-2">
                <PropertyOccupancy
                  occupied={details.occupiedCount}
                  total={details.rooms.length}
                  vacant={details.vacantCount}
                />
                <Button type="submit">Save Property</Button>
              </div>
            </PropertyInformationForm>
          ) : (
            <div className="space-y-5">
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <ReadOnlyPropertyField label="Property name" value={details.property.name} />
                <ReadOnlyPropertyField label="Property code" value={details.property.code || "-"} />
                <ReadOnlyPropertyField label="Area" value={details.property.area || "-"} />
                <ReadOnlyPropertyField label="Total rooms" value={String(details.rooms.length)} />
                <ReadOnlyPropertyField
                  className="sm:col-span-2 lg:col-span-4"
                  label="Full address"
                  value={details.property.address || "-"}
                />
              </dl>
              <div className="border-t border-[#e5e9ef] pt-4">
                <PropertyOccupancy
                  occupied={details.occupiedCount}
                  total={details.rooms.length}
                  vacant={details.vacantCount}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tenancy Agreement Settings</CardTitle>
          <CardDescription>
            {canManage
              ? "Configure this property for the DEKEZ Master Tenancy Agreement."
              : "Agreement settings are read-only for Owner access."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AgreementSettingsForm
            action={updatePropertyTenancySettings}
            propertyId={details.property.id}
            readOnly={!canManage}
            settings={details.agreementSettings}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Property Utility Bills</CardTitle>
            <CardDescription>
              Main water, electricity and operating utility bills for this property only.
            </CardDescription>
          </div>
          <Button asChild variant="outline">
            <Link href={`/utility-bills?property=${details.property.id}`}>View All Utility Bills</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-md border border-[#e5e9ef] p-4">
              <Droplets className="h-5 w-5 text-[#126b5f]" />
              <p className="mt-3 text-sm text-gray-500">Current Month Water</p>
              <p className="mt-1 text-lg font-semibold">{money.format(details.utilitySummary.currentMonthWater)}</p>
            </div>
            <div className="rounded-md border border-[#e5e9ef] p-4">
              <Zap className="h-5 w-5 text-[#b17f19]" />
              <p className="mt-3 text-sm text-gray-500">Current Month Electricity</p>
              <p className="mt-1 text-lg font-semibold">{money.format(details.utilitySummary.currentMonthElectricity)}</p>
            </div>
            <div className="rounded-md border border-[#e5e9ef] p-4">
              <ReceiptText className="h-5 w-5 text-[#126b5f]" />
              <p className="mt-3 text-sm text-gray-500">Total Utilities This Month</p>
              <p className="mt-1 text-lg font-semibold">{money.format(details.utilitySummary.totalThisMonth)}</p>
            </div>
            <div className="rounded-md border border-[#e5e9ef] p-4">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <p className="mt-3 text-sm text-gray-500">Outstanding Utilities</p>
              <p className={`mt-1 text-lg font-semibold ${details.utilitySummary.outstanding > 0 ? "text-red-600" : "text-emerald-700"}`}>
                {money.format(details.utilitySummary.outstanding)}
              </p>
            </div>
            <div className="rounded-md border border-[#e5e9ef] p-4">
              <p className="text-sm text-gray-500">Latest Payment Status</p>
              {details.utilitySummary.latestStatus ? (
                <Badge className={`mt-3 ${statusBadgeClass(details.utilitySummary.latestStatus)}`}>
                  {details.utilitySummary.latestStatus.replaceAll("_", " ")}
                </Badge>
              ) : (
                <p className="mt-3 text-sm text-gray-500">No bills yet</p>
              )}
              <p className="mt-2 text-xs text-gray-500">
                Paid: {details.utilitySummary.latestPaymentDate ?? "-"}
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs text-gray-500">
            Tenant smart-meter usage is separate and appears inside Room Details.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <CardTitle>Room Management</CardTitle>
              <CardDescription>One row is one room. Rent and due day save when you leave the field.</CardDescription>
            </div>
            {canManage ? (
              <Button asChild>
                <Link href={`/register-tenant?property=${id}`}>
                  <Plus className="h-4 w-4" />
                  Register New Tenant
                </Link>
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-md border border-[#eadcb9] bg-[#fbf8f1] px-4 py-3 text-sm text-gray-700">
            Each room keeps its own payment QR. Use <span className="font-semibold">Add QR</span> or{" "}
            <span className="font-semibold">Change</span> in that room&apos;s row.
          </div>

          <div className="hidden overflow-x-auto xl:block">
            <Table className="min-w-[1640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Room</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Monthly Rent</TableHead>
                  <TableHead>Deposit</TableHead>
                  <TableHead>Deposit Received</TableHead>
                  <TableHead>Rent Due Day</TableHead>
                  <TableHead>Contract Start</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead>Contract End Date</TableHead>
                  <TableHead>Agreement</TableHead>
                  <TableHead>Payment Status</TableHead>
                  <TableHead>Outstanding Balance</TableHead>
                  <TableHead>Payment QR</TableHead>
                  <TableHead className="min-w-52">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {details.rooms.map((room) => (
                  <DesktopRoomRow
                    key={room.id}
                    propertyId={id}
                    propertyName={details.property.name}
                    room={room}
                    canManage={canManage}
                  />
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-4 xl:hidden">
            {details.rooms.map((room) => (
              <MobileRoomCard
                key={room.id}
                propertyId={id}
                propertyName={details.property.name}
                room={room}
                canManage={canManage}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function ReadOnlyPropertyField({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-semibold uppercase text-gray-500">{label}</dt>
      <dd className="mt-1.5 font-medium text-gray-950">{value}</dd>
    </div>
  );
}

function PropertyOccupancy({
  occupied,
  total,
  vacant,
}: {
  occupied: number;
  total: number;
  vacant: number;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-gray-500">Occupied Rooms</p>
      <p className="mt-1 text-2xl font-semibold text-gray-950">
        {occupied} / {total}
        <span className="ml-2 text-sm font-normal text-gray-500">Rooms Occupied</span>
      </p>
      <p className="mt-1 text-xs text-gray-500">{vacant} vacant rooms available</p>
    </div>
  );
}

function HiddenRoomFields({ propertyId, room }: { propertyId: string; room: PropertyRoomView }) {
  return (
    <>
      <input name="propertyId" type="hidden" value={propertyId} />
      <input name="roomId" type="hidden" value={room.id} />
      <input name="tenantRecordId" type="hidden" value={room.tenantRecordId ?? ""} />
      <input name="tenancyId" type="hidden" value={room.tenancyId ?? ""} />
    </>
  );
}

function AgreementActions({
  canManage,
  propertyId,
  room,
}: {
  canManage: boolean;
  propertyId: string;
  room: PropertyRoomView;
}) {
  if (!room.tenantName) return null;
  if (!room.agreementId) {
    if (!canManage) {
      return <span className="text-xs text-gray-400">Not available</span>;
    }
    if (room.tenancyId) {
      return (
        <Button asChild size="sm" variant="outline">
          <Link href={`/tenancy-agreements/preview/${room.tenancyId}`}>
            Generate
          </Link>
        </Button>
      );
    }
    return (
      <form action={generateRoomAgreement}>
        <HiddenRoomFields propertyId={propertyId} room={room} />
        <Button size="sm" type="submit" variant="outline">
          Prepare
        </Button>
      </form>
    );
  }
  const isSigned = room.agreementStatus === "signed";
  const isExpired = room.agreementStatus === "expired";
  return (
    <div className="flex min-w-40 flex-wrap items-center gap-1.5">
      <Button asChild className="h-8 px-2 text-xs" size="sm" variant="outline">
        <Link
          href={`/api/tenancy-agreements/${room.agreementId}/pdf`}
          target="_blank"
        >
          View / print
        </Link>
      </Button>
      {isSigned ? (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
          Signed
          <CheckCircle2 className="h-3.5 w-3.5" />
        </span>
      ) : null}
      {isExpired ? (
        <span className="text-xs font-semibold text-red-600">Expired</span>
      ) : null}
      {canManage && !isSigned && !isExpired ? (
        <form action={sendRoomAgreement}>
          <HiddenRoomFields propertyId={propertyId} room={room} />
          <input name="agreementId" type="hidden" value={room.agreementId} />
          <Button className="h-8 px-2 text-xs" size="sm" type="submit" variant="outline">
            {room.agreementStatus === "draft" ? "Send" : "Resend"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function DesktopRoomRow({
  canManage,
  propertyId,
  propertyName,
  room,
}: {
  canManage: boolean;
  propertyId: string;
  propertyName: string;
  room: PropertyRoomView;
}) {
  const vacant = room.status === "vacant";
  const profileHref = tenantHref(room);
  const warning = contractWarning(room.contractEnd);
  const payment = paymentStatus(room);
  const overdue = isOverdue(room);

  return (
    <RoomNavigationRow
      className={vacant ? "bg-gray-50/70" : undefined}
      href={`/properties/${propertyId}/rooms/${room.id}`}
    >
      <TableCell>
        <Link
          className="font-semibold text-gray-950 hover:text-[#126b5f]"
          href={`/properties/${propertyId}/rooms/${room.id}`}
        >
          {room.roomNumber}
        </Link>
      </TableCell>
      <TableCell>
        <Badge className={roomStatusClass(room.status)}>
          {room.status.charAt(0).toUpperCase() + room.status.slice(1)}
        </Badge>
      </TableCell>
      <TableCell>
        {profileHref ? (
          <Link className="font-medium text-gray-950 hover:text-[#126b5f]" href={profileHref}>
            {room.tenantName}
          </Link>
        ) : (
          <span className={vacant ? "text-gray-400" : "font-medium text-amber-700"}>
            {vacant ? "No tenant" : "Assignment missing"}
          </span>
        )}
      </TableCell>
      <TableCell>
        <InlineRoomField
          propertyId={propertyId}
          roomId={room.id}
          tenantRecordId={room.tenantRecordId}
          tenancyId={room.tenancyId}
          field="monthlyRent"
          value={room.monthlyRent}
          label={`${room.roomNumber} monthly rent`}
          editable={canManage}
        />
      </TableCell>
      <TableCell>
        {vacant ? money.format(room.deposit) : (
          <InlineRoomField
            propertyId={propertyId}
            roomId={room.id}
            tenantRecordId={room.tenantRecordId}
            tenancyId={room.tenancyId}
            field="deposit"
            value={room.deposit}
            label={`${room.roomNumber} deposit`}
            editable={canManage}
          />
        )}
      </TableCell>
      <TableCell>
        {vacant ? <span className="text-gray-400">-</span> : (
          <InlineRoomField
            propertyId={propertyId}
            roomId={room.id}
            tenantRecordId={room.tenantRecordId}
            tenancyId={room.tenancyId}
            field="depositReceived"
            value={room.depositReceived}
            maxValue={room.deposit}
            balanceTotal={room.deposit}
            label={`${room.roomNumber} deposit received`}
            editable={canManage}
          />
        )}
      </TableCell>
      <TableCell>
        {room.tenantName && room.dueDay ? (
          <InlineRoomField
            propertyId={propertyId}
            roomId={room.id}
            tenantRecordId={room.tenantRecordId}
            tenancyId={room.tenancyId}
            field="dueDay"
            value={room.dueDay}
            label={`${room.roomNumber} rent due day`}
            editable={canManage}
          />
        ) : <span className="text-gray-400">-</span>}
      </TableCell>
      <TableCell>{formatMalaysiaDate(room.contractStart)}</TableCell>
      <TableCell>
        {vacant ? <span className="text-gray-400">-</span> : (
          <InlineTermSelector
            propertyId={propertyId}
            roomId={room.id}
            tenantRecordId={room.tenantRecordId}
            tenancyId={room.tenancyId}
            value={room.contractDurationMonths}
            label={`${room.roomNumber} tenancy term`}
            editable={canManage}
          />
        )}
      </TableCell>
      <TableCell>
        {vacant ? <span className="text-gray-400">-</span> : (
          <InlineRoomField
            propertyId={propertyId}
            roomId={room.id}
            tenantRecordId={room.tenantRecordId}
            tenancyId={room.tenancyId}
            field="contractEnd"
            value={room.contractEnd ?? ""}
            label={`${room.roomNumber} contract end date`}
            editable={canManage}
          />
        )}
        {warning ? (
          <p className={`mt-1 flex items-center gap-1 text-xs font-medium ${warning.className}`}>
            <AlertTriangle className="h-3 w-3" />
            {warning.label}
          </p>
        ) : null}
      </TableCell>
      <TableCell>
        {vacant ? <span className="text-gray-400">-</span> : (
          <AgreementActions canManage={canManage} propertyId={propertyId} room={room} />
        )}
      </TableCell>
      <TableCell>
        {vacant ? <span className="text-gray-400">-</span> : (
          <div className="space-y-1">
            <Badge className={statusBadgeClass(payment.status)}>{payment.label}</Badge>
            <p className="text-xs text-gray-500">Paid {money.format(room.amountReceived)}</p>
            {overdue ? <p className="text-xs font-medium text-red-600">Overdue since {room.billDueDate}</p> : null}
          </div>
        )}
      </TableCell>
      <TableCell>
        <p className={room.outstanding > 0 ? "font-semibold text-red-600" : "font-semibold text-emerald-700"}>
          {money.format(room.outstanding)}
        </p>
        {!vacant && room.outstanding <= 0 ? <p className="mt-1 text-xs text-emerald-700">No overdue balance</p> : null}
      </TableCell>
      <TableCell>
        <PaymentQrCell
          canManage={canManage}
          hasRoomPaymentQr={room.hasRoomPaymentQr}
          propertyId={propertyId}
          propertyName={`${propertyName} - ${room.roomNumber}`}
          qrUrl={room.paymentQrUrl}
          roomId={room.id}
        />
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-2">
          {vacant && canManage ? (
            <Button asChild size="sm">
              <Link
                href={`/register-tenant?property=${propertyId}&room=${room.id}`}
              >
                <UserPlus className="h-4 w-4" />
                Register Tenant
              </Link>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="ghost">
            <Link href={`/properties/${propertyId}/rooms/${room.id}`}>
              Open Room
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </TableCell>
    </RoomNavigationRow>
  );
}

function MobileRoomCard({
  canManage,
  propertyId,
  propertyName,
  room,
}: {
  canManage: boolean;
  propertyId: string;
  propertyName: string;
  room: PropertyRoomView;
}) {
  const vacant = room.status === "vacant";
  const profileHref = tenantHref(room);
  const warning = contractWarning(room.contractEnd);
  const payment = paymentStatus(room);
  const overdue = isOverdue(room);

  return (
    <article className={`rounded-md border p-4 ${vacant ? "border-gray-200 bg-gray-50" : "border-[#d7dde5] bg-white"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link className="font-semibold text-gray-950" href={`/properties/${propertyId}/rooms/${room.id}`}>
            {room.roomNumber}
          </Link>
          {profileHref ? (
            <Link className="mt-1 block text-sm text-[#126b5f]" href={profileHref}>{room.tenantName}</Link>
          ) : (
            <p className="mt-1 text-sm text-gray-500">{vacant ? "No tenant" : "Tenant assignment missing"}</p>
          )}
        </div>
        <Badge className={roomStatusClass(room.status)}>
          {room.status.charAt(0).toUpperCase() + room.status.slice(1)}
        </Badge>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-gray-500">Monthly Rent</dt>
          <dd className="mt-1">
            <InlineRoomField
              propertyId={propertyId}
              roomId={room.id}
              tenantRecordId={room.tenantRecordId}
              tenancyId={room.tenancyId}
              field="monthlyRent"
              value={room.monthlyRent}
              label={`${room.roomNumber} monthly rent`}
              editable={canManage}
            />
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Deposit</dt>
          <dd className="mt-1">
            {vacant ? <span className="font-medium">{money.format(room.deposit)}</span> : (
              <InlineRoomField
                propertyId={propertyId}
                roomId={room.id}
                tenantRecordId={room.tenantRecordId}
                tenancyId={room.tenancyId}
                field="deposit"
                value={room.deposit}
                label={`${room.roomNumber} deposit`}
                editable={canManage}
              />
            )}
          </dd>
        </div>
        {!vacant ? (
          <>
            <div>
              <dt className="text-gray-500">Deposit Received</dt>
              <dd className="mt-1">
                <InlineRoomField
                  propertyId={propertyId}
                  roomId={room.id}
                  tenantRecordId={room.tenantRecordId}
                  tenancyId={room.tenancyId}
                  field="depositReceived"
                  value={room.depositReceived}
                  maxValue={room.deposit}
                  balanceTotal={room.deposit}
                  label={`${room.roomNumber} deposit received`}
                  editable={canManage}
                />
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Rent Due Day</dt>
              <dd className="mt-1">
                {room.dueDay ? (
                  <InlineRoomField
                    propertyId={propertyId}
                    roomId={room.id}
                    tenantRecordId={room.tenantRecordId}
                    tenancyId={room.tenancyId}
                    field="dueDay"
                    value={room.dueDay}
                    label={`${room.roomNumber} rent due day`}
                    editable={canManage}
                  />
                ) : "-"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Contract Start</dt>
              <dd className="mt-1 font-medium">{formatMalaysiaDate(room.contractStart)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Term</dt>
              <dd className="mt-1">
                <InlineTermSelector
                  propertyId={propertyId}
                  roomId={room.id}
                  tenantRecordId={room.tenantRecordId}
                  tenancyId={room.tenancyId}
                  value={room.contractDurationMonths}
                  label={`${room.roomNumber} tenancy term`}
                  editable={canManage}
                />
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Contract End</dt>
              <dd className="mt-1">
                <InlineRoomField
                  propertyId={propertyId}
                  roomId={room.id}
                  tenantRecordId={room.tenantRecordId}
                  tenancyId={room.tenancyId}
                  field="contractEnd"
                  value={room.contractEnd ?? ""}
                  label={`${room.roomNumber} contract end date`}
                  editable={canManage}
                />
              </dd>
              {warning ? <p className={`mt-1 text-xs ${warning.className}`}>{warning.label}</p> : null}
            </div>
            <div>
              <dt className="text-gray-500">Outstanding</dt>
              <dd className={`mt-1 font-semibold ${room.outstanding > 0 ? "text-red-600" : "text-emerald-700"}`}>
                {money.format(room.outstanding)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Payment</dt>
              <dd className="mt-1"><Badge className={statusBadgeClass(payment.status)}>{payment.label}</Badge></dd>
              {overdue ? <p className="mt-1 text-xs font-medium text-red-600">Overdue since {room.billDueDate}</p> : null}
            </div>
            <div>
              <dt className="text-gray-500">Agreement</dt>
              <dd className="mt-1">
                <AgreementActions canManage={canManage} propertyId={propertyId} room={room} />
              </dd>
            </div>
          </>
        ) : null}
        <div>
          <dt className="text-gray-500">Payment QR</dt>
          <dd className="mt-1">
            <PaymentQrCell
              canManage={canManage}
              hasRoomPaymentQr={room.hasRoomPaymentQr}
              propertyId={propertyId}
              propertyName={`${propertyName} - ${room.roomNumber}`}
              qrUrl={room.paymentQrUrl}
              roomId={room.id}
            />
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-[#e5e9ef] pt-4">
        {vacant && canManage ? (
          <Button asChild size="sm">
            <Link
              href={`/register-tenant?property=${propertyId}&room=${room.id}`}
            >
              <UserPlus className="h-4 w-4" />
              Register Tenant
            </Link>
          </Button>
        ) : null}
        <Button asChild size="sm" variant="outline">
          <Link href={`/properties/${propertyId}/rooms/${room.id}`}>
            <Home className="h-4 w-4" />
            Open Room
          </Link>
        </Button>
        {room.agreementId ? (
          <Button asChild size="sm" variant="ghost">
            <Link href={`/e-tenancy/${room.agreementId}`}>
              <FileText className="h-4 w-4" />
              Agreement
            </Link>
          </Button>
        ) : null}
      </div>
    </article>
  );
}
