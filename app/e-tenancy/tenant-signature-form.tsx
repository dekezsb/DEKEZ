"use client";

import { useState } from "react";
import {
  SignaturePad,
  SignatureSubmitButton,
} from "./signature-pad";

type TenantSignatureFormProps = {
  action: (formData: FormData) => Promise<void>;
  agreementId: string;
};

export function TenantSignatureForm({
  action,
  agreementId,
}: TenantSignatureFormProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  return (
    <form action={action} className="space-y-5">
      <input name="agreementId" type="hidden" value={agreementId} />
      <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-md border border-[#d7dde5] bg-[#f8fafc] p-3 text-sm text-gray-700">
        <input
          checked={confirmed}
          className="mt-0.5 size-5 shrink-0 accent-[#126b5f]"
          name="confirmAgreement"
          onChange={(event) => setConfirmed(event.target.checked)}
          type="checkbox"
        />
        <span>
          I confirm that I have read, understood and agree to this tenancy
          agreement.
        </span>
      </label>
      <SignaturePad onSignatureChange={setHasSignature} />
      <p className="text-xs leading-5 text-gray-500">
        After signing, the agreement cannot be edited. A permanent signed PDF
        will be saved in your tenant portal.
      </p>
      <SignatureSubmitButton disabled={!confirmed || !hasSignature} />
    </form>
  );
}
