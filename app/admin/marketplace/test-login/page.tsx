import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { PreviewLoginForm } from "./form";

export default async function PreviewLoginSetup() {
  await requireRole(["super_admin"], { module: "admin_setup", level: "manage" });
  return <section className="mx-auto w-full max-w-2xl p-4 sm:p-8">
    <Link href="/admin/marketplace" className="text-sm underline">Back to Services Marketplace</Link>
    <h1 className="mt-5 text-2xl font-semibold">Create restricted Contractor test login</h1>
    <p className="mt-3 text-sm leading-6 text-gray-600">Use a new number for a read-only portal preview. This does not convert an existing user or reset an existing password. The temporary password is for preview access only; stronger authentication is required before real marketplace services are enabled.</p>
    <PreviewLoginForm />
  </section>;
}
