import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { ChatAccessSetup } from "@/components/chat/access-setup";
export const dynamic="force-dynamic";
export default async function ChatAccessPage(){
  await requireRole(["super_admin"]);
  return <section className="space-y-4"><Link href="/admin/marketplace">← Services Marketplace</Link>{process.env.DEKEZ_CHAT_ENABLED==="true"?<ChatAccessSetup/>:<p>Chat access setup is disabled pending testing and deployment approval.</p>}</section>;
}
