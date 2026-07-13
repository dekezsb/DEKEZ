import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";

const settings = [
  "Company profile",
  "User roles",
  "Room statuses",
  "Payment categories",
  "Expense categories",
  "Notification preferences",
];

export default async function SettingsPage() {
  await requireRole(["super_admin", "owner"]);

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Configuration</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Settings</h1>
        <p className="mt-2 text-sm text-gray-600">Dummy settings cards for Phase 1.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {settings.map((setting) => (
          <Card key={setting}>
            <CardHeader>
              <CardTitle>{setting}</CardTitle>
              <CardDescription>Configuration area placeholder.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">Available in a later phase.</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
