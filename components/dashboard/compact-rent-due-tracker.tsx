import { Link } from "@/components/app-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RentDueActions } from "@/app/rent-due-tracker/rent-due-actions";
import {
  malaysiaDateString,
  type RentDueBill,
  type RentDueBucket,
  type RentDueSummary,
} from "@/lib/data/rent-due";
import { formatMalaysiaDate } from "@/lib/date-format";
import { portalText } from "@/lib/i18n-portal";
import type { AppLocale } from "@/lib/i18n";

type CompactRentDueTrackerProps = {
  locale?: AppLocale;
  selectedBucket?: string;
  summary: RentDueSummary;
};

type BucketDefinition = {
  bucket: RentDueBucket;
  group: "before" | "due" | "overdue";
  shortLabel: string;
  title: string;
};

const buckets: BucketDefinition[] = [
  { bucket: "before_7", group: "before", shortLabel: "7d", title: "7 days before due" },
  { bucket: "before_6", group: "before", shortLabel: "6d", title: "6 days before due" },
  { bucket: "before_5", group: "before", shortLabel: "5d", title: "5 days before due" },
  { bucket: "before_4", group: "before", shortLabel: "4d", title: "4 days before due" },
  { bucket: "before_3", group: "before", shortLabel: "3d", title: "3 days before due" },
  { bucket: "before_2", group: "before", shortLabel: "2d", title: "2 days before due" },
  { bucket: "before_1", group: "before", shortLabel: "1d", title: "1 day before due" },
  { bucket: "due_today", group: "due", shortLabel: "Due", title: "Due today" },
  { bucket: "overdue_1", group: "overdue", shortLabel: "+1d", title: "1 day overdue" },
  { bucket: "overdue_2", group: "overdue", shortLabel: "+2d", title: "2 days overdue" },
  { bucket: "overdue_3", group: "overdue", shortLabel: "+3d", title: "3 days overdue" },
  { bucket: "overdue_4", group: "overdue", shortLabel: "+4d", title: "4 days overdue" },
  { bucket: "overdue_5", group: "overdue", shortLabel: "+5d", title: "5 days overdue" },
  { bucket: "overdue_6", group: "overdue", shortLabel: "+6d", title: "6 days overdue" },
  { bucket: "overdue_7", group: "overdue", shortLabel: "+7d", title: "7 days overdue" },
  { bucket: "overdue_more_7", group: "overdue", shortLabel: ">7d", title: "More than 7 days overdue" },
];

const money = new Intl.NumberFormat("en-MY", {
  currency: "MYR",
  style: "currency",
});

function validBucket(value: string | undefined): value is RentDueBucket {
  return buckets.some((item) => item.bucket === value);
}

function defaultBucket(summary: RentDueSummary) {
  if (summary.counts.due_today > 0) return "due_today" as RentDueBucket;

  const firstActive = buckets
    .slice(7)
    .find((item) => summary.counts[item.bucket] > 0)
    ?? buckets.find((item) => summary.counts[item.bucket] > 0);

  return firstActive?.bucket ?? "due_today";
}

function bucketClasses(
  definition: BucketDefinition,
  selected: boolean,
  count: number,
) {
  const faded = count === 0 ? "opacity-45" : "";
  if (definition.group === "due") {
    return `${selected ? "border-[#b98a2c] ring-1 ring-[#b98a2c]" : "border-amber-200"} bg-amber-50 text-amber-900 ${faded}`;
  }
  if (definition.group === "overdue") {
    return `${selected ? "border-red-500 ring-1 ring-red-500" : "border-red-100"} bg-red-50 text-red-700 ${faded}`;
  }
  return `${selected ? "border-[#7689a4] ring-1 ring-[#7689a4]" : "border-[#e3e8ef]"} bg-[#f3f6f9] text-[#18304f] ${faded}`;
}

