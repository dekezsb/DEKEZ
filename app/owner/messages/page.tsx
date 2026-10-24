import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { ChatEntry } from "@/components/chat/entry";

export const dynamic = "force-dynamic";
export default async function OwnerMessages() {
  await requireRole(["client_owner"]);
  // Focused Messages view in the existing Owner portal; no financial snapshot fetch.
  return <main className="min-h-dvh w-full bg-[#f7f3eb] px-3 py-5 sm:px-6 lg:px-8">
    <Link className="mb-4 inline-flex min-h-11 items-center font-semibold text-[#805c1e]" href="/owner/home">← Back to Owner Portal</Link>
    <ChatEntry/>
  </main>;
}
