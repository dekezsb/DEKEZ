import { requireRole } from "@/lib/auth/session";
import { ChatEntry } from "@/components/chat/entry";

export const dynamic = "force-dynamic";
export default async function Messages() {
  await requireRole(["super_admin", "admin", "owner", "tenant", "technician", "maintenance_staff", "cleaning_staff"]);
  return <ChatEntry/>;
}
