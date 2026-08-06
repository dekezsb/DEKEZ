import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { addMonths } from "@/lib/e-tenancy";
import { normalizeInternationalPhone } from "@/lib/auth/phone";
import {
  derivePinPassword,
  phoneAuthAlias,
} from "@/lib/auth/registration";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeSupabaseUrl } from "@/lib/supabase/config";
import {
  validateReferralRegistration,
  type ValidatedReferral,
} from "@/lib/referrals/registration";

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

type UploadMetadata = {
  key: UploadKey;
  name: string;
  size: number;
  type: string;
};

type CookieToSet = {
  name: string;
  value: string;
  options: Parameters<NextResponse["cookies"]["set"]>[2];
};

const allowedTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const maxFileSize = 10 * 1024 * 1024;

function jsonWithCookies(
  body: Record<string, unknown>,
  cookiesToSet: CookieToSet[],
  status = 200,
) {
  const response = NextResponse.json(body, { status });
  cookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });
  return response;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validUpload(value: unknown): value is UploadMetadata {
  if (!value || typeof value !== "object") return false;
  const upload = value as Partial<UploadMetadata>;
  return (
    typeof upload.key === "string" &&
    typeof upload.name === "string" &&
    typeof upload.size === "number" &&
    upload.size > 0 &&
    upload.size <= maxFileSize &&
    typeof upload.type === "string" &&
    allowedTypes.has(upload.type)
  );
}

function extension(upload: UploadMetadata) {
  const fromName = upload.name.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1];
  if (fromName) return fromName.toLowerCase();
  if (upload.type === "application/pdf") return "pdf";
  if (upload.type === "image/png") return "png";
  if (upload.type === "image/webp") return "webp";
  return "jpg";
}

function requiredUploads(
  accountType: AccountType,
  identityType: IdentityType,
  isCommercial: boolean,
) {
  const keys: UploadKey[] =
    identityType === "ic" ? ["icFront", "icBack"] : ["passportPhoto"];

  if (accountType === "tenant") {
    keys.push("paymentSlip");
    if (isCommercial) keys.push("commercialSupportingDocument");
  }

  return keys;
}

