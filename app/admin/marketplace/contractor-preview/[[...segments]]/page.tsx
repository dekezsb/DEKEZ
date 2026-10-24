import { notFound, redirect } from "next/navigation";
import { ContractorPortal } from "@/components/marketplace/contractor-portal";
import { requireRole } from "@/lib/auth/session";
import { contractorPreviewPath, contractorSection } from "@/lib/marketplace/portal";

export default async function ContractorPreview({ params }: { params: Promise<{ segments?: string[] }> }) {
  const role = await requireRole(["super_admin", "contractor_preview"]);
  const { segments = [] } = await params;
  if (!segments.length) redirect(`${contractorPreviewPath}/dashboard`);
  const section = contractorSection(segments.join("/"));
  if (!section) notFound();
  let messageContent;
  if (section === "messages" && process.env.DEKEZ_CHAT_ENABLED === "true") {
    const { ChatEntry } = await import("@/components/chat/entry");
    messageContent = <ChatEntry/>;
  }
  return <ContractorPortal section={section} pilot={role === "contractor_preview"} messageContent={messageContent} />;
}
