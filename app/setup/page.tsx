import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { getFirstCompany, getCurrentUser } from "@/lib/data/organization";
import { createOwnerSetup } from "./actions";

type SetupPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  missing: "Please fill in the required setup fields.",
  company: "Company could not be saved. Please check that the database schema is installed.",
  membership: "Owner access could not be linked to the company.",
  property: "Property could not be saved.",
  room: "Room could not be saved.",
};

export default async function SetupPage({ searchParams }: SetupPageProps) {
  await requireRole(["owner", "super_admin"]);
  const user = await getCurrentUser();
  const company = await getFirstCompany();
  const { error } = await searchParams;

  if (company) {
    return (
      <section className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Company setup already exists</CardTitle>
            <CardDescription>
              Your account is connected to {company.name}. You can continue to the dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/dashboard">Open dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">
          Owner Setup
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          Set up your rental business
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          Create your first company, property and room. You can add more later.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600">
          {errorMessages[error] ?? "Setup failed. Please try again."}
        </div>
      ) : null}

      <form action={createOwnerSetup} className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Company</CardTitle>
            <CardDescription>Your main business profile.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Company name</span>
              <input
                className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                name="companyName"
                defaultValue={user?.user_metadata?.business_name ?? ""}
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Company email</span>
              <input
                className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                name="companyEmail"
                type="email"
                defaultValue={user?.email ?? ""}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Phone number</span>
              <input
                className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                name="companyPhone"
                defaultValue={user?.user_metadata?.phone ?? ""}
              />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>First Property</CardTitle>
            <CardDescription>The first place you manage.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Property name</span>
              <input
                className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                name="propertyName"
                placeholder="Main House"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Address/location</span>
              <textarea
                className="mt-2 min-h-24 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                name="propertyAddress"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Notes optional</span>
              <textarea
                className="mt-2 min-h-20 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                name="propertyNotes"
              />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>First Room</CardTitle>
            <CardDescription>Add one vacant room to begin.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Room name/number</span>
              <input
                className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                name="firstRoomName"
                placeholder="Room 101"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Monthly rent RM</span>
              <input
                className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                name="monthlyRent"
                type="number"
                min="0"
                step="0.01"
                defaultValue="0"
              />
            </label>
            <Button className="w-full" type="submit">
              Save setup
            </Button>
          </CardContent>
        </Card>
      </form>
    </section>
  );
}
