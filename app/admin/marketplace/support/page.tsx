import Link from "next/link";
import { getCurrentUserAccess, requireRole } from "@/lib/auth/session";
import { ChatSupport } from "@/components/chat/support";

export const dynamic = "force-dynamic";
export default async function SupportCases() {
  await requireRole(["super_admin", "admin", "technician", "maintenance_staff", "cleaning_staff"]);
  const { user } = await getCurrentUserAccess();
  return <section className="space-y-4">
    <Link href="/admin/marketplace" className="inline-flex min-h-11 items-center">← Services Marketplace</Link>
    {process.env.DEKEZ_CHAT_ENABLED === "true" ? <ChatSupport key={user.id} userId={user.id} realtimeEnabled={process.env.DEKEZ_CHAT_REALTIME_ENABLED === "true"}/> : <p>Support Cases is awaiting secure setup and testing. No private conversations are available here.</p>}
  </section>;
}
