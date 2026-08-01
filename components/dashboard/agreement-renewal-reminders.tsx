import { Link } from "@/components/app-link";
import { CalendarClock, FileSignature, MessageCircle } from "lucide-react";
import {
  prepareConfirmedRenewal,
  recordRenewalDecision,
  resendConfirmedRenewalAgreement,
  sendRenewalDecisionRequest,
} from "@/app/dashboard/renewal-actions";
import { RenewalSubmitButton } from "@/components/dashboard/renewal-submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type {
  AgreementRenewalSummary,
  RenewalTrackerBucket,
  RenewalTrackerItem,
} from "@/lib/data/agreement-renewals";
import {
  formatMalaysiaDate,
  formatMalaysiaDateTime,
} from "@/lib/date-format";
import { statusBadgeClass } from "@/lib/status-styles";

type BucketDefinition = {
  bucket: RenewalTrackerBucket;
  shortLabel: string;
  title: string;
  tone: "normal" | "urgent" | "expired";
};

const buckets: BucketDefinition[] = [
  {
    bucket: "days_60_46",
    shortLabel: "60-46d",
    title: "46 to 60 days before expiry",
    tone: "normal",
  },
  {
    bucket: "days_45_31",
    shortLabel: "45-31d",
    title: "31 to 45 days before expiry",
    tone: "normal",
  },
  {
    bucket: "days_30_15",
    shortLabel: "30-15d",
    title: "15 to 30 days before expiry",
    tone: "urgent",
  },
  {
    bucket: "days_14_1",
    shortLabel: "14-1d",
    title: "1 to 14 days before expiry",
    tone: "urgent",
  },
  {
    bucket: "expires_today",
    shortLabel: "Today",
    title: "Contracts expiring today",
    tone: "urgent",
  },
  {
    bucket: "expired",
    shortLabel: "Expired",
    title: "Active tenancies with expired contract dates",
    tone: "expired",
  },
];

function isBucket(value: string | undefined): value is RenewalTrackerBucket {
  return buckets.some((item) => item.bucket === value);
}

function defaultBucket(summary: AgreementRenewalSummary) {
  const priority: RenewalTrackerBucket[] = [
    "expired",
    "expires_today",
    "days_14_1",
    "days_30_15",
    "days_45_31",
    "days_60_46",
  ];
  return (
    priority.find((bucket) => summary.counts[bucket] > 0) ?? "days_60_46"
  );
}

function bucketClass(definition: BucketDefinition, selected: boolean) {
  const ring = selected ? "ring-2 ring-offset-1" : "";
  if (definition.tone === "expired") {
    return `border-red-300 bg-red-50 text-red-700 ${ring} ring-red-500`;
  }
  if (definition.tone === "urgent") {
    return `border-amber-300 bg-amber-50 text-amber-800 ${ring} ring-amber-500`;
  }
  return `border-[#d7dde5] bg-[#f3f6f9] text-[#18304f] ${ring} ring-[#7689a4]`;
}

function expiryLabel(item: RenewalTrackerItem) {
  if (item.daysUntilExpiry < 0) {
    return `${Math.abs(item.daysUntilExpiry)} day(s) expired`;
  }
  if (item.daysUntilExpiry === 0) return "Expires today";
  return `${item.daysUntilExpiry} day(s) left`;
}

function decisionLabel(item: RenewalTrackerItem) {
  if (item.decisionStatus === "not_renew") return "Tenant not renewing";
  if (item.decisionStatus === "requested") return "Waiting for tenant reply";
  if (item.decisionStatus === "renew" && item.agreementId) {
    return ["signed", "renewal_signed"].includes(item.agreementStatus ?? "")
      ? "Renewal TA signed"
      : "Renewal TA signature outstanding";
  }
  if (item.decisionStatus === "renew") return "Tenant confirmed renewal";
  return "Renewal question not sent";
}

const resultMessages: Record<string, string> = {
  request_sent: "The 60-day renewal question was sent by WhatsApp and recorded.",
  send_failed:
    "WhatsApp could not send. The failed attempt was recorded; connect the WhatsApp Business API and try again.",
  missing_phone: "This tenant does not have a valid WhatsApp number.",
  renew_confirmed:
    "Tenant decision recorded: wants to renew. You may now prepare the renewal TA.",
  not_renewing:
    "Tenant decision recorded: not renewing. No renewal TA will be prepared.",
  decision_required:
    "Record the tenant's Yes decision before preparing a renewal TA.",
  rent_missing: "Enter the confirmed rent for the renewal term.",
  prepare_failed: "The renewal TA could not be prepared.",
  ta_sent: "The renewal TA was prepared and sent for signature.",
  ta_prepared_send_failed:
    "The renewal TA was prepared, but WhatsApp could not send the signing link.",
  decision_failed: "The tenant decision could not be saved.",
  date_review:
    "This old contract cycle has also expired. Review and correct the contract dates before preparing a new TA.",
  missing: "This renewal record is no longer available. Refresh and try again.",
};

