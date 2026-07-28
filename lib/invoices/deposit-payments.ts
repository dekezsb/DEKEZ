type SupabaseLike = {
  from: (table: string) => any;
};

type DepositPaymentMaps = {
  canonicalByTenancy: Map<string, number>;
  submissionsByTenancy: Map<string, number>;
  submissionsByRecord: Map<string, number>;
};

const depositCategories = [
  "deposit",
  "rental_deposit",
  "security_deposit",
];

function addAmount(map: Map<string, number>, key: string | null, amount: unknown) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + Number(amount ?? 0));
}

export async function getVerifiedDepositPaymentMaps(
  supabase: SupabaseLike,
  tenancyIds: string[],
  tenantRecordIds: string[],
): Promise<DepositPaymentMaps> {
  const [paymentsResult, tenancySubmissionsResult, recordSubmissionsResult] =
    await Promise.all([
      tenancyIds.length
        ? supabase
            .from("payments")
            .select("tenancy_id, amount")
            .in("tenancy_id", tenancyIds)
            .in("category", depositCategories)
            .in("status", ["confirmed", "paid"])
        : Promise.resolve({ data: [], error: null }),
      tenancyIds.length
        ? supabase
            .from("payment_submissions")
            .select("tenancy_id, amount")
            .in("tenancy_id", tenancyIds)
            .in("payment_type", depositCategories)
            .eq("verification_status", "verified")
        : Promise.resolve({ data: [], error: null }),
      tenantRecordIds.length
        ? supabase
            .from("payment_submissions")
            .select("tenant_record_id, amount")
            .in("tenant_record_id", tenantRecordIds)
            .in("payment_type", depositCategories)
            .eq("verification_status", "verified")
        : Promise.resolve({ data: [], error: null }),
    ]);

  const canonicalByTenancy = new Map<string, number>();
  const submissionsByTenancy = new Map<string, number>();
  const submissionsByRecord = new Map<string, number>();

  for (const payment of paymentsResult.data ?? []) {
    addAmount(canonicalByTenancy, payment.tenancy_id, payment.amount);
  }
  for (const submission of tenancySubmissionsResult.data ?? []) {
    addAmount(submissionsByTenancy, submission.tenancy_id, submission.amount);
  }
  for (const submission of recordSubmissionsResult.data ?? []) {
    addAmount(
      submissionsByRecord,
      submission.tenant_record_id,
      submission.amount,
    );
  }

  return {
    canonicalByTenancy,
    submissionsByTenancy,
    submissionsByRecord,
  };
}

export function verifiedDepositPaid(
  maps: DepositPaymentMaps,
  input: {
    tenancyId: string | null;
    tenantRecordId: string | null;
    depositAmount: number;
  },
) {
  const canonical = input.tenancyId
    ? maps.canonicalByTenancy.get(input.tenancyId) ?? 0
    : 0;
  const submitted = input.tenancyId
    ? maps.submissionsByTenancy.get(input.tenancyId) ?? 0
    : input.tenantRecordId
      ? maps.submissionsByRecord.get(input.tenantRecordId) ?? 0
      : 0;
  const received = canonical > 0 ? canonical : submitted;

  return Math.min(Math.max(received, 0), Math.max(input.depositAmount, 0));
}
