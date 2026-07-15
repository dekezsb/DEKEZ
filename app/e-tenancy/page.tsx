import Link from "next/link";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { getProperties } from "@/lib/data/organization";
import { defaultAgreementTemplate } from "@/lib/e-tenancy";
import { statusBadgeClass } from "@/lib/status-styles";
import { createClient } from "@/lib/supabase/server";
import { createAgreementTemplate, generateAgreement, refreshAgreementExpiry } from "./actions";

type PageProps = {
  searchParams: Promise<{
    created?: string;
    error?: string;
  }>;
};

const successMessages: Record<string, string> = {
  template: "TA template saved successfully.",
  agreement: "Tenancy agreement generated and sent for tenant signature.",
  expiry: "Agreement expiry statuses refreshed.",
};

const errorMessages: Record<string, string> = {
  template_missing: "Please choose property and enter template name.",
  template_create: "TA template could not be saved.",
  agreement_missing: "Please choose tenancy, duration and start date.",
  agreement_create: "Tenancy agreement could not be generated.",
};

export default async function ETenancyPage({ searchParams }: PageProps) {
  const role = await requireRole(["super_admin", "owner", "admin", "tenant"]);

  if (role === "tenant") {
    return <TenantAgreementList />;
  }

  const params = await searchParams;
  const supabase = await createClient();
  const [properties, templatesResult, tenanciesResult, agreementsResult, profilesResult] = await Promise.all([
    getProperties(),
    supabase
      .from("tenancy_agreement_templates")
      .select("id, property_id, name, version, is_active, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("tenancies")
      .select("id, tenant_id, property_id, room_id, monthly_rental, contract_start, rooms(name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("tenancy_agreements")
      .select("id, tenancy_id, agreement_type, version_number, status, generated_at, signed_at, pdf_url, tenancies(tenant_id, property_id, room_id, tenancy_start_date, tenancy_end_date, contract_duration_months, properties(name), rooms(name))")
      .order("generated_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name").eq("role", "tenant"),
  ]);
  const propertyById = new Map(properties.map((property) => [property.id, property.name]));
  const profileById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.full_name ?? profile.id]));
  const templates = templatesResult.data ?? [];
  const tenancies = tenanciesResult.data ?? [];
  const agreements = agreementsResult.data ?? [];

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">E-Tenancy</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">E-Tenancy Agreements</h1>
        <p className="mt-2 text-sm text-gray-600">
          Property-specific TA templates, 6/12-month agreements, signatures and renewal status.
        </p>
      </div>

      {params.created ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          {successMessages[params.created] ?? "Saved successfully."}
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {errorMessages[params.error] ?? "Unable to save E-TA item."}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create TA Template</CardTitle>
            <CardDescription>Use placeholders like tenant_name, room_number and monthly_rent.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createAgreementTemplate} className="space-y-4">
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
                <span className="text-sm font-medium text-gray-700">Template name</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="name" defaultValue="Standard Room Tenancy Agreement" required />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Template content</span>
                <textarea className="mt-2 min-h-72 w-full rounded-md border border-[#d7dde5] px-3 py-2 font-mono text-xs" name="templateContent" defaultValue={defaultAgreementTemplate} />
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input name="isActive" type="checkbox" defaultChecked />
                Active template
              </label>
              <Button type="submit">Save template</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Generate Tenant TA</CardTitle>
            <CardDescription>Choose 6 or 12 months. End date is calculated automatically.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={generateAgreement} className="space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Tenancy</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="tenancyId" required>
                  <option value="">Choose tenancy</option>
                  {tenancies.map((tenancy) => {
                    const room = Array.isArray(tenancy.rooms) ? tenancy.rooms[0] : tenancy.rooms;
                    return (
                      <option key={tenancy.id} value={tenancy.id}>
                        {profileById.get(tenancy.tenant_id) ?? "Tenant"} - {propertyById.get(tenancy.property_id) ?? "Property"} - {room?.name ?? "Room"}
                      </option>
                    );
                  })}
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
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="startDate" type="date" required />
              </label>
              <Button type="submit">Generate agreement</Button>
            </form>

            <form action={refreshAgreementExpiry} className="mt-4">
              <Button type="submit" variant="outline">Refresh expiry status</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Admin Agreement Dashboard</CardTitle>
          <CardDescription>Signature and renewal status for all visible agreements.</CardDescription>
        </CardHeader>
        <CardContent>
          {agreements.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Room</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Signed</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agreements.map((agreement) => {
                  const tenancy = Array.isArray(agreement.tenancies) ? agreement.tenancies[0] : agreement.tenancies;
                  const property = Array.isArray(tenancy?.properties) ? tenancy?.properties[0] : tenancy?.properties;
                  const room = Array.isArray(tenancy?.rooms) ? tenancy?.rooms[0] : tenancy?.rooms;
                  return (
                    <TableRow key={agreement.id}>
                      <TableCell className="font-medium text-gray-950">{profileById.get(tenancy?.tenant_id ?? "") ?? "-"}</TableCell>
                      <TableCell>{property?.name ?? "-"}</TableCell>
                      <TableCell>{room?.name ?? "-"}</TableCell>
                      <TableCell>{tenancy?.contract_duration_months ? `${tenancy.contract_duration_months} months` : "-"}</TableCell>
                      <TableCell>{tenancy?.tenancy_start_date ?? "-"}</TableCell>
                      <TableCell>{tenancy?.tenancy_end_date ?? "-"}</TableCell>
                      <TableCell><Badge className={statusBadgeClass(agreement.status)}>{agreement.status}</Badge></TableCell>
                      <TableCell>{agreement.signed_at ? new Date(agreement.signed_at).toLocaleDateString("en-MY") : "-"}</TableCell>
                      <TableCell>
                        <Button asChild variant="outline">
                          <Link href={`/e-tenancy/${agreement.id}`}>View</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-gray-500">No agreements yet. Generate one above.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

async function TenantAgreementList() {
  const supabase = await createClient();
  const { data: agreements } = await supabase
    .from("tenancy_agreements")
    .select("id, status, signed_at, generated_at, pdf_url, tenancies(tenancy_start_date, tenancy_end_date, contract_duration_months, properties(name), rooms(name))")
    .order("generated_at", { ascending: false });

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Tenant Portal</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">My Tenancy Agreement</h1>
        <p className="mt-2 text-sm text-gray-600">View, sign and download your tenancy agreement history.</p>
      </div>
      <div className="grid gap-4">
        {(agreements ?? []).map((agreement) => {
          const tenancy = Array.isArray(agreement.tenancies) ? agreement.tenancies[0] : agreement.tenancies;
          const property = Array.isArray(tenancy?.properties) ? tenancy?.properties[0] : tenancy?.properties;
          const room = Array.isArray(tenancy?.rooms) ? tenancy?.rooms[0] : tenancy?.rooms;
          const daysRemaining = tenancy?.tenancy_end_date
            ? Math.ceil((new Date(tenancy.tenancy_end_date).getTime() - Date.now()) / 86400000)
            : null;
          return (
            <Card key={agreement.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{property?.name ?? "Tenancy Agreement"}</CardTitle>
                    <CardDescription>{room?.name ?? "Room"} - {tenancy?.contract_duration_months ?? "-"} months</CardDescription>
                  </div>
                  <Badge className={statusBadgeClass(agreement.status)}>{agreement.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm text-gray-600 sm:grid-cols-2">
                <p>Start: {tenancy?.tenancy_start_date ?? "-"}</p>
                <p>End: {tenancy?.tenancy_end_date ?? "-"}</p>
                <p>Days remaining: {daysRemaining ?? "-"}</p>
                <p>Signed: {agreement.signed_at ? new Date(agreement.signed_at).toLocaleString("en-MY") : "-"}</p>
                <Button asChild className="sm:col-span-2">
                  <Link href={`/e-tenancy/${agreement.id}`}>
                    {agreement.status === "pending_signature" ? "Review and sign" : "View agreement"}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
        {!agreements?.length ? (
          <Card>
            <CardHeader>
              <FileText className="h-5 w-5 text-[#126b5f]" />
              <CardTitle>No tenancy agreement yet</CardTitle>
              <CardDescription>Admin will generate your TA after your tenancy is ready.</CardDescription>
            </CardHeader>
          </Card>
        ) : null}
      </div>
    </section>
  );
}
