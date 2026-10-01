import { Button } from "@/components/ui/button";

// The final step for an approved electricity top-up. `hasMeter` must come from
// resolveEffectiveTopUpMeter so the wording matches what
// confirm_smart_meter_top_up_credit will actually do: credit the room's active
// meter, or record the payment only when the room has none.
export function TopUpCreditForm({
  action,
  hasMeter,
  requestId,
}: {
  action: (formData: FormData) => void | Promise<void>;
  hasMeter: boolean;
  requestId: string;
}) {
  return (
    <form
      action={action}
      className="mt-4 grid gap-3 border-t border-[#e5e9ef] pt-4 lg:grid-cols-[1fr_auto]"
    >
      <input name="requestId" type="hidden" value={requestId} />
      <label className="block">
        <span className="text-sm font-semibold text-gray-800">
          {hasMeter ? "Physical meter/provider reference" : "Payment reference"}
        </span>
        <input
          className="mt-1 h-11 w-full rounded-md border border-[#d7dde5] px-3 text-sm"
          name="providerReference"
          placeholder={
            hasMeter
              ? "Enter only after the meter credit succeeds"
              : "Enter the bank/payment reference to mark this as paid"
          }
          required
        />
      </label>
      <Button
        className="self-end bg-emerald-700 text-white hover:bg-emerald-600"
        type="submit"
      >
        {hasMeter ? "Confirm Meter Credited" : "Confirm Payment Recorded"}
      </Button>
    </form>
  );
}
