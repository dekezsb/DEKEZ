import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ room?: string }>;
};

export default async function PropertyRegisterTenantRedirect({
  params,
  searchParams,
}: PageProps) {
  await requireRole(["super_admin", "admin"]);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const target = new URLSearchParams({ property: id });
  if (query.room) {
    target.set("room", query.room);
  }
  redirect(`/register-tenant?${target.toString()}`);
}