function billMonthLabel(value: string) {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  if (!year || !month) return value;

  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function reminderMessage(bill: RentDueBill) {
  const dueDate = formatMalaysiaDate(bill.due_date);
  const room = `${bill.propertyName} ${bill.roomName}`;

  if (bill.daysUntilDue < 0) {
    return `Hello ${bill.tenantName}, your rental payment of ${money.format(bill.outstandingAmount)} for ${room} was due on ${dueDate} and is now ${Math.abs(bill.daysUntilDue)} day(s) overdue. Please make payment and upload your payment proof through your DEKEZ tenant portal.`;
  }

  return `Hello ${bill.tenantName}, this is a reminder that your rental of ${money.format(bill.outstandingAmount)} for ${room} is due on ${dueDate}. Please make payment and upload your payment slip through your DEKEZ tenant portal.`;
}

function selectionDescription(bucket: BucketDefinition, locale: AppLocale) {
  if (bucket.group === "before") {
    return portalText(locale, "Send an early reminder before the rent becomes due.");
  }
  if (bucket.group === "due") {
    return portalText(locale, "Cash received goes into company cash in hand. Online asks for the transfer slip.");
  }
  return portalText(locale, "Follow up overdue rent or record the payment received.");
}

export function CompactRentDueTracker({
  locale = "en",
  selectedBucket,
  summary,
}: CompactRentDueTrackerProps) {
  const actionableBills = summary.bills.filter(
    (bill) => bill.paymentStatus !== "pending_verification",
  );
  const actionableCounts = Object.fromEntries(
    buckets.map((item) => [
      item.bucket,
      actionableBills.filter((bill) => bill.bucket === item.bucket).length,
    ]),
  ) as Record<RentDueBucket, number>;
  const actionableSummary: RentDueSummary = {
    ...summary,
    bills: actionableBills,
    counts: actionableCounts,
    totalDueOverdue: actionableBills.filter((bill) =>
      ["due_today", "overdue", "severely_overdue"].includes(bill.dueStatus),
    ).length,
    totalComingUp: actionableBills.filter(
      (bill) => bill.dueStatus === "coming_up",
    ).length,
  };
  const activeBucket = validBucket(selectedBucket)
    ? selectedBucket
    : defaultBucket(actionableSummary);
  const definition =
    buckets.find((item) => item.bucket === activeBucket) ?? buckets[7];
  const matchingBills = actionableBills.filter(
    (bill) => bill.bucket === activeBucket,
  );
  const visibleBills = matchingBills.slice(0, 6);
  const today = malaysiaDateString();

  return (
    <Card
      className="mx-auto max-w-4xl rounded-lg border-[#d7dde5] shadow-sm"
      id="dashboard-rent-due"
    >
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-[#07142f]">
            {portalText(locale, "Rent Due Tracker")}
          </h2>
          <div className="flex flex-wrap items-center gap-3 text-sm text-[#496386]">
            <span>
              {actionableSummary.totalDueOverdue} {portalText(locale, "due")} /{" "}
              {portalText(locale, "Overdue").toLowerCase()} ·{" "}
              {actionableSummary.totalComingUp} {portalText(locale, "coming up")}
            </span>
            <Button asChild size="sm" variant="outline">
              <Link href="/rent-due-tracker">{portalText(locale, "Open full tracker")}</Link>
            </Button>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto pb-2">
          <div className="min-w-max">
            <div className="mb-1 grid grid-cols-[repeat(16,56px)] gap-1 text-[10px] font-semibold uppercase">
              <span className="col-span-7 text-[#8392aa]">{portalText(locale, "Before due")}</span>
              <span className="text-center text-amber-600">{portalText(locale, "Due")}</span>
              <span className="col-span-8 text-center text-red-500">{portalText(locale, "Overdue")}</span>
            </div>
            <div className="grid grid-cols-[repeat(16,56px)] gap-1">
              {buckets.map((item) => {
                const count = actionableCounts[item.bucket] ?? 0;
                const selected = item.bucket === activeBucket;
                return (
                  <Link
                    aria-current={selected ? "true" : undefined}
                    aria-label={`${item.title}: ${count}`}
                    className={`flex h-14 flex-col items-center justify-center rounded-md border text-center transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-[#126b5f] focus:ring-offset-1 ${bucketClasses(item, selected, count)}`}
                    href={`/dashboard?rentBucket=${item.bucket}#dashboard-rent-due`}
                    key={item.bucket}
                  >
                    <span className="text-lg font-semibold leading-none">{count}</span>
                    <span className="mt-1 text-[10px] font-medium">{item.shortLabel}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-[#d7dde5] bg-[#fbfcfe] px-4 py-3">
          <div>
            <h3 className="font-semibold text-[#07142f]">
              {portalText(locale, definition.title)} · {matchingBills.length}{" "}
              {portalText(locale, matchingBills.length === 1 ? "tenant" : "tenants")}
            </h3>
            <p className="mt-1 text-xs text-[#5f718c]">
              {selectionDescription(definition, locale)}
            </p>
          </div>

          {visibleBills.length ? (
            <div className="mt-3 divide-y divide-[#dfe5ec]">
              {visibleBills.map((bill) => (
                <div
                  className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                  key={bill.id}
                >
                  <div className="min-w-0">
                    <p className="font-medium text-[#07142f]">
                      {bill.tenantName}
                      <span className="font-normal text-[#496386]">
                        {" "}· {bill.propertyName} · {bill.roomName}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-[#496386]">
                      {money.format(bill.outstandingAmount)} · {portalText(locale, "due")}{" "}
                      {formatMalaysiaDate(bill.due_date)}
                      {bill.tenantPhone ? ` · ${bill.tenantPhone}` : ""}
                    </p>
                  </div>

                  {bill.source === "rent_bill" ? (
                    <RentDueActions
                      amountDue={money.format(bill.amount)}
                      billId={bill.id}
                      billMonth={billMonthLabel(bill.bill_month)}
                      compact
                      latestSubmissionId={bill.latestSubmissionId}
                      latestSubmissionStatus={bill.latestSubmissionStatus}
                      outstandingAmount={money.format(bill.outstandingAmount)}
                      outstandingAmountValue={bill.outstandingAmount}
                      paidDateDefault={today}
                      propertyName={bill.propertyName}
                      receiptUrl={bill.latestReceiptUrl}
                      reminderMessage={reminderMessage(bill)}
                      roomName={bill.roomName}
                      tenantName={bill.tenantName}
                    />
                  ) : (
                    <Button asChild size="sm" variant="outline">
                      <Link href="/rent-due-tracker">{portalText(locale, "Open tracker")}</Link>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-md bg-white px-3 py-4 text-sm text-[#5f718c]">
              {portalText(locale, "No tenants in this category.")}
            </p>
          )}

          {matchingBills.length > visibleBills.length ? (
            <div className="mt-3 border-t border-[#dfe5ec] pt-3 text-right">
              <Button asChild size="sm" variant="ghost">
                <Link href="/rent-due-tracker">
                  View all {matchingBills.length} tenants
                </Link>
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
