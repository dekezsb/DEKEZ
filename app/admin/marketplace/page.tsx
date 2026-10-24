import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { contractorPreviewPath } from "@/lib/marketplace/portal";

export default async function MarketplacePage() {
  await requireRole(["super_admin"]);
  return <section className="space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-widest text-[#9d772e]">DEKEZ HOME SERVICES</p><h1 className="mt-2 text-3xl font-semibold">Services Marketplace</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-gray-600">Marketplace foundation inside your existing management portal. Rental management, accounting and existing Owner access are unchanged.</p></div>
    <Card><CardHeader><CardTitle>Contractor Portal foundation</CardTitle><CardDescription>Explore the responsive navigation, dashboard structure and setup states. No live jobs, profiles, subscriptions or payments are connected.</CardDescription></CardHeader><CardContent className="space-y-4"><Button asChild size="lg"><Link href={`${contractorPreviewPath}/dashboard`}>Open Contractor Portal preview<ArrowRight size={18} aria-hidden /></Link></Button><p className="flex items-start gap-2 text-sm text-gray-600"><ShieldCheck className="shrink-0" size={18} aria-hidden />This preview requires your existing Super Admin session. It does not create the temporary Contractor login account.</p></CardContent></Card>
    <Button asChild variant="outline"><Link href="/admin/marketplace/test-login">Create restricted test login</Link></Button>
    {process.env.DEKEZ_CHAT_ENABLED === "true" ? <Button asChild variant="outline"><Link href="/admin/marketplace/support">Support Cases</Link></Button> : null}
    {process.env.DEKEZ_CHAT_ENABLED === "true" ? <Button asChild variant="outline"><Link href="/admin/marketplace/chat-access">Chat account / job access</Link></Button> : null}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[
      ["Owner Job Requests", "Job posting and Admin moderation will connect here in Phase 2."],
      ["Contractor Verification", "Document requirements and approval history will remain separate from membership."],
      ["Matching & Quotations", "Eligible invitation batches, controlled quotation capacity and selection will follow."],
      ["Active Jobs & Reviews", "Progress, owner completion and independent reviews will be linked to real jobs."],
      ["Subscriptions", "Billing is not configured. No memberships are activated or fees collected."],
      ["Reports & Settings", "Marketplace reports and controls will be added without changing rental financial reports."],
    ].map(([title, detail]) => <Card key={title}><CardHeader><CardTitle className="text-base">{title}</CardTitle><CardDescription>{detail}</CardDescription></CardHeader></Card>)}</div>
  </section>;
}
