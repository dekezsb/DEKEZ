import { Link } from "@/components/app-link";
import { FileSignature, Send } from "lucide-react";
import { sendAgreementWhatsApp } from "@/app/verification/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AgreementReminder } from "@/lib/data/agreement-renewals";
import { formatMalaysiaDate } from "@/lib/date-format";
import { statusBadgeClass } from "@/lib/status-styles";

export function AgreementRenewalReminders({
  reminders,
}: {
  reminders: AgreementReminder[];
}) {
  if (!reminders.length) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileSignature className="h-5 w-5 text-[#b98a2c]" />
              Agreements To Send
            </CardTitle>
            <CardDescription>
              Unsigned original terms and renewals waiting for WhatsApp delivery.
            </CardDescription>
          </div>
          <Badge>{reminders.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {reminders.slice(0, 12).map((reminder) => (
          <div
            className="grid gap-3 border-b border-[#e3e8ef] pb-3 last:border-0 last:pb-0 md:grid-cols-[1fr_auto]"
            key={reminder.id}
          >
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-[#07142f]">
                  {reminder.tenantName}
                </p>
                <Badge className={statusBadgeClass(reminder.status)}>
                  {reminder.status.replaceAll("_", " ")}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-[#496386]">
                {reminder.propertyName} - {reminder.roomName}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {reminder.termType === "renewal" ? "Renewal" : "Original"}{" "}
                term: {formatMalaysiaDate(reminder.termStartDate)} to{" "}
                {formatMalaysiaDate(reminder.termEndDate)} -{" "}
                {reminder.isCommercial
                  ? "12-month commercial cycle"
                  : "6-month non-commercial cycle"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={`/e-tenancy/${reminder.id}`}>View</Link>
              </Button>
              <form action={sendAgreementWhatsApp}>
                <input name="agreementId" type="hidden" value={reminder.id} />
                <Button size="sm" type="submit">
                  <Send className="h-4 w-4" />
                  {reminder.status === "renewal_sent" ? "Resend" : "Send"} WhatsApp
                </Button>
              </form>
            </div>
          </div>
        ))}

        {reminders.length > 12 ? (
          <Button asChild className="w-full" variant="outline">
            <Link href="/verification?view=tenancy">
              View all {reminders.length} agreements
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
