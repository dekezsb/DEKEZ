"use client";

import { FormEvent, useState } from "react";

export function PhoneSignInForm() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/auth/sign-in", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone, password }),
      });
      const result = await response.json();

      if (!response.ok) {
        setError(result.error ?? "Unable to sign in.");
        return;
      }

      window.location.assign(result.redirectTo ?? "/dashboard");
    } catch {
      setError("Unable to sign in. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
      <label className="block">
        <span className="text-sm font-medium text-gray-800">Phone number</span>
        <input
          autoComplete="tel"
          className="mt-2 h-11 w-full rounded-md border border-[#cfd8e5] bg-white px-3 text-gray-950 outline-none transition focus:border-[#b8892c] focus:ring-2 focus:ring-[#b8892c]/20"
          inputMode="tel"
          onChange={(event) => setPhone(event.target.value)}
          placeholder="012-345 6789"
          required
          type="tel"
          value={phone}
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-800">
          PIN / password
        </span>
        <input
          autoComplete="current-password"
          className="mt-2 h-11 w-full rounded-md border border-[#cfd8e5] bg-white px-3 text-gray-950 outline-none transition focus:border-[#b8892c] focus:ring-2 focus:ring-[#b8892c]/20"
          inputMode="numeric"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Last 4 digits of your phone"
          required
          type="password"
          value={password}
        />
        <span className="mt-1.5 block text-xs leading-5 text-gray-500">
          New users use the last 4 digits of the registered phone number.
          Existing Admin accounts may continue with their current password.
        </span>
      </label>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        className="h-11 w-full rounded-md bg-[#b8892c] px-5 text-sm font-semibold text-[#17130d] shadow-sm transition hover:bg-[#c99a3e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b8892c] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isLoading}
        type="submit"
      >
        {isLoading ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
