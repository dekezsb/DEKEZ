import { Building2, CreditCard, Home, Users, Wrench, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

function countBy<T extends Record<string, unknown>>(items: T[], key: keyof T) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = String(item[key] ?? "not set");
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function formatBreakdown(counts: Record<string, number>) {
  const entries = Object.entries(counts);

  if (!entries.length) {
    return "No records yet";
  }

  return entries.map(([label, count]) => `${label.replaceAll("_", " ")}: ${count}`).join(", ");
}

export default async function SettingsPage() {
  await requireRole(["super_admin", "owner"]);
  const supabase = await createClient();
  const [
    companiesResult,
    organizationsResult,
    profilesResult,
    roomsResult,
    paymentsResult,
    utilityBillsResult,
    claimsResult,
  ] = await Promise.all([
    supabase.from("companies").select("id, name, status"),
    supabase.from("organizations").select("id, name, status"),
    supabase.from("profiles").select("id, role"),
    supabase.from("rooms").select("id, status"),
    supabase.from("payments").select("id, category, payment_method, status"),
    supabase.from("utility_bills").select("id, utility_type, status"),
    supabase.from("claims").select("id, status"),
  ]);

  const companies = companiesResult.data ?? [];
  const organizations = organizationsResult.data ?? [];
  const profiles = profilesResult.data ?? [];
  const rooms = roomsResult.data ?? [];
  const payments = paymentsResult.data ?? [];
  const utilityBills = utilityBillsResult.data ?? [];
  const claims = claimsResult.data ?? [];
  const activeCompanyNames = [...companies, ...organizations]
    .map((company) => company.name)
    .filter(Boolean)
    .join(", ");

  const cards = [
    {
      title: "Company Setup",
      icon: Building2,
      value: String(companies.length + organizations.length),
      description: activeCompanyNames || "No company profile found yet",
      footer: formatBreakdown(countBy([...companies, ...organizations], "status")),
    },
    {
      title: "User Roles",
      icon: Users,
      value: String(profiles.length),
      description: "Accounts currently saved in Supabase profiles",
      footer: formatBreakdown(countBy(profiles, "role")),
    },
    {
      title: "Room Statuses",
      icon: Home,
      value: String(rooms.length),
      description: "Rooms created for your rental operation",
      footer: formatBreakdown(countBy(rooms, "status")),
    },
    {
      title: "Payment Setup",
      icon: CreditCard,
      value: String(payments.length),
      description: "Collections recorded in the system",
      footer: formatBreakdown(countBy(payments, "category")),
    },
    {
      title: "Utility Bills",
      icon: Zap,
      value: String(utilityBills.length),
      description: "Water, electricity, internet and other bills",
      footer: formatBreakdown(countBy(utilityBills, "utility_type")),
    },
    {
      title: "Maintenance Claims",
      icon: Wrench,
      value: String(claims.length),
      description: "Claim records submitted by maintenance users",
      footer: formatBreakdown(countBy(claims, "status")),
    },
  ];

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Configuration</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Settings</h1>
        <p className="mt-2 text-sm text-gray-600">
          Live setup overview from your Supabase database.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;

          return (
            <Card key={card.title}>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <Icon className="h-5 w-5 text-[#126b5f]" />
                  <Badge>{card.value}</Badge>
                </div>
                <CardTitle>{card.title}</CardTitle>
                <CardDescription>{card.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm capitalize text-gray-600">{card.footer}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
