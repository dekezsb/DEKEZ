"use client";

import { useActionState } from "react";
import { tenantSignupAction, type TenantSignupState } from "../actions";

const initialState: TenantSignupState = {
  ok: false,
  message: "",
};

export function TenantSignupForm() {
  const [state, action, isPending] = useActionState(
    tenantSignupAction,
    initialState,
  );

  return (
    <form action={action} className="mt-8 grid gap-4 sm:grid-cols-2">
      <label className="block sm:col-span-2">
        <span className="text-sm font-medium text-gray-700">Full name</span>
        <input
          className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
          name="full_name"
          autoComplete="name"
          required
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-gray-700">Email</span>
        <input
          className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-gray-700">Phone number</span>
        <input
          className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
          name="phone"
          type="tel"
          autoComplete="tel"
          required
        />
      </label>
      <label className="block sm:col-span-2">
        <span className="text-sm font-medium text-gray-700">
          Identification number optional
        </span>
        <input
          className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
          name="identity_number"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-gray-700">Password</span>
        <input
          className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={6}
          required
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-gray-700">Confirm password</span>
        <input
          className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          minLength={6}
          required
        />
      </label>
      {state.message ? (
        <p className={`text-sm sm:col-span-2 ${state.ok ? "text-[#126b5f]" : "text-red-600"}`}>
          {state.message}
        </p>
      ) : null}
      <button
        className="rounded-md bg-[#126b5f] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0f5a50] disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-2"
        type="submit"
        disabled={isPending}
      >
        {isPending ? "Creating account..." : "Create tenant account"}
      </button>
    </form>
  );
}
