import { redirect } from "next/navigation";
import { reminderManager } from "@/lib/rental-collection/authorization";
import { collectionFailurePreview } from "@/lib/rental-collection/failure-service";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { reportAdministrator } from "@/lib/management-report/authorization";
import { FailureRecipientReview } from "@/app/admin-setup/rental-reminders/failure-recipient-review";
import { FollowupReview } from "@/app/admin-setup/rental-reminders/followup-review";
import { ReminderConsentGuide } from "@/app/admin-setup/rental-reminders/consent-guide";
import { ReminderWorklist } from "./worklist";

export const dynamic = "force-dynamic";
export default async function ReminderFollowupsPage({searchParams}: {searchParams?: Promise<{queue?: string; page?: string}>} = {}) {
  if (!await reminderManager()) redirect("/dashboard?error=access_denied");
  const params = await searchParams ?? {};
  let report: Awaited<ReturnType<typeof collectionFailurePreview>> | null = null;
  try {report = await collectionFailurePreview(new Date(), true);} catch { /* No raw data/SQL errors */ }
  const mayReviewRecipient = !!await reportAdministrator();
  return <section className="space-y-5">
    <h1 className="text-2xl font-semibold">Rental payment reminder follow-ups</h1>
    <p className="text-sm text-gray-600">Authorized company review only. This page never sends messages, changes login numbers or changes financial records.</p>
    <a className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm" href="/rent-due-tracker">Rent Due Tracker</a>
    {mayReviewRecipient ? <a className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm" href="/admin-setup/rental-reminders">Admin: verify ownership / consent</a> : null}
    <ReminderConsentGuide />
    {report?.allHistoryLoaded ? <ReminderWorklist accounts={report.actionList ?? []} queue={params.queue} page={params.page} /> : null}
    <Card><CardHeader><CardTitle>Senarai tindakan susulan</CardTitle></CardHeader><CardContent>
      {report?.allHistoryLoaded && report.fullPortalReport ? <details><summary className="min-h-11 cursor-pointer text-sm">Lihat laporan penuh Bahasa Melayu</summary><pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">{report.fullPortalReport}</pre></details>
        : <p role="status" className="text-sm text-amber-900">Senarai penuh belum tersedia. Semak konfigurasi dan cuba semula; tiada mesej dihantar dan tiada kes dianggap selesai.</p>}
    </CardContent></Card>
    {report ? <Card><CardHeader><CardTitle>Rosley · satu laporan WhatsApp harian · pratonton sahaja</CardTitle></CardHeader><CardContent>
      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">{report.body}</pre>
      <p className="mt-3 text-xs text-gray-600">No report is sent from this page. Previously reserved or uncertain reports cannot send again on the same Malaysia date.</p>
    </CardContent></Card> : null}
    {mayReviewRecipient ? <FailureRecipientReview profile={report?.recipientAuthorization?.management_profile_id ?? null} /> : null}
    {mayReviewRecipient && report ? <FollowupReview attempts={report.reviewableAttempts} /> : null}
  </section>;
}
