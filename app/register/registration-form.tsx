"use client";

import { Camera, FileText, Image as ImageIcon } from "lucide-react";
import { Link } from "@/components/app-link";
import { FormEvent, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type AccountType = "owner" | "tenant";
type IdentityType = "ic" | "passport";
type UploadKey =
  | "companyDocument"
  | "commercialSupportingDocument"
  | "icBack"
  | "icFront"
  | "passportPhoto"
  | "paymentSlip"
  | "tradingLicense";

type RegistrationProperty = {
  contractDurations: number[];
  id: string;
  isCommercial: boolean;
  label: string;
  rentalModel: "tenancy" | "monthly_stay";
};

type RegistrationRoom = {
  id: string;
  propertyId: string;
  roomNumber: string;
};

type SignedUpload = {
  bucket: "payment-receipts" | "tenant-documents";
  contentType: string;
  fileName: string;
  key: UploadKey;
  path: string;
  token: string;
};

const inputClass =
  "mt-1.5 h-11 w-full rounded-md border border-[#cfd8e6] bg-white px-3 text-sm text-[#07142f] outline-none transition focus:border-[#b98a2c] focus:ring-2 focus:ring-[#b98a2c]/20";

function FilePicker({
  accept = "image/*",
  file,
  label,
  onSelect,
  required,
}: {
  accept?: string;
  file?: File;
  label: string;
  onSelect: (file: File) => void;
  required?: boolean;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const supportsCamera = accept.startsWith("image/");

  return (
    <div>
      <p className="text-sm font-medium text-[#17223b]">
        {label}
        {required ? <span className="ml-1 text-red-600">*</span> : null}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {supportsCamera ? (
          <>
            <input
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => {
                const selected = event.target.files?.[0];
                if (selected) onSelect(selected);
              }}
              ref={cameraRef}
              type="file"
            />
            <button
              className="inline-flex h-10 items-center gap-2 rounded-md bg-[#f7edd7] px-4 text-sm font-semibold text-[#956d1f] transition hover:bg-[#eeddb9]"
              onClick={() => cameraRef.current?.click()}
              type="button"
            >
              <Camera className="h-4 w-4" />
              Take photo
            </button>
          </>
        ) : null}
        <input
          accept={accept}
          className="sr-only"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) onSelect(selected);
          }}
          ref={galleryRef}
          type="file"
        />
        <button
          className="inline-flex h-10 items-center gap-2 rounded-md border border-[#cfd8e6] bg-white px-4 text-sm font-semibold text-[#24324b] transition hover:bg-[#f6f8fa]"
          onClick={() => galleryRef.current?.click()}
          type="button"
        >
          {supportsCamera ? (
            <ImageIcon className="h-4 w-4" />
          ) : (
            <FileText className="h-4 w-4" />
          )}
          Choose file
        </button>
      </div>
      <p className="mt-2 min-h-5 truncate text-xs text-[#7b879c]">
        {file?.name ?? "No file selected"}
      </p>
    </div>
  );
}

