"use client";

import { Eye, MessageCircle } from "lucide-react";
import { Link } from "@/components/app-link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  DepositOutstandingRow,
  DepositOutstandingSummary,
} from "@/lib/data/deposit-outstanding";

const money = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

function whatsappHref(row: DepositOutstandingRow) {
  if (!row.tenantPhone) return null;

  const rawDigits = row.tenantPhone.replace(/\D/g, "");
  const phone = rawDigits.startsWith("0")
    ? `60${rawDigits.slice(1)}`
    : rawDigits;
  const message = [
    `Hello ${row.tenantName},`,
    `your outstanding rental deposit for ${row.propertyName}, ${row.roomNumber} is ${money.format(row.depositOutstanding)}.`,
    "Please contact DEKEZ after payment has been made.",
  ].join(" ");

  return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : null;
}

function paymentHref(row: DepositOutstandingRow, paymentMethod: string) {
  const params = new URLSearchParams({
    amount: row.depositOutstanding.toFixed(2),
    category: "deposit",
    paymentMethod,
  });
  if (row.tenantId) params.set("tenantId", row.tenantId);
  if (row.tenancyId) params.set("tenancyId", row.tenancyId);
  return `/payments?${params.toString()}`;
}

export function DepositOutstanding({
  canManage,
  summary,
}: {
  canManage: boolean;
  summary: DepositOutstandingSummary;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const visibleRows = showAll ? summary.rows : summary.rows.slice(0, 10);

  return (
    <Card className="mx-auto max-w-4xl border-[#d7dde5] bg-white shadow-sm">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Deposit Outstanding</CardTitle>
          <p className="mt-2 text-sm text-[#496386]">
            {summary.tenantCount} tenant{summary.tenantCount === 1 ? "" : "s"} still
            owe {money.format(summary.totalOutstanding)} in total.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="flex h-11 min-w-11 items-center justify-center rounded-md bg-red-50 px-3 text-xl font-bold text-red-600">
            {summary.tenantCount}
          </span>
          <Button
            onClick={() => setExpanded((current) => !current)}
            type="button"
            variant="outline"
          >
            {expanded ? "Hide" : "Show"}
          </Button>
        </div>
      </CardHeader>

      {expanded ? (
        <CardContent>
          {summary.rows.length ? (
            <div className="divide-y divide-[#e3e8ef]">
              {visibleRows.map((row) => {
                const whatsapp = whatsappHref(row);
                const canRecord = canManage && row.tenantId && row.tenancyId;

                return (
                  <div
                    className="grid gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                    key={`${row.roomId}-${row.tenantKey}`}
                  >
                    <div className="min-w-0">
                      <Link
                        className="font-semibold text-[#07142f] hover:text-[#9a6c1f]"
                        href={`/tenants/${row.tenantKey}`}
                      >
                        {row.tenantName}
                      </Link>
                      <span className="text-sm text-[#496386]">
                        {" "}
                        - {row.propertyName} - {row.roomNumber}
                      </span>
                      <p className="mt-1 text-sm text-[#496386]">
                        Deposit {money.format(row.deposit)} - received{" "}
                        {money.format(row.depositReceived)} -{" "}
                        <span className="font-semibold text-red-600">
                          outstanding {money.format(row.depositOutstanding)}
                        </span>
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {whatsapp ? (
                        <Button asChild size="sm" variant="outline">
                          <a href={whatsapp} rel="noreferrer" target="_blank">
                            <MessageCircle aria-hidden="true" className="h-4 w-4" />
                            WhatsApp
                          </a>
                        </Button>
                      ) : null}
                      {canRecord ? (
                        <>
                          <Button asChild size="sm">
                            <Link href={paymentHref(row, "cash")}>
                              Cash received
                            </Link>
                          </Button>
                          <Button asChild size="sm" variant="outline">
                            <Link href={paymentHref(row, "bank_transfer")}>
                              Online received
                            </Link>
                          </Button>
                        </>
                      ) : (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/tenants/${row.tenantKey}`}>
                            <Eye aria-hidden="true" className="h-4 w-4" />
                            View details
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
              {summary.rows.length > 10 ? (
                <div className="flex justify-center py-4">
                  <Button
                    onClick={() => setShowAll((current) => !current)}
                    type="button"
                    variant="outline"
                  >
                    {showAll
                      ? "Show first 10"
                      : `Show all ${summary.rows.length}`}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm font-medium text-emerald-700">
              No outstanding tenant deposits.
            </p>
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}
