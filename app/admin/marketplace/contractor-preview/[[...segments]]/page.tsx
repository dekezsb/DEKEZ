import { notFound, redirect } from "next/navigation";
import { ContractorPortal } from "@/components/marketplace/contractor-portal";
import { requireRole } from "@/lib/auth/session";
import { contractorPreviewPath, contractorSection } from "@/lib/marketplace/portal";

export default async function ContractorPreview({ params }: { params: Promise<{ segments?: string[] }> }) {
  await requireRole(["super_admin"]);
  const { segments = [] } = await params;
  if (!segments.length) redirect(`${contractorPreviewPath}/dashboard`);
  const section = contractorSection(segments.join("/"));
  if (!section) notFound();
  return <ContractorPortal section={section} />;
}