export function RegistrationForm({
  initialReferralCode = "",
  properties,
  rooms,
}: {
  initialReferralCode?: string;
  properties: RegistrationProperty[];
  rooms: RegistrationRoom[];
}) {
  const [accountType, setAccountType] = useState<AccountType>("tenant");
  const [identityType, setIdentityType] = useState<IdentityType>("ic");
  const [propertyId, setPropertyId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [files, setFiles] = useState<Partial<Record<UploadKey, File>>>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const selectedProperty = properties.find(
    (property) => property.id === propertyId,
  );
  const availableRooms = rooms.filter(
    (room) => room.propertyId === propertyId,
  );

  function selectFile(key: UploadKey, file: File) {
    setFiles((current) => ({ ...current, [key]: file }));
  }

  function switchAccountType(value: AccountType) {
    setAccountType(value);
    setError(null);
    setFiles({});
    setIdentityType("ic");
    setPropertyId("");
    setRoomId("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const requiredFileKeys: UploadKey[] =
      identityType === "ic" ? ["icFront", "icBack"] : ["passportPhoto"];

    if (accountType === "tenant") {
      requiredFileKeys.push("paymentSlip");
      if (selectedProperty?.isCommercial) {
        requiredFileKeys.push("commercialSupportingDocument");
      }
    }

    if (requiredFileKeys.some((key) => !files[key])) {
      setError("Please add every required photo or document.");
      return;
    }

    setIsLoading(true);
    try {
      const uploads = Object.entries(files).map(([key, file]) => ({
        key,
        name: file.name,
        size: file.size,
        type: file.type,
      }));
      const startResponse = await fetch("/api/register/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountType,
          companyDetails: formData.get("companyDetails"),
          companyName: formData.get("companyName"),
          fullName: formData.get("fullName"),
          emergencyContactName: formData.get("emergencyContactName"),
          emergencyContactNumber: formData.get("emergencyContactNumber"),
          identityNumber: formData.get("identityNumber"),
          identityType,
          phone: formData.get("phone"),
          preferredMoveInDate: formData.get("preferredMoveInDate"),
          propertyId,
          referralCode: formData.get("referralCode"),
          rentalPeriod: formData.get("rentalPeriod"),
          roomId,
          uploads,
        }),
      });
      const startResult = await startResponse.json();

      if (!startResponse.ok) {
        throw new Error(startResult.error ?? "Registration could not start.");
      }

      const signedUploads = startResult.uploads as SignedUpload[];
      const supabase = createClient();
      for (const upload of signedUploads) {
        const file = files[upload.key];
        if (!file) throw new Error("A selected file is missing.");
        const { error: uploadError } = await supabase.storage
          .from(upload.bucket)
          .uploadToSignedUrl(upload.path, upload.token, file, {
            contentType: file.type,
          });
        if (uploadError) throw uploadError;
      }

      const completeResponse = await fetch("/api/register/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountType,
          applicationId: startResult.applicationId,
          uploads: signedUploads.map(({ token: _token, ...upload }) => upload),
        }),
      });
      const completeResult = await completeResponse.json();

      if (!completeResponse.ok) {
        throw new Error(
          completeResult.error ?? "Registration could not be completed.",
        );
      }

      window.location.assign(
        completeResult.redirectTo ?? "/registration-status",
      );
    } catch (registrationError) {
      setError(
        registrationError instanceof Error
          ? registrationError.message
          : "Registration could not be completed.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form className="mt-7 space-y-6" onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 rounded-md border border-[#d7dde5] bg-[#f6f7f9] p-1">
        {(["tenant", "owner"] as const).map((type) => (
          <button
            className={`h-10 rounded text-sm font-semibold transition ${
              accountType === type
                ? "bg-white text-[#111827] shadow-sm"
                : "text-[#68758b] hover:text-[#111827]"
            }`}
            key={type}
            onClick={() => switchAccountType(type)}
            type="button"
          >
            {type === "tenant" ? "Tenant" : "Owner"}
          </button>
        ))}
      </div>

      <div>
        <h2 className="text-xl font-semibold text-[#111827]">
          {accountType === "tenant"
            ? "Tenant Registration"
            : "Owner Registration"}
        </h2>
        <p className="mt-1 text-sm leading-6 text-[#60708a]">
          {accountType === "tenant"
            ? selectedProperty?.rentalModel === "monthly_stay"
              ? "Sulaman uses a rolling monthly stay. Register, pay the first month immediately and upload the slip. Your room starts only after Admin verifies both your identity and payment. No deposit or tenancy agreement is required."
              : "Choose a vacant room and submit your details. An Admin will verify the registration before preparing your tenancy agreement."
            : "Submit your identity details. An Admin will verify them and assign the properties you may view."}
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {accountType === "tenant" ? (
          <>
            <label>
              <span className="text-sm font-medium text-[#17223b]">
                Choose a property
              </span>
              <select
                className={inputClass}
                onChange={(event) => {
                  setPropertyId(event.target.value);
                  setRoomId("");
                }}
                required
                value={propertyId}
              >
                <option value="">Select a property</option>
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-sm font-medium text-[#17223b]">
                Choose a room
              </span>
              <select
                className={inputClass}
                disabled={!propertyId}
                onChange={(event) => setRoomId(event.target.value)}
                required
                value={roomId}
              >
                <option value="">
                  {propertyId
                    ? availableRooms.length
                      ? "Select an available room"
                      : "No vacant rooms available"
                    : "Choose a property first"}
                </option>
                {availableRooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.roomNumber}
                  </option>
                ))}
              </select>
            </label>
            <label className="sm:col-span-2">
              <span className="text-sm font-medium text-[#17223b]">
                Referrer&apos;s phone number (optional)
              </span>
              <input
                className={inputClass}
                defaultValue={initialReferralCode}
                name="referralCode"
                placeholder="Example: 012-345 6789"
              />
            </label>
          </>
        ) : null}

        <label>
          <span className="text-sm font-medium text-[#17223b]">Full name</span>
          <input
            autoComplete="name"
            className={inputClass}
            name="fullName"
            placeholder="As per IC / passport"
            required
          />
        </label>

        <div>
          <span className="text-sm font-medium text-[#17223b]">
            Identity document
          </span>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {(["ic", "passport"] as const).map((type) => (
              <button
                className={`h-11 rounded-md border text-sm font-semibold transition ${
                  identityType === type
                    ? "border-[#b98a2c] bg-[#fbf4e3] text-[#7d5b18]"
                    : "border-[#cfd8e6] bg-white text-[#24324b]"
                }`}
                key={type}
                onClick={() => {
                  setIdentityType(type);
                  setFiles((current) => ({
                    ...current,
                    icBack: undefined,
                    icFront: undefined,
                    passportPhoto: undefined,
                  }));
                }}
                type="button"
              >
                {type === "ic" ? "IC" : "Passport"}
              </button>
            ))}
          </div>
        </div>

        <label>
          <span className="text-sm font-medium text-[#17223b]">
            {identityType === "ic" ? "IC number" : "Passport number"}
          </span>
          <input
            className={inputClass}
            name="identityNumber"
            placeholder={
              identityType === "ic"
                ? "e.g. 990101-01-1234"
                : "Passport number"
            }
            required
          />
        </label>

        <label>
          <span className="text-sm font-medium text-[#17223b]">
            Phone / WhatsApp
          </span>
          <input
            autoComplete="tel"
            className={inputClass}
            inputMode="tel"
            name="phone"
            placeholder="012-345 6789 or +country code"
            required
            type="tel"
          />
          <span className="mt-1 block text-xs text-[#7b879c]">
            Your initial sign-in PIN will be the last 4 digits.
          </span>
        </label>

        {accountType === "tenant" ? (
          <>
            <label>
              <span className="text-sm font-medium text-[#17223b]">
                Emergency contact name
              </span>
              <input
                autoComplete="name"
                className={inputClass}
                name="emergencyContactName"
                placeholder="Person to contact in an emergency"
                required
              />
            </label>
            <label>
              <span className="text-sm font-medium text-[#17223b]">
                Emergency contact number
              </span>
              <input
                autoComplete="tel"
                className={inputClass}
                inputMode="tel"
                name="emergencyContactNumber"
                placeholder="012-345 6789 or +country code"
                required
                type="tel"
              />
            </label>
            <label>
              <span className="text-sm font-medium text-[#17223b]">
                Preferred move-in date
              </span>
              <input
                className={inputClass}
                name="preferredMoveInDate"
                required
                type="date"
              />
            </label>
            {selectedProperty?.rentalModel === "monthly_stay" ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
                <strong>Monthly stay:</strong> no deposit and no fixed contract.
                The first month is due on check-in and each following month is
                due on the same calendar day until checkout.
                <input name="rentalPeriod" type="hidden" value="1" />
              </div>
            ) : (
              <label>
                <span className="text-sm font-medium text-[#17223b]">
                  Rental period
                </span>
                <select
                  className={inputClass}
                  defaultValue=""
                  name="rentalPeriod"
                  required
                >
                  <option value="">Select rental period</option>
                  {(selectedProperty?.contractDurations ?? [6, 12]).map(
                    (months) => (
                      <option key={months} value={months}>
                        {months} months
                      </option>
                    ),
                  )}
                </select>
              </label>
            )}
          </>
        ) : (
          <>
            <label>
              <span className="text-sm font-medium text-[#17223b]">
                Company / business name
              </span>
              <input
                className={inputClass}
                name="companyName"
                placeholder="Optional"
              />
            </label>
            <label>
              <span className="text-sm font-medium text-[#17223b]">
                Company details
              </span>
              <input
                className={inputClass}
                name="companyDetails"
                placeholder="Registration number or notes, optional"
              />
            </label>
          </>
        )}
      </div>

      <fieldset className="rounded-md border border-[#d7dde5] p-4">
        <legend className="px-1 text-sm font-semibold text-[#07142f]">
          Identity photos
        </legend>
        <div className="grid gap-5 sm:grid-cols-2">
          {identityType === "ic" ? (
            <>
              <FilePicker
                file={files.icFront}
                label="IC photo - FRONT"
                onSelect={(file) => selectFile("icFront", file)}
                required
              />
              <FilePicker
                file={files.icBack}
                label="IC photo - BACK"
                onSelect={(file) => selectFile("icBack", file)}
                required
              />
            </>
          ) : (
            <FilePicker
              file={files.passportPhoto}
              label="Passport photo page"
              onSelect={(file) => selectFile("passportPhoto", file)}
              required
            />
          )}
        </div>
        <p className="mt-3 text-xs leading-5 text-[#7b879c]">
          Make sure the full document is visible, sharp and well lit.
        </p>
      </fieldset>

      {accountType === "tenant" ? (
        <>
          {selectedProperty?.isCommercial ? (
            <fieldset className="rounded-md border border-[#e2c985] bg-[#fffaf0] p-4">
              <legend className="px-1 text-sm font-semibold text-[#7d5b18]">
                Commercial property document
              </legend>
              <FilePicker
                accept="image/*,application/pdf"
                file={files.commercialSupportingDocument}
                label="Trading licence / supporting document"
                onSelect={(file) =>
                  selectFile("commercialSupportingDocument", file)
                }
                required
              />
            </fieldset>
          ) : null}
          <fieldset className="rounded-md border border-[#d7dde5] p-4">
            <legend className="px-1 text-sm font-semibold text-[#07142f]">
              Payment proof
            </legend>
            <FilePicker
              file={files.paymentSlip}
              label="Payment slip"
              onSelect={(file) => selectFile("paymentSlip", file)}
              required
            />
            <p className="mt-3 text-xs leading-5 text-[#7b879c]">
              {selectedProperty?.rentalModel === "monthly_stay"
                ? "First-month payment is required now. Upload the online transfer receipt; check-in activates only after Admin verification."
                : "Upload the receipt or transfer screenshot. It remains pending until an Admin verifies it."}
            </p>
          </fieldset>
        </>
      ) : (
        <fieldset className="rounded-md border border-[#d7dde5] p-4">
          <legend className="px-1 text-sm font-semibold text-[#07142f]">
            Supporting company documents (optional)
          </legend>
          <div className="grid gap-5 sm:grid-cols-2">
            <FilePicker
              accept="image/*,application/pdf"
              file={files.tradingLicense}
              label="Trading licence"
              onSelect={(file) => selectFile("tradingLicense", file)}
            />
            <FilePicker
              accept="image/*,application/pdf"
              file={files.companyDocument}
              label="Company document"
              onSelect={(file) => selectFile("companyDocument", file)}
            />
          </div>
        </fieldset>
      )}

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        className="h-11 w-full rounded-md bg-[#b8892c] px-5 text-sm font-semibold text-white transition hover:bg-[#9d7424] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isLoading}
        type="submit"
      >
        {isLoading ? "Uploading registration..." : "Submit registration"}
      </button>

      <p className="text-center text-sm text-gray-600">
        Already registered?{" "}
        <Link
          className="font-semibold text-[#8a641d] underline-offset-4 hover:underline"
          href="/"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
