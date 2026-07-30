import { Link } from "@/components/app-link";
import {
  ArrowRight,
  Banknote,
  Building2,
  CircleCheckBig,
  CircleDollarSign,
  CircleEllipsis,
  ReceiptText,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { formatMalaysiaDate } from "@/lib/date-format";
import { AdminPaymentSlipUpload } from "./admin-payment-slip-upload";
import { PaymentFlashNotice } from "./payment-flash-notice";
import {
  getRentDueMap,
  summarizeRentCollections,
  type RentCollectionRow,
  type RentCollectionStatus,
  type RentMapProperty,
  type RentMapRoom,
} from "@/lib/data/rent-due-map";
import { money } from "@/lib/e-tenancy";

type PageProps = {
  searchParams: Promise<{
    error?: string;
    property?: string;
    month?: string;
    uploaded?: string;
  }>;
};

const uploadErrorMessages: Record<string, string> = {
  bill_not_found: "This rent bill is no longer available for payment.",
  proof_create: "The payment record could not be created. Please try again.",
  proof_missing: "Enter the payment details and attach a payment slip.",
  proof_pending: "A payment slip for this bill is already waiting for verification.",
  proof_size: "The payment slip must be 10 MB or smaller.",
  proof_type: "Upload an image or PDF payment slip.",
  proof_upload: "The payment slip could not be uploaded. Please try again.",
};

const collectionStatusClasses: Record<RentCollectionStatus, string> = {
  paid: "bg-emerald-100 text-emerald-800",
  partially_paid: "bg-amber-100 text-amber-800",
  unpaid: "bg-red-100 text-red-800",
  pending_verification: "bg-yellow-100 text-yellow-800",
};

const collectionStatusLabels: Record<RentCollectionStatus, string> = {
  paid: "Paid",
  partially_paid: "Partially Paid",
  unpaid: "Unpaid",
  pending_verification: "Payment Submitted - Pending Verification",
};

function dateLabel(value: string | null) {
  return formatMalaysiaDate(value);
}

function SummaryCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card className="rounded-lg">
      <CardContent className="flex min-h-32 items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-[#0b1733]">{value}</p>
          <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#f5ecd7] text-[#9a6b12]">
          {icon}
        </span>
      </CardContent>
    </Card>
  );
}

function CollectionBadge({ status }: { status: RentCollectionStatus }) {
  return (
    <span
      className={`inline-flex max-w-48 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${collectionStatusClasses[status]}`}
    >
      {collectionStatusLabels[status]}
    </span>
  );
}

type DueUrgency = "future" | "due_today" | "overdue" | "severely_overdue";

const dueUrgencyStyles: Record<DueUrgency, string> = {
  future: "border-gray-300 bg-white text-gray-950 hover:border-gray-500",
  due_today: "border-yellow-400 bg-yellow-50 text-yellow-950 hover:border-yellow-500",
  overdue: "border-orange-400 bg-orange-50 text-orange-950 hover:border-orange-500",
  severely_overdue: "border-red-400 bg-red-50 text-red-950 hover:border-red-500",
};