function documentType(key: UploadKey) {
  const values: Record<UploadKey, string> = {
    companyDocument: "company_document",
    commercialSupportingDocument: "commercial_supporting_document",
    icBack: "ic_back",
    icFront: "ic_front",
    passportPhoto: "passport_photo_page",
    paymentSlip: "registration_payment_slip",
    tradingLicense: "trading_license",
  };
  return values[key];
}

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.json(
      { error: "Registration is not configured." },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => null);
  const accountType = cleanText(body?.accountType) as AccountType;
  const identityType = cleanText(body?.identityType) as IdentityType;
  const fullName = cleanText(body?.fullName);
  const emergencyContactName = cleanText(body?.emergencyContactName);
  const emergencyContactNumber = cleanText(body?.emergencyContactNumber);
  const identityNumber = cleanText(body?.identityNumber);
  const phone = normalizeInternationalPhone(cleanText(body?.phone));
  const referralInput = cleanText(body?.referralCode);
  const rawUploads: unknown[] = Array.isArray(body?.uploads)
    ? body.uploads
    : [];
  const uploads: UploadMetadata[] = rawUploads.filter(validUpload);

  if (
    !["owner", "tenant"].includes(accountType) ||
    !["ic", "passport"].includes(identityType) ||
    !fullName ||
    !identityNumber ||
    !phone ||
    (accountType === "tenant" &&
      (!emergencyContactName || !emergencyContactNumber))
  ) {
    return NextResponse.json(
      { error: "Complete all required registration details." },
      { status: 400 },
    );
  }

  if (
    uploads.length !== rawUploads.length ||
    new Set(uploads.map((upload) => upload.key)).size !== uploads.length
  ) {
    return NextResponse.json(
      { error: "One or more uploads are invalid or larger than 10 MB." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id")
    .in("normalized_phone", phone.lookupDigits)
    .limit(1)
    .maybeSingle();

  if (existingProfile) {
    return NextResponse.json(
      {
        error:
          "This phone number is already registered. Sign in using the last 4 digits of the phone number.",
      },
      { status: 409 },
    );
  }

  let property:
    | {
        company_id: string;
        contract_duration_options: number[];
        id: string;
        is_commercial: boolean;
        rental_model: "tenancy" | "monthly_stay";
      }
    | null = null;
  let room:
    | {
        id: string;
        monthly_rent: number;
        property_id: string;
        status: string;
        unit_id: string;
      }
    | null = null;
  let proposedStartDate = "";
  let duration = 12;
  let validatedReferral: ValidatedReferral | null = null;

  if (accountType === "tenant") {
    const propertyId = cleanText(body?.propertyId);
    const roomId = cleanText(body?.roomId);
    proposedStartDate = cleanText(body?.preferredMoveInDate);
    duration = Number(body?.rentalPeriod);

    if (!propertyId || !roomId || !proposedStartDate) {
      return NextResponse.json(
        { error: "Choose a property, room, move-in date and rental period." },
        { status: 400 },
      );
    }

    const [propertyResult, roomResult, pendingResult] = await Promise.all([
      admin
        .from("properties")
        .select(
          "id, company_id, is_commercial, rental_model, contract_duration_options",
        )
        .eq("id", propertyId)
        .eq("status", "active")
        .maybeSingle(),
      admin
        .from("rooms")
        .select("id, property_id, unit_id, status, monthly_rent")
        .eq("id", roomId)
        .eq("property_id", propertyId)
        .maybeSingle(),
      admin
        .from("tenant_applications")
        .select("id")
        .eq("room_id", roomId)
        .in("status", ["submitted", "pending_verification", "approved"])
        .limit(1),
    ]);

    property = propertyResult.data;
    room = roomResult.data;

    if (!property || !room || room.status !== "vacant") {
      return NextResponse.json(
        { error: "That room is no longer available." },
        { status: 409 },
      );
    }
    if (pendingResult.data?.length) {
      return NextResponse.json(
        { error: "That room already has a registration under review." },
        { status: 409 },
      );
    }
    if (
      property.rental_model !== "monthly_stay" &&
      !property.contract_duration_options.includes(duration) &&
      ![6, 12].includes(duration)
    ) {
      return NextResponse.json(
        { error: "Choose a valid rental period." },
        { status: 400 },
      );
    }

    if (referralInput) {
      try {
        validatedReferral = await validateReferralRegistration({
          companyId: property.company_id,
          contractDurationMonths:
            property.rental_model === "monthly_stay" ? 1 : duration,
          identityNumber,
          newTenantPhone: phone.e164,
          referralInput,
          rentalModel: property.rental_model,
        });
      } catch (referralError) {
        return NextResponse.json(
          {
            error:
              referralError instanceof Error
                ? referralError.message
                : "The referral could not be validated.",
          },
          { status: 400 },
        );
      }
    }
  }

  const required = requiredUploads(
    accountType,
    identityType,
    Boolean(property?.is_commercial),
  );
  const uploadKeys = new Set(uploads.map((upload) => upload.key));
  if (required.some((key) => !uploadKeys.has(key))) {
    return NextResponse.json(
      {
        error:
          identityType === "ic"
            ? "Upload the required IC photos and payment/supporting documents."
            : "Upload the required passport and payment/supporting documents.",
      },
      { status: 400 },
    );
  }

  const password = derivePinPassword(phone);
  if (!password) {
    return NextResponse.json(
      { error: "Unable to prepare the phone PIN." },
      { status: 500 },
    );
  }

  const aliasEmail = phoneAuthAlias(phone);
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email: aliasEmail,
      email_confirm: true,
      password,
      user_metadata: {
        full_name: fullName,
        phone: phone.e164,
      },
      app_metadata: {
        role: "tenant",
      },
    });

  if (createError || !created.user) {
    return NextResponse.json(
      {
        error:
          createError?.message.includes("already")
            ? "This phone number is already registered."
            : "The account could not be created.",
      },
      { status: createError?.message.includes("already") ? 409 : 500 },
    );
  }

  const userId = created.user.id;
  let applicationId: string | null = null;

  try {
    const { error: profileError } = await admin
      .from("profiles")
      .update({
        full_name: fullName,
        phone: phone.e164,
        role: "tenant",
        global_role: "tenant",
        requested_role: accountType,
        identity_type: identityType,
        identity_number: identityNumber,
        company_name:
          accountType === "owner" ? cleanText(body?.companyName) || null : null,
        company_details:
          accountType === "owner"
            ? cleanText(body?.companyDetails) || null
            : null,
        registration_status: "pending_verification",
        registration_completed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (profileError) throw profileError;

    if (accountType === "tenant" && property && room) {
      const { data: application, error: applicationError } = await admin
        .from("tenant_applications")
        .insert({
          tenant_id: userId,
          submitted_by: userId,
          submission_source: "self_registration",
          identity_type: identityType,
          property_id: property.id,
          unit_id: room.unit_id,
          room_id: room.id,
          full_name: fullName,
          ic_passport_number: identityNumber,
          whatsapp_number: phone.e164,
          emergency_contact_name: emergencyContactName,
          emergency_contact_number: emergencyContactNumber,
          contract_duration_months:
            property.rental_model === "monthly_stay" ? 1 : duration,
          proposed_start_date: proposedStartDate,
          proposed_end_date:
            property.rental_model === "monthly_stay"
              ? null
              : addMonths(proposedStartDate, duration),
          monthly_rent: Number(room.monthly_rent ?? 0),
          deposit: 0,
          utility_deposit: 0,
          rental_model: property.rental_model,
          status: "draft",
          verification_status: "incomplete",
          payment_status: "unpaid",
        })
        .select("id")
        .single();

      if (applicationError || !application) {
        throw applicationError ?? new Error("Application could not be created.");
      }
      applicationId = application.id;

      if (validatedReferral) {
        const { error: referralError } = await admin
          .from("tenant_referrals")
          .insert({
            company_id: property.company_id,
            promotion_id: validatedReferral.promotionId,
            referrer_tenant_id: validatedReferral.referrerTenantId,
            referred_application_id: application.id,
            property_id: property.id,
            room_id: room.id,
            referral_input: validatedReferral.referralCode,
            reward_amount: validatedReferral.rewardAmount,
            status: "pending",
          });

        if (referralError) throw referralError;
      }
    }

    const registrationId = applicationId ?? userId;
    const signedUploads = [];

    for (const upload of uploads) {
      const bucket =
        upload.key === "paymentSlip"
          ? "payment-receipts"
          : "tenant-documents";
      const path = `${userId}/self-registration/${registrationId}/${documentType(upload.key)}-${crypto.randomUUID()}.${extension(upload)}`;
      const { data, error } = await admin.storage
        .from(bucket)
        .createSignedUploadUrl(path);

      if (error || !data?.token) {
        throw error ?? new Error("Upload URL could not be created.");
      }

      signedUploads.push({
        bucket,
        contentType: upload.type,
        fileName: upload.name,
        key: upload.key,
        path,
        token: data.token,
      });
    }

    const cookiesToSet: CookieToSet[] = [];
    const authClient = createServerClient(
      normalizeSupabaseUrl(url),
      anonKey,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(newCookiesToSet) {
            newCookiesToSet.forEach(({ name, value }) => {
              request.cookies.set(name, value);
            });
            cookiesToSet.push(...newCookiesToSet);
          },
        },
      },
    );
    const { error: signInError } = await authClient.auth.signInWithPassword({
      email: aliasEmail,
      password,
    });

    if (signInError) throw signInError;

    return jsonWithCookies(
      {
        accountType,
        applicationId,
        uploads: signedUploads,
      },
      cookiesToSet,
    );
  } catch {
    await admin.auth.admin.deleteUser(userId);
    return NextResponse.json(
      { error: "Registration could not be prepared. Please try again." },
      { status: 500 },
    );
  }
}
