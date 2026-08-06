"use client";

import { Check, Copy, Gift, Share2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { TenantReferralProgramme } from "@/lib/data/tenant-portal";

const money = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

export function ReferralProgramme({
  programme,
}: {
  programme: TenantReferralProgramme;
}) {
  const [copied, setCopied] = useState(false);

  function referralUrl() {
    return `${window.location.origin}/register?ref=${encodeURIComponent(programme.referralCode)}`;
  }

  async function copyLink() {
    await navigator.clipboard.writeText(referralUrl());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  async function shareLink() {
    const url = referralUrl();
    const text = `Join DEKEZ using my referral code ${programme.referralCode}: ${url}`;
    if (navigator.share) {
      await navigator.share({ title: programme.promotionName, text, url });
      return;
    }
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  return (
    <Card className="overflow-hidden border-[#d8c28c]">
      <CardHeader className="border-b border-[#eee5d1] bg-[#fbf8f1]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{programme.promotionName}</CardTitle>
            <CardDescription>
              Share your code. A successful six-month tenant earns you a
              one-time {money.format(programme.rewardAmount)} credit on a future
              rental invoice.
            </CardDescription>
          </div>
          <Gift className="h-7 w-7 shrink-0 text-[#b8892c]" />
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <div className="flex flex-col gap-3 rounded-lg border border-[#eadcb9] bg-[#fffdf8] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              My Referral Code (Phone Number)
            </p>
            <p className="mt-1 text-2xl font-bold tracking-wide text-gray-950">
              {programme.referralCode}
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={copyLink} type="button" variant="outline">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button onClick={shareLink} type="button">
              <Share2 className="h-4 w-4" />
              Share
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ReferralStat label="Pending" value={programme.pendingReferrals} />
          <ReferralStat label="Successful" value={programme.successfulReferrals} />
          <ReferralStat label="Reward earned" value={money.format(programme.rewardEarned)} />
          <ReferralStat label="Reward used" value={money.format(programme.rewardUsed)} />
        </div>

        {programme.availableCredit > 0 ? (
          <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            Available rental credit: {money.format(programme.availableCredit)}.
            It will be used automatically on the next eligible generated invoice.
          </p>
        ) : null}

        {programme.referrals.length ? (
          <div className="divide-y divide-gray-200 rounded-md border border-gray-200">
            {programme.referrals.slice(0, 5).map((referral) => (
              <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm" key={referral.id}>
                <span className="min-w-0 truncate font-medium text-gray-900">
                  {referral.newTenantName}
                </span>
                <Badge
                  className={
                    referral.status === "rejected"
                      ? "bg-red-100 text-red-800"
                      : referral.status === "pending"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-emerald-100 text-emerald-800"
                  }
                >
                  {referral.status.replaceAll("_", " ")}
                </Badge>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ReferralStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-gray-950">{value}</p>
    </div>
  );
}