function malaysiaToday() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function dateOnlyValue(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function dueTiming(room: RentMapRoom, today: string) {
  if (!room.dueDate) {
    return {
      urgency: "future" as DueUrgency,
      label: `Due day ${room.dueDay ?? "-"}`,
    };
  }

  const daysOverdue = Math.round(
    (dateOnlyValue(today) - dateOnlyValue(room.dueDate)) / 86_400_000,
  );

  if (daysOverdue >= 7) {
    return {
      urgency: "severely_overdue" as DueUrgency,
      label: `${daysOverdue} days overdue`,
    };
  }

  if (daysOverdue > 0) {
    return {
      urgency: "overdue" as DueUrgency,
      label: `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue`,
    };
  }

  if (daysOverdue === 0) {
    return {
      urgency: "due_today" as DueUrgency,
      label: "Due today",
    };
  }

  const daysUntilDue = Math.abs(daysOverdue);
  return {
    urgency: "future" as DueUrgency,
    label: `Due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`,
  };
}

function compactRoomLabel(roomNumber: string) {
  const number = roomNumber
    .trim()
    .replace(/^(?:(?:room|r)\s*)+/i, "")
    .replace(/\s+/g, "")
    .toUpperCase();
  return number ? `R${number}` : "Room";
}

function RoomCard({ room, today }: { room: RentMapRoom; today: string }) {
  const timing = dueTiming(room, today);
  const roomLabel = compactRoomLabel(room.roomNumber);

  return (
    <Link
      href={`/properties/${room.propertyId}/rooms/${room.id}`}
      aria-label={`Open ${roomLabel}, due day ${room.dueDay ?? "not set"}, ${timing.label}`}
      className={`group rounded-lg border p-3 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b98a2c] ${dueUrgencyStyles[timing.urgency]}`}
    >
      <p className="font-semibold">{roomLabel}</p>
      <p className="mt-1 text-xs font-medium text-current/75">
        Due day {room.dueDay ?? "-"}
      </p>
      <p className="mt-0.5 text-xs font-semibold">{timing.label}</p>
    </Link>
  );
}

function PropertySummaryTable({
  properties,
}: {
  properties: RentMapProperty[];
}) {
  const occupiedRooms = (property: RentMapProperty) =>
    property.rooms.filter((room) => Boolean(room.tenantName)).length;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-[#0b1733]">Property Summary</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Each total uses the selected billing month only.
        </p>
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-[#d8dee8] bg-white md:block">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-[#d8dee8] bg-[#f8fafc] text-xs uppercase text-[#60708a]">
            <tr>
              <th className="px-4 py-3">Property</th>
              <th className="px-4 py-3 text-center">Occupied rooms</th>
              <th className="px-4 py-3 text-right">Total due</th>
              <th className="px-4 py-3 text-right">Total paid</th>
              <th className="px-4 py-3 text-right">Outstanding</th>
              <th className="px-4 py-3 text-center">Paid rooms</th>
              <th className="px-4 py-3 text-center">Partial</th>
              <th className="px-4 py-3 text-center">Unpaid</th>
            </tr>
          </thead>
          <tbody>
            {properties.map((property) => (
              <tr key={property.id} className="border-b border-[#e4e9f0] last:border-b-0">
                <td className="px-4 py-3 font-medium text-[#0b1733]">{property.name}</td>
                <td className="px-4 py-3 text-center font-semibold">
                  {occupiedRooms(property)}
                </td>
                <td className="px-4 py-3 text-right">{money(property.summary.totalRentDue)}</td>
                <td className="px-4 py-3 text-right text-emerald-700">{money(property.summary.totalPaid)}</td>
                <td className="px-4 py-3 text-right font-semibold text-red-700">
                  {money(property.summary.totalOutstanding)}
                </td>
                <td className="px-4 py-3 text-center">{property.summary.fullyPaid}</td>
                <td className="px-4 py-3 text-center">{property.summary.partiallyPaid}</td>
                <td className="px-4 py-3 text-center">{property.summary.unpaid}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {properties.map((property) => (
          <div key={property.id} className="rounded-lg border border-[#d8dee8] bg-white p-4">
            <h3 className="font-semibold text-[#0b1733]">{property.name}</h3>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <p><span className="block text-xs text-muted-foreground">Total due</span>{money(property.summary.totalRentDue)}</p>
              <p><span className="block text-xs text-muted-foreground">Occupied rooms</span>{occupiedRooms(property)}</p>
              <p><span className="block text-xs text-muted-foreground">Total paid</span>{money(property.summary.totalPaid)}</p>
              <p><span className="block text-xs text-muted-foreground">Outstanding</span><span className="font-semibold text-red-700">{money(property.summary.totalOutstanding)}</span></p>
              <p><span className="block text-xs text-muted-foreground">Paid / Partial / Unpaid</span>{property.summary.fullyPaid} / {property.summary.partiallyPaid} / {property.summary.unpaid}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CollectionDetails({
  canUploadSlip,
  collections,
  paymentDateDefault,
  selectedMonth,
  selectedProperty,
}: {
  canUploadSlip: boolean;
  collections: RentCollectionRow[];
  paymentDateDefault: string;
  selectedMonth: string;
  selectedProperty: string;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-[#0b1733]">Outstanding Room Details</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tenant rooms remain here while rent or deposit is still outstanding.
        </p>
      </div>

      {collections.length ? (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-[#d8dee8] bg-white lg:block">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="border-b border-[#d8dee8] bg-[#f8fafc] text-xs uppercase text-[#60708a]">
                <tr>
                  <th className="px-3 py-3">Property</th>
                  <th className="px-3 py-3">Room / Tenant</th>
                  <th className="px-3 py-3 text-right">Previous outstanding</th>
                  <th className="px-3 py-3 text-right">Current due</th>
                  <th className="px-3 py-3 text-right">Rent / deposit outstanding</th>
                  <th className="px-3 py-3">Due / Payment date</th>
                  <th className="px-3 py-3">Payment status</th>
                  {canUploadSlip ? <th className="px-3 py-3">Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {collections.map((collection) => (
                  <tr key={collection.billId} className="border-b border-[#e4e9f0] align-top last:border-b-0">
                    <td className="px-3 py-4 font-medium">{collection.propertyName}</td>
                    <td className="px-3 py-4">
                      <Link
                        href={`/properties/${collection.propertyId}/rooms/${collection.roomId}`}
                        className="font-semibold text-[#0b1733] hover:text-[#9a6b12] hover:underline"
                      >
                        {compactRoomLabel(collection.roomNumber)}
                      </Link>
                      <p className="mt-1 max-w-48 text-xs text-muted-foreground">{collection.tenantName}</p>
                    </td>
                    <td className="px-3 py-4 text-right">{money(collection.previousOutstanding)}</td>
                    <td className="px-3 py-4 text-right">{money(collection.currentAmountDue)}</td>
                    <td className="px-3 py-4 text-right font-semibold text-red-700">
                      {money(collection.outstanding)}
                      {collection.depositOutstanding > 0 ? (
                        <span className="mt-1 block text-xs font-normal text-amber-700">
                          Deposit owing: {money(collection.depositOutstanding)}
                        </span>
                      ) : null}
                      {collection.previousOutstanding > 0 || collection.depositOutstanding > 0 ? (
                        <span className="mt-1 block text-xs font-normal text-muted-foreground">
                          Total: {money(collection.totalOutstanding)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-4">
                      <p>{dateLabel(collection.dueDate)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Paid: {dateLabel(collection.latestPaymentDate)}
                      </p>
                    </td>
                    <td className="px-3 py-4">
                      {collection.settlementStatus === "paid" && collection.depositOutstanding > 0 ? (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                          Deposit Outstanding
                        </span>
                      ) : (
                        <CollectionBadge status={collection.paymentStatus} />
                      )}
                    </td>
                    {canUploadSlip ? (
                      <td className="px-3 py-4">
                        {collection.outstanding > 0 ? (
                          <AdminPaymentSlipUpload
                            billId={collection.billId}
                            rentOutstanding={collection.outstanding}
                            depositOutstanding={collection.depositOutstanding}
                            outstandingLabel={money(collection.outstanding + collection.depositOutstanding)}
                            paymentDateDefault={paymentDateDefault}
                            propertyName={collection.propertyName}
                            roomName={compactRoomLabel(collection.roomNumber)}
                            selectedMonth={selectedMonth}
                            selectedProperty={selectedProperty}
                            tenantName={collection.tenantName}
                          />
                        ) : collection.depositOutstanding > 0 ? (
                          <AdminPaymentSlipUpload
                            billId={collection.billId}
                            rentOutstanding={0}
                            depositOutstanding={collection.depositOutstanding}
                            outstandingLabel={money(collection.depositOutstanding)}
                            paymentDateDefault={paymentDateDefault}
                            propertyName={collection.propertyName}
                            roomName={compactRoomLabel(collection.roomNumber)}
                            selectedMonth={selectedMonth}
                            selectedProperty={selectedProperty}
                            tenantName={collection.tenantName}
                          />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 lg:hidden">
            {collections.map((collection) => (
              <div key={collection.billId} className="rounded-lg border border-[#d8dee8] bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">{collection.propertyName}</p>
                    <Link
                      href={`/properties/${collection.propertyId}/rooms/${collection.roomId}`}
                      className="mt-1 block font-semibold text-[#0b1733]"
                    >
                      {compactRoomLabel(collection.roomNumber)} - {collection.tenantName}
                    </Link>
                  </div>
                  <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <p><span className="block text-xs text-muted-foreground">Current due</span>{money(collection.currentAmountDue)}</p>
                  <p><span className="block text-xs text-muted-foreground">Previous balance</span>{money(collection.previousOutstanding)}</p>
                  <p><span className="block text-xs text-muted-foreground">Current outstanding</span><span className="font-semibold text-red-700">{money(collection.outstanding)}</span></p>
                  <p><span className="block text-xs text-muted-foreground">Deposit owing</span><span className="font-semibold text-amber-700">{money(collection.depositOutstanding)}</span></p>
                  <p><span className="block text-xs text-muted-foreground">Total payable</span><span className="font-semibold text-red-700">{money(collection.totalOutstanding)}</span></p>
                  <p><span className="block text-xs text-muted-foreground">Due date</span>{dateLabel(collection.dueDate)}</p>
                  <p><span className="block text-xs text-muted-foreground">Latest payment</span>{dateLabel(collection.latestPaymentDate)}</p>
                </div>
                <div className="mt-4">
                  {collection.settlementStatus === "paid" && collection.depositOutstanding > 0 ? (
                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                      Deposit Outstanding
                    </span>
                  ) : (
                    <CollectionBadge status={collection.paymentStatus} />
                  )}
                </div>
                {canUploadSlip ? (
                  <div className="mt-4">
                    {collection.outstanding > 0 ? (
                      <AdminPaymentSlipUpload
                        billId={collection.billId}
                        rentOutstanding={collection.outstanding}
                        depositOutstanding={collection.depositOutstanding}
                        outstandingLabel={money(collection.outstanding + collection.depositOutstanding)}
                        paymentDateDefault={paymentDateDefault}
                        propertyName={collection.propertyName}
                        roomName={compactRoomLabel(collection.roomNumber)}
                        selectedMonth={selectedMonth}
                        selectedProperty={selectedProperty}
                        tenantName={collection.tenantName}
                      />
                    ) : collection.depositOutstanding > 0 ? (
                      <AdminPaymentSlipUpload
                        billId={collection.billId}
                        rentOutstanding={0}
                        depositOutstanding={collection.depositOutstanding}
                        outstandingLabel={money(collection.depositOutstanding)}
                        paymentDateDefault={paymentDateDefault}
                        propertyName={collection.propertyName}
                        roomName={compactRoomLabel(collection.roomNumber)}
                        selectedMonth={selectedMonth}
                        selectedProperty={selectedProperty}
                        tenantName={collection.tenantName}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-[#cfd7e3] py-12 text-center">
          <CircleCheckBig className="mx-auto size-7 text-emerald-600" />
          <p className="mt-3 font-medium text-[#0b1733]">No unpaid tenant rooms for this month</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Change the billing month or property filter to view another collection period.
          </p>
        </div>
      )}
    </section>
  );
}

export default async function RentDueTrackerPage({ searchParams }: PageProps) {
  const role = await requireRole(["super_admin", "owner", "admin"]);
  const canUploadSlip = role === "super_admin" || role === "admin";
  const managementView = role === "admin";
  const params = await searchParams;
  const tracker = await getRentDueMap(
    managementView ? undefined : params.month,
  );
  const today = malaysiaToday();
  const roleProperties = managementView
    ? tracker.properties
        .map((property) => ({
          ...property,
          collections: property.collections.filter(
            (collection) =>
              collection.depositOutstanding > 0
              || (
                collection.outstanding > 0
                && collection.dueDate < today
              ),
          ),
          rooms: property.rooms.filter(
            (room) =>
              room.depositOutstanding > 0
              || (
                room.outstanding > 0
                && Boolean(room.dueDate)
                && String(room.dueDate) < today
              ),
          ),
        }))
        .filter(
          (property) =>
            property.collections.length > 0 || property.rooms.length > 0,
        )
    : tracker.properties;
  const requestedProperty = params.property ?? "";
  const selectedProperty = roleProperties.some(
    (property) => property.id === requestedProperty,
  )
    ? requestedProperty
    : "";
  const visibleProperties = selectedProperty
    ? roleProperties.filter((property) => property.id === selectedProperty)
    : roleProperties;
  const visibleCollections = visibleProperties.flatMap(
    (property) => property.collections,
  );
  const outstandingCollections = visibleCollections.filter(
    (collection) =>
      collection.totalOutstanding > 0
      && collection.paymentStatus !== "pending_verification"
      && (
        collection.settlementStatus !== "paid"
        || collection.depositOutstanding > 0
      ),
  );
  const propertiesWithUnpaidRooms = visibleProperties
    .map((property) => ({
      ...property,
      rooms: property.rooms.filter(
        (room) =>
          Boolean(room.tenantName)
          && Boolean(room.billId)
          && room.outstanding > 0
          && room.paymentStatus !== "pending_verification"
          && (room.status === "unpaid" || room.status === "partially_paid"),
      ),
    }))
    .filter((property) => property.rooms.length > 0);
  const visibleSummary = summarizeRentCollections(visibleCollections);
  const visibleOccupiedRooms = visibleProperties.reduce(
    (total, property) =>
      total + property.rooms.filter((room) => Boolean(room.tenantName)).length,
    0,
  );
  const pendingVerification = visibleCollections.filter(
    (collection) => collection.paymentStatus === "pending_verification",
  ).length;

  return (
    <section className="space-y-8">
      <header className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-[#b37b14]">Rental Collection</p>
          <h1 className="mt-1 text-3xl font-semibold text-[#0b1733]">Rent Due Tracker</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {managementView
              ? `Current-month overdue rent and outstanding deposits for ${tracker.selectedMonthLabel}.`
              : `Monthly collection, verified payments and room status for ${tracker.selectedMonthLabel}.`}
          </p>
        </div>

        <form
          className="grid w-full gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:w-auto"
          action="/rent-due-tracker"
        >
          {managementView ? (
            <input name="month" type="hidden" value={tracker.currentMonth} />
          ) : (
            <div className="min-w-0 sm:w-64">
              <label className="mb-1.5 block text-sm font-medium" htmlFor="month">
                Billing month
              </label>
              <input
                id="month"
                name="month"
                type="month"
                max={tracker.currentMonth}
                defaultValue={tracker.selectedMonth}
                className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
              />
            </div>
          )}
          <div className="min-w-0 sm:w-72">
            <label className="mb-1.5 block text-sm font-medium" htmlFor="property">
              Property
            </label>
            <select
              id="property"
              name="property"
              defaultValue={selectedProperty}
              className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
            >
              <option value="">All Properties</option>
              {roleProperties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="outline">
            View
          </Button>
        </form>
      </header>

      {params.uploaded === "1" ? (
        <PaymentFlashNotice
          kind="success"
          message="Payment slip submitted. The room is hidden from this outstanding list while verification is pending. If the verified payment is partial, the room will return with its remaining balance."
        />
      ) : null}
      {params.error ? (
        <PaymentFlashNotice
          kind="error"
          message={
            uploadErrorMessages[params.error]
            ?? "The payment slip could not be submitted."
          }
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <SummaryCard
          icon={<ReceiptText className="size-5" />}
          label="Total Rent Due"
          value={money(visibleSummary.totalRentDue)}
          detail={`${visibleOccupiedRooms} occupied room${visibleOccupiedRooms === 1 ? "" : "s"}`}
        />
        <SummaryCard
          icon={<Banknote className="size-5" />}
          label="Total Paid"
          value={money(visibleSummary.totalPaid)}
          detail="Verified payments only"
        />
        <SummaryCard
          icon={<CircleDollarSign className="size-5" />}
          label="Total Outstanding"
          value={money(visibleSummary.totalOutstanding)}
          detail="Selected month balance"
        />
        <SummaryCard
          icon={<CircleCheckBig className="size-5" />}
          label="Fully Paid"
          value={String(visibleSummary.fullyPaid)}
          detail="Current bill settled"
        />
        <SummaryCard
          icon={<CircleEllipsis className="size-5" />}
          label="Partially Paid"
          value={String(visibleSummary.partiallyPaid)}
          detail="Verified balance received"
        />
        <SummaryCard
          icon={<TriangleAlert className="size-5" />}
          label="Unpaid"
          value={String(visibleSummary.unpaid)}
          detail={`${pendingVerification} pending verification`}
        />
      </div>

      <p className="rounded-md border border-[#ead9af] bg-[#fffaf0] px-4 py-3 text-sm text-[#6f5317]">
        Monthly totals do not include earlier balances. Previous outstanding amounts remain visible separately for each tenant.
      </p>

      <PropertySummaryTable properties={visibleProperties} />

      <section className="space-y-5">
        <div>
          <h2 className="text-xl font-semibold text-[#0b1733]">Rooms Still Unpaid</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Only occupied rooms with a tenant and an outstanding bill for {tracker.selectedMonthLabel} are shown.
            Paid rooms disappear automatically.
          </p>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-2 border-y border-[#d8dee8] py-3 text-xs font-medium text-[#42516a]">
          <span className="inline-flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-gray-300" />
            Not due yet
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-yellow-400" />
            Due today
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-orange-500" />
            1-6 days overdue
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-red-500" />
            7+ days overdue
          </span>
        </div>

        {propertiesWithUnpaidRooms.length ? (
          <div className="space-y-8">
            {propertiesWithUnpaidRooms.map((property) => (
              <section key={property.id} className="space-y-4">
                <div className="flex flex-col gap-3 border-b border-[#d8dee8] pb-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Building2 className="size-5 text-[#b37b14]" />
                      <h3 className="text-xl font-semibold text-[#0b1733]">{property.name}</h3>
                    </div>
                    {property.area ? (
                      <p className="mt-1 text-sm text-muted-foreground">{property.area}</p>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {property.rooms.length} outstanding room{property.rooms.length === 1 ? "" : "s"} | Rent + deposit{" "}
                    <span className="font-semibold text-red-700">
                      {money(property.rooms.reduce((total, room) => total + room.outstanding, 0))}
                    </span>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8">
                  {property.rooms.map((room) => (
                    <RoomCard key={room.id} room={room} today={today} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-[#cfd7e3] py-16 text-center">
            <CircleCheckBig className="mx-auto size-8 text-emerald-600" />
            <p className="mt-3 font-medium text-[#0b1733]">
              All occupied rooms are paid for {tracker.selectedMonthLabel}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Vacant rooms and rooms without a current bill are hidden.
            </p>
          </div>
        )}
      </section>

      <CollectionDetails
        canUploadSlip={canUploadSlip}
        collections={outstandingCollections}
        paymentDateDefault={today}
        selectedMonth={tracker.selectedMonth}
        selectedProperty={selectedProperty}
      />
    </section>
  );
}
