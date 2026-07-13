"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { normalizeRole, roleHome, roleLabels, type AppRole } from "@/lib/auth/roles";

type LoginFormProps = {
  expectedRole: AppRole;
};

type AuthMode = "login" | "signup";

const selfSignupRoles: AppRole[] = ["owner", "tenant"];
const staffRoles: AppRole[] = ["technician", "maintenance_staff", "cleaning_staff"];

export function LoginForm({ expectedRole }: LoginFormProps) {
  const router = useRouter();
  const canSignUp = selfSignupRoles.includes(expectedRole);
  const [mode, setMode] = useState<AuthMode>("login");
  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [identificationNumber, setIdentificationNumber] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setMessage(null);

    if (mode === "signup") {
      await handleSignUp();
      return;
    }

    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !data.user) {
      setIsLoading(false);
      setError(signInError?.message ?? "Unable to login.");
      return;
    }

    const actualRole = normalizeRole(data.user.user_metadata?.role) ?? "tenant";

    if (actualRole === "super_admin") {
      router.push(roleHome.super_admin);
      router.refresh();
      return;
    }

    const isExpectedStaffLogin =
      expectedRole === "technician" && staffRoles.includes(actualRole);

    if (actualRole !== expectedRole && !isExpectedStaffLogin) {
      await supabase.auth.signOut();
      setIsLoading(false);
      setError(
        `This account is registered as ${roleLabels[actualRole]}, not ${roleLabels[expectedRole]}.`,
      );
      return;
    }

    router.push(roleHome[actualRole]);
    router.refresh();
  }

  async function handleSignUp() {
    if (!canSignUp) {
      setIsLoading(false);
      setError(`${roleLabels[expectedRole]} accounts must be created by an Owner or Admin.`);
      return;
    }

    if (password !== confirmPassword) {
      setIsLoading(false);
      setError("Password and confirm password do not match.");
      return;
    }

    const supabase = createClient();
    const emailRedirectTo = `${window.location.origin}/auth/callback`;
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo,
        data: {
          role: expectedRole,
          full_name: fullName,
          phone,
          ...(expectedRole === "owner" ? { business_name: businessName } : {}),
          ...(expectedRole === "tenant" && identificationNumber
            ? { identification_number: identificationNumber }
            : {}),
        },
      },
    });

    if (signUpError || !data.user) {
      setIsLoading(false);
      setError(signUpError?.message ?? "Unable to create account.");
      return;
    }

    if (!data.session) {
      setIsLoading(false);
      setMode("login");
      setPassword("");
      setConfirmPassword("");
      setMessage("Account created. Please check your email and click the verification link before logging in.");
      return;
    }

    router.push(roleHome[expectedRole]);
    router.refresh();
  }

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
    setMessage(null);
  }

  return (
    <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
      {canSignUp ? (
        <div className="grid grid-cols-2 rounded-md border border-[#d7dde5] bg-[#f4f6f8] p-1">
          <button
            className={`rounded px-3 py-2 text-sm font-semibold transition ${
              mode === "login"
                ? "bg-white text-gray-950 shadow-sm"
                : "text-gray-600 hover:text-gray-950"
            }`}
            type="button"
            onClick={() => switchMode("login")}
          >
            Login
          </button>
          <button
            className={`rounded px-3 py-2 text-sm font-semibold transition ${
              mode === "signup"
                ? "bg-white text-gray-950 shadow-sm"
                : "text-gray-600 hover:text-gray-950"
            }`}
            type="button"
            onClick={() => switchMode("signup")}
          >
            Sign up
          </button>
        </div>
      ) : (
        <p className="rounded-md border border-[#d7dde5] bg-[#f4f6f8] px-3 py-2 text-sm text-gray-600">
          {roleLabels[expectedRole]} accounts are created by an Owner or Admin.
        </p>
      )}

      {mode === "signup" ? (
        <>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Full name</span>
            <input
              className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
            />
          </label>
          {expectedRole === "owner" ? (
            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                Company or business name
              </span>
              <input
                className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                type="text"
                autoComplete="organization"
                value={businessName}
                onChange={(event) => setBusinessName(event.target.value)}
                required
              />
            </label>
          ) : null}
        </>
      ) : null}
      <label className="block">
        <span className="text-sm font-medium text-gray-700">Email</span>
        <input
          className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      {mode === "signup" ? (
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Phone number</span>
          <input
            className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            required
          />
        </label>
      ) : null}
      {mode === "signup" && expectedRole === "tenant" ? (
        <label className="block">
          <span className="text-sm font-medium text-gray-700">
            Identification number optional
          </span>
          <input
            className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
            type="text"
            value={identificationNumber}
            onChange={(event) => setIdentificationNumber(event.target.value)}
          />
        </label>
      ) : null}
      <label className="block">
        <span className="text-sm font-medium text-gray-700">Password</span>
        <input
          className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      {mode === "signup" ? (
        <label className="block">
          <span className="text-sm font-medium text-gray-700">
            Confirm password
          </span>
          <input
            className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </label>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {message ? <p className="text-sm text-[#126b5f]">{message}</p> : null}
      <button
        className="w-full rounded-md bg-[#126b5f] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0f5a50] disabled:cursor-not-allowed disabled:opacity-60"
        type="submit"
        disabled={isLoading}
      >
        {isLoading
          ? mode === "signup"
            ? "Creating account..."
            : "Signing in..."
          : mode === "signup"
            ? "Create account"
            : "Sign in"}
      </button>
    </form>
  );
}
