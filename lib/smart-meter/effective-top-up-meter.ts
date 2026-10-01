// Mirrors the meter lookup inside the confirm_smart_meter_top_up_credit RPC
// (supabase/migrations/20261001160519_optional_meter_credit_for_topup.sql) so
// the Verification page shows the same meter-credit vs payment-only flow the
// RPC will actually perform:
//
//   where (meter.id = request.meter_id
//          or (request.meter_id is null and meter.room_id = request.room_id))
//     and meter.meter_type = 'electricity'
//     and meter.status = 'active'
//   order by (meter.id = request.meter_id) desc, meter.updated_at desc
//   limit 1
//
// A request whose stored meter_id points at a meter that is no longer active
// does NOT fall back to the room: the RPC only consults the room when
// meter_id is null.

export type TopUpMeterCandidate = {
  id: string;
  room_id: string | null;
  meter_type: string | null;
  status: string | null;
  updated_at: string | null;
};

export function resolveEffectiveTopUpMeter<Meter extends TopUpMeterCandidate>(
  request: { meter_id: string | null; room_id: string },
  meters: Meter[],
): Meter | null {
  const candidates = meters.filter(
    (meter) =>
      meter.meter_type === "electricity" &&
      meter.status === "active" &&
      (meter.id === request.meter_id ||
        (request.meter_id === null && meter.room_id === request.room_id)),
  );

  candidates.sort((a, b) => {
    const exactA = a.id === request.meter_id ? 1 : 0;
    const exactB = b.id === request.meter_id ? 1 : 0;
    if (exactA !== exactB) return exactB - exactA;
    // Postgres sorts NULLs first under DESC.
    if (a.updated_at === b.updated_at) return 0;
    if (a.updated_at === null) return -1;
    if (b.updated_at === null) return 1;
    return Date.parse(b.updated_at) - Date.parse(a.updated_at);
  });

  return candidates[0] ?? null;
}
