import { CheckCircle2, Clock, FileUp, Home, ReceiptText, UserRoundCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { money } from "@/lib/e-tenancy";
import { statusBadgeClass } from "@/lib/status-styles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { submitCheckInPayment, submitTenantApplication } from "./actions";

type PageProps = {
  searchParams: Promise<{
    submitted?: string;
    payment?: string;
    error?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  missing: "Please fill in your name, property, room and contract duration.",
  document: "Please upload IC front or passport photo page.",
  room: "That room is no longer available. Please choose another room.",
  create: "Application could not be submitted.",
  upload: "Document upload failed.",
  payment_missing: "Please enter payment details and upload a receipt.",
  payment_upload: "Payment receipt upload failed.",
  payment_create: "Payment submission could not be saved.",
};

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

export default async function OnboardingPage({ searchParams }: PageProps) {
  await requireRole(["tenant"]);
  const user = await getCurrentUser();
  const params = await searchParams;
  const supabase = await getAdmin();

  const [propertiesResult, unitsResult, roomsResult, applicationsResult] = await Promise.all([
    supabase
      .from("properties")
      .select("id, name, address, contract_duration_options")
      .order("name", { ascending: true }),
    supabase
      .from("units")
      .select("id, property_id, name")
      .order("name", { ascending: true }),
    supabase
      .from("rooms")
      .select("id, property_id, unit_id, name, room_number, status, monthly_rent")
      .neq("status", "occupied")
      .order("name", { ascending: true }),
    supabase
      .from("tenant_applications")
      .select("id, property_id, unit_id, room_id, full_name, verification_status, payment_status, status, monthly_rent, deposit, utility_deposit, contract_duration_months, proposed_start_date, proposed_end_date, created_at, properties(name), rooms(name, room_number)")
      .eq("tenant_id", user?.id ?? "")
      .order("created_at", { ascending: false }),
  ]);

  const properties = propertiesResult.data ?? [];
  const units = unitsResult.data ?? [];
  const rooms = roomsResult.data ?? [];
  const applications = applicationsResult.data ?? [];
  const latestApplication = applications[0];
  const latestProperty = Array.isArray(latestApplication?.properties) ? latestApplication?.properties[0] : latestApplication?.properties;
  const latestRoom = Array.isArray(latestApplication?.rooms) ? latestApplication?.rooms[0] : latestApplication?.rooms;

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Tenant Onboarding</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Tenant Application</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          Submit your details, choose an available room, then upload your check-in payment proof after Admin review.
        </p>
      </div>

      {params.submitted === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Application submitted. Admin will verify your profile and documents.
        </div>
      ) : null}
      {params.payment === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Payment proof submitted. Status is pending Admin verification.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {errorMessages[params.error] ?? "Unable to save onboarding item."}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <ChecklistItem title="Personal Details" status={latestApplication ? "Completed" : "Not started"} icon={UserRoundCheck} complete={Boolean(latestApplication)} />
        <ChecklistItem title="IC / Passport Upload" status={latestApplication ? "Uploaded" : "Required"} icon={FileUp} complete={Boolean(latestApplication)} />
        <ChecklistItem title="Profile Verification" status={latestApplication?.verification_status ?? "incomplete"} icon={Clock} complete={latestApplication?.verification_status === "verified"} />
        <ChecklistItem title="Property & Room" status={latestApplication ? "Selected" : "Required"} icon={Home} complete={Boolean(latestApplication)} />
        <ChecklistItem title="Check-In Payment" status={latestApplication?.payment_status ?? "unpaid"} icon={ReceiptText} complete={latestApplication?.payment_status === "verified"} />
        <ChecklistItem title="Tenancy Agreement" status={latestApplication?.status === "converted_to_tenancy" ? "Ready to sign" : "Waiting for approval"} icon={CheckCircle2} complete={latestApplication?.status === "converted_to_tenancy"} />
      </div>

      {latestApplication ? (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Latest Application</CardTitle>
                <CardDescription>
                  {latestProperty?.name ?? "Property"} - {latestRoom?.room_number ?? latestRoom?.name ?? "Room"}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className={statusBadgeClass(latestApplication.verification_status)}>{latestApplication.verification_status}</Badge>
                <Badge className={statusBadgeClass(latestApplication.payment_status)}>{latestApplication.payment_status}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-gray-600 sm:grid-cols-2 lg:grid-cols-4">
            <p>Monthly rent: {money(latestApplication.monthly_rent)}</p>
            <p>Deposit: {money(latestApplication.deposit)}</p>
            <p>Duration: {latestApplication.contract_duration_months} months</p>
            <p>Start: {latestApplication.proposed_start_date ?? "-"}</p>
            <p>End: {latestApplication.proposed_end_date ?? "-"}</p>
            <p>Status: {latestApplication.status}</p>
          </CardContent>
        </Card>
      ) : null}

      {!latestApplication || ["rejected", "more_information_required"].includes(latestApplication.verification_status) ? (
        <Card>
          <CardHeader>
            <CardTitle>Submit Tenant Application</CardTitle>
            <CardDescription>Rooms shown here are not occupied. Admin still makes the final approval.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={submitTenantApplication} className="grid gap-4 lg:grid-cols-3">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Full name</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="fullName" defaultValue={user?.user_metadata?.full_name ?? ""} required />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">IC / Passport number</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="icPassportNumber" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Nationality</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="nationality" defaultValue="Malaysia" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Date of birth</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="dateOfBirth" type="date" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">WhatsApp number</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="whatsappNumber" defaultValue={user?.phone ?? ""} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Emergency contact name</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="emergencyContactName" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Emergency contact number</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="emergencyContactNumber" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Property</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="propertyId" required>
                  <option value="">Choose property</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>{property.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Unit optional</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="unitId">
                  <option value="">Choose unit if needed</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>{unit.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Available room</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="roomId" required>
                  <option value="">Choose room</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.room_number ?? room.name} - {money(room.monthly_rent)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Contract duration</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="contractDurationMonths" defaultValue="12">
                  <option value="6">6 months</option>
                  <option value="12">12 months</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Start date</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="proposedStartDate" type="date" required />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Monthly rent RM</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="monthlyRent" type="number" min="0" step="0.01" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Deposit RM</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="deposit" type="number" min="0" step="0.01" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Utility deposit RM</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="utilityDeposit" type="number" min="0" step="0.01" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">IC front</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="icFront" type="file" accept="image/*,.pdf" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">IC back</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="icBack" type="file" accept="image/*,.pdf" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Passport photo page</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="passportPhoto" type="file" accept="image/*,.pdf" />
              </label>
              <Button className="lg:col-span-3" type="submit">Submit application</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {latestApplication && latestApplication.verification_status === "verified" && latestApplication.payment_status !== "verified" ? (
        <Card>
          <CardHeader>
            <CardTitle>Upload Check-In Payment Proof</CardTitle>
            <CardDescription>Admin must verify the receipt before the tenancy agreement is generated.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={submitCheckInPayment} className="grid gap-4 lg:grid-cols-3">
              <input name="applicationId" type="hidden" value={latestApplication.id} />
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Payment type</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="paymentType" defaultValue="rental_deposit">
                  <option value="rental_deposit">Rental deposit</option>
                  <option value="utility_deposit">Utility deposit</option>
                  <option value="first_month_rental">First month rental</option>
                  <option value="access_card_deposit">Access card deposit</option>
                  <option value="other_check_in_charges">Other check-in charges</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Amount RM</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="amount" type="number" min="0" step="0.01" required />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Payment date</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="paymentDate" type="date" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Method</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="paymentMethod" defaultValue="bank_transfer">
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="duitnow">DuitNow QR</option>
                  <option value="online_payment">Online payment</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Reference number</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="referenceNumber" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Receipt image/PDF</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="receipt" type="file" accept="image/*,.pdf" required />
              </label>
              <Button className="lg:col-span-3" type="submit">Submit payment proof</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}

function ChecklistItem({
  title,
  status,
  icon: Icon,
  complete,
}: {
  title: string;
  status: string;
  icon: typeof CheckCircle2;
  complete: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <Icon className={complete ? "h-5 w-5 text-[#126b5f]" : "h-5 w-5 text-gray-400"} />
          <Badge className={complete ? statusBadgeClass("verified") : statusBadgeClass(status)}>{status}</Badge>
        </div>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
    </Card>
  );
}