export function AgreementRenewalReminders({
  selectedBucket,
  result,
  summary,
}: {
  selectedBucket?: string;
  result?: string;
  summary: AgreementRenewalSummary;
}) {
  const activeBucket = isBucket(selectedBucket)
    ? selectedBucket
    : defaultBucket(summary);
  const definition =
    buckets.find((item) => item.bucket === activeBucket) ?? buckets[0];
  const matching = summary.items.filter((item) => item.bucket === activeBucket);
  const visible = matching.slice(0, 8);
  const outstanding = summary.items.filter(
    (item) =>
      ["pending", "requested"].includes(item.decisionStatus) ||
      (item.decisionStatus === "renew" &&
        (!item.agreementId ||
          !["signed", "renewal_signed"].includes(item.agreementStatus ?? ""))),
  ).length;

  return (
    <Card
      className="mx-auto max-w-4xl rounded-lg border-[#d7dde5] shadow-sm"
      id="dashboard-renewals"
    >
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-[#07142f]">
              <CalendarClock className="h-5 w-5 text-[#b98a2c]" />
              Contract Renewal Tracker
            </h2>
            <p className="mt-1 text-sm text-[#496386]">
              Starts 60 days before contract expiry. Ask first; prepare a renewal
              TA only after the tenant confirms Yes.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/tenancy-agreements">Open all TA records</Link>
          </Button>
        </div>

        {result && resultMessages[result] ? (
          <div
            className={`mt-4 rounded-md border px-3 py-2 text-sm font-medium ${
              ["request_sent", "renew_confirmed", "not_renewing", "ta_sent"].includes(
                result,
              )
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {resultMessages[result]}
          </div>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-md border border-[#d7dde5] bg-white p-3">
            <p className="text-xs text-[#5f718c]">Need to ask</p>
            <p className="mt-1 text-2xl font-semibold text-[#07142f]">
              {summary.needReminder}
            </p>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-700">Waiting reply</p>
            <p className="mt-1 text-2xl font-semibold text-amber-900">
              {summary.waitingReply}
            </p>
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs text-emerald-700">Tenant said Yes</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-900">
              {summary.confirmedRenewal}
            </p>
          </div>
          <div className="rounded-md border border-red-200 bg-red-50 p-3">
            <p className="text-xs text-red-700">Unsigned renewal TA</p>
            <p className="mt-1 text-2xl font-semibold text-red-900">
              {summary.unsignedAgreements}
            </p>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto pb-2">
          <div className="grid min-w-[650px] grid-cols-6 gap-2">
            {buckets.map((bucket) => {
              const selected = bucket.bucket === activeBucket;
              return (
                <Link
                  aria-current={selected ? "true" : undefined}
                  aria-label={`${bucket.title}: ${summary.counts[bucket.bucket]}`}
                  className={`flex h-16 flex-col items-center justify-center rounded-md border text-center transition hover:brightness-95 ${bucketClass(bucket, selected)}`}
                  href={`/dashboard?renewalBucket=${bucket.bucket}#dashboard-renewals`}
                  key={bucket.bucket}
                >
                  <span className="text-xl font-semibold leading-none">
                    {summary.counts[bucket.bucket]}
                  </span>
                  <span className="mt-1 text-[11px] font-medium">
                    {bucket.shortLabel}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-[#d7dde5] bg-[#fbfcfe] px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold text-[#07142f]">
                {definition.title} · {matching.length} tenant(s)
              </h3>
              <p className="mt-1 text-xs text-[#5f718c]">
                {outstanding} renewal follow-up item(s) are still outstanding
                across all urgency groups.
              </p>
            </div>
            <Badge>{summary.notRenewing} not renewing</Badge>
          </div>

          {visible.length ? (
            <div className="mt-3 divide-y divide-[#dfe5ec]">
              {visible.map((item) => {
                const agreementSigned = ["signed", "renewal_signed"].includes(
                  item.agreementStatus ?? "",
                );
                const agreementSignable = [
                  "pending_signature",
                  "renewal_pending",
                  "renewal_sent",
                ].includes(item.agreementStatus ?? "");
                return (
                  <div className="grid gap-3 py-4" key={item.tenancyId}>
                    <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                      <div>
                        <p className="font-semibold text-[#07142f]">
                          {item.tenantName}
                          <span className="font-normal text-[#496386]">
                            {" "}· {item.propertyName} · {item.roomName}
                          </span>
                        </p>
                        <p className="mt-1 text-sm text-[#496386]">
                          Contract ends {formatMalaysiaDate(item.contractEndDate)} ·{" "}
                          <span
                            className={
                              item.daysUntilExpiry <= 14
                                ? "font-semibold text-red-600"
                                : "font-medium text-amber-700"
                            }
                          >
                            {expiryLabel(item)}
                          </span>
                          {item.phone ? ` · ${item.phone}` : " · No WhatsApp number"}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge
                            className={
                              item.decisionStatus === "renew"
                                ? "bg-emerald-100 text-emerald-800"
                                : item.decisionStatus === "not_renew"
                                  ? "bg-gray-200 text-gray-700"
                                  : item.decisionStatus === "requested"
                                    ? "bg-amber-100 text-amber-800"
                                    : statusBadgeClass("pending")
                            }
                          >
                            {decisionLabel(item)}
                          </Badge>
                          {item.decisionRequestedAt ? (
                            <span className="text-xs text-[#5f718c]">
                              Asked {formatMalaysiaDateTime(item.decisionRequestedAt)}
                            </span>
                          ) : null}
                        </div>
                        {item.decisionStatus === "renew" &&
                        item.nextTermAlreadyExpired ? (
                          <p className="mt-2 text-xs font-medium text-red-700">
                            The immediate renewal term ended on{" "}
                            {formatMalaysiaDate(item.nextEndDate)}. Review the
                            contract dates before preparing or sending a TA.
                          </p>
                        ) : null}
                      </div>

                      {item.decisionStatus === "renew" && item.agreementId ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/e-tenancy/${item.agreementId}`}>
                            <FileSignature className="h-4 w-4" />
                            View renewal TA
                          </Link>
                        </Button>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-end gap-2">
                      {["pending", "requested"].includes(item.decisionStatus) ? (
                        <form action={sendRenewalDecisionRequest}>
                          <input name="tenancyId" type="hidden" value={item.tenancyId} />
                          <RenewalSubmitButton
                            disabled={!item.phone}
                            label={
                              item.decisionStatus === "requested"
                                ? "Send question again"
                                : "Send renewal question"
                            }
                            pendingLabel="Sending..."
                            size="sm"
                            variant="outline"
                          >
                            <MessageCircle className="h-4 w-4" />
                          </RenewalSubmitButton>
                        </form>
                      ) : null}

                      {["pending", "requested", "not_renew"].includes(
                        item.decisionStatus,
                      ) ? (
                        <form action={recordRenewalDecision}>
                          <input name="tenancyId" type="hidden" value={item.tenancyId} />
                          <input name="decision" type="hidden" value="renew" />
                          <RenewalSubmitButton
                            label="Record: Wants renewal"
                            pendingLabel="Saving..."
                            size="sm"
                          />
                        </form>
                      ) : null}

                      {["pending", "requested"].includes(item.decisionStatus) ? (
                        <form action={recordRenewalDecision}>
                          <input name="tenancyId" type="hidden" value={item.tenancyId} />
                          <input name="decision" type="hidden" value="not_renew" />
                          <RenewalSubmitButton
                            className="border-red-200 text-red-700 hover:bg-red-50"
                            label="Record: Not renewing"
                            pendingLabel="Saving..."
                            size="sm"
                            variant="outline"
                          />
                        </form>
                      ) : null}

                      {item.decisionStatus === "renew" &&
                      !item.agreementId &&
                      !item.nextTermAlreadyExpired ? (
                        <form
                          action={prepareConfirmedRenewal}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <input name="tenancyId" type="hidden" value={item.tenancyId} />
                          <label className="grid gap-1 text-xs font-medium text-[#496386]">
                            Confirmed renewal rent (RM)
                            <input
                              className="w-36 rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-sm text-gray-950"
                              defaultValue={item.monthlyRent.toFixed(2)}
                              min="0.01"
                              name="monthlyRent"
                              required
                              step="0.01"
                              type="number"
                            />
                          </label>
                          <RenewalSubmitButton
                            label="Prepare & send renewal TA"
                            pendingLabel="Preparing..."
                            size="sm"
                          />
                        </form>
                      ) : null}

                      {item.decisionStatus === "renew" &&
                      item.agreementId &&
                      !agreementSigned &&
                      agreementSignable &&
                      !item.nextTermAlreadyExpired ? (
                        <form action={resendConfirmedRenewalAgreement}>
                          <input
                            name="agreementId"
                            type="hidden"
                            value={item.agreementId}
                          />
                          <RenewalSubmitButton
                            label="Send TA signing reminder"
                            pendingLabel="Sending..."
                            size="sm"
                          />
                        </form>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 rounded-md bg-white px-3 py-4 text-sm text-[#5f718c]">
              No tenants in this renewal period.
            </p>
          )}

          {matching.length > visible.length ? (
            <p className="mt-3 border-t border-[#dfe5ec] pt-3 text-sm text-[#5f718c]">
              Showing the first {visible.length} of {matching.length}. Use the
              urgency groups above to work through the list.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
