"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { normalizeInternationalPhone } from "@/lib/auth/phone";
import { createClient } from "@/lib/supabase/client";

type RegistrationStep = "details" | "verification";

export function RegistrationForm() {
  const [step, setStep] = useState<RegistrationStep>("details");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function createPendingProfile(user: User, e164Phone: string) {
    const supabase = createClient();
    const { error: insertError } = await supabase.from("profiles").insert({
      id: user.id,
      full_name: fullName.trim(),
      phone: e164Phone,
      role: "tenant",
      registration_status: "pending_verification",
    });

    if (insertError?.code === "23505") {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          full_name: fullName.trim(),
          phone: e164Phone,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (updateError) {
        throw updateError;
      }
      return;
    }

    if (insertError) {
      throw insertError;
    }
  }

  async function handleRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const normalizedPhone = normalizeInternationalPhone(phone);
    if (!normalizedPhone) {
      setError("Enter a valid phone number with country code.");
      return;
    }

    if (password.length < 8) {
      setError("Password must contain at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Password and confirm password do not match.");
      return;
    }

    setIsLoading(true);
    const supabase = createClient();

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        phone: normalizedPhone.e164,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
          },
        },
      });

      if (signUpError || !data.user) {
        setError(signUpError?.message ?? "Unable to create your account.");
        return;
      }

      if (data.session) {
        await createPendingProfile(data.user, normalizedPhone.e164);
        window.location.assign("/registration-status");
        return;
      }

      setPhone(normalizedPhone.e164);
      setStep("verification");
      setMessage("Enter the verification code sent to your phone.");
    } catch (registrationError) {
      setError(
        registrationError instanceof Error
          ? registrationError.message
          : "Unable to complete your registration.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    const normalizedPhone = normalizeInternationalPhone(phone);
    if (!normalizedPhone) {
      setError("The phone number is invalid.");
      setIsLoading(false);
      return;
    }

    const supabase = createClient();
    try {
      const { data, error: verificationError } = await supabase.auth.verifyOtp({
        phone: normalizedPhone.e164,
        token: verificationCode.trim(),
        type: "sms",
      });

      if (verificationError || !data.user) {
        setError(
          verificationError?.message ?? "The verification code is invalid.",
        );
        return;
      }

      await createPendingProfile(data.user, normalizedPhone.e164);
      window.location.assign("/registration-status");
    } catch (verificationFailure) {
      setError(
        verificationFailure instanceof Error
          ? verificationFailure.message
          : "Unable to verify your phone number.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  if (step === "verification") {
    return (
      <form className="mt-7 space-y-5" onSubmit={handleVerification}>
        {message ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {message}
          </p>
        ) : null}
        <label className="block">
          <span className="text-sm font-medium text-gray-800">
            Verification code
          </span>
          <input
            autoComplete="one-time-code"
            className="mt-2 h-11 w-full rounded-md border border-[#cfd8e5] px-3 text-gray-950 outline-none focus:border-[#b8892c] focus:ring-2 focus:ring-[#b8892c]/20"
            inputMode="numeric"
            maxLength={8}
            onChange={(event) => setVerificationCode(event.target.value)}
            required
            value={verificationCode}
          />
        </label>
        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <button
          className="h-11 w-full rounded-md bg-[#b8892c] px-5 text-sm font-semibold text-[#17130d] hover:bg-[#c99a3e] disabled:opacity-60"
          disabled={isLoading}
          type="submit"
        >
          {isLoading ? "Verifying..." : "Verify phone"}
        </button>
      </form>
    );
  }

  return (
    <form className="mt-7 space-y-4" onSubmit={handleRegistration}>
      <label className="block">
        <span className="text-sm font-medium text-gray-800">Full name</span>
        <input
          autoComplete="name"
          className="mt-2 h-11 w-full rounded-md border border-[#cfd8e5] px-3 text-gray-950 outline-none focus:border-[#b8892c] focus:ring-2 focus:ring-[#b8892c]/20"
          onChange={(event) => setFullName(event.target.value)}
          required
          type="text"
          value={fullName}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-gray-800">Phone number</span>
        <input
          autoComplete="tel"
          className="mt-2 h-11 w-full rounded-md border border-[#cfd8e5] px-3 text-gray-950 outline-none focus:border-[#b8892c] focus:ring-2 focus:ring-[#b8892c]/20"
          inputMode="tel"
          onChange={(event) => setPhone(event.target.value)}
          placeholder="012-345 6789 or +country code"
          required
          type="tel"
          value={phone}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-gray-800">Password</span>
        <input
          autoComplete="new-password"
          className="mt-2 h-11 w-full rounded-md border border-[#cfd8e5] px-3 text-gray-950 outline-none focus:border-[#b8892c] focus:ring-2 focus:ring-[#b8892c]/20"
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-gray-800">
          Confirm password
        </span>
        <input
          autoComplete="new-password"
          className="mt-2 h-11 w-full rounded-md border border-[#cfd8e5] px-3 text-gray-950 outline-none focus:border-[#b8892c] focus:ring-2 focus:ring-[#b8892c]/20"
          minLength={8}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          type="password"
          value={confirmPassword}
        />
      </label>
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button
        className="h-11 w-full rounded-md bg-[#b8892c] px-5 text-sm font-semibold text-[#17130d] hover:bg-[#c99a3e] disabled:opacity-60"
        disabled={isLoading}
        type="submit"
      >
        {isLoading ? "Creating account..." : "Register"}
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
