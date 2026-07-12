"use client";

import { useActionState } from "react";
import {
  createCompanyAction,
  createCompanyUserAction,
  type ActionState,
} from "./actions";

type CompanyOption = {
  id: string;
  name: string;
};

type SettingsFormsProps = {
  canCreateCompany: boolean;
  companies: CompanyOption[];
};

const initialState: ActionState = {
  ok: false,
  message: "",
};

export function SettingsForms({ canCreateCompany, companies }: SettingsFormsProps) {
  const [companyState, createCompany, isCreatingCompany] = useActionState(
    createCompanyAction,
    initialState,
  );
  const [userState, createUser, isCreatingUser] = useActionState(
    createCompanyUserAction,
    initialState,
  );

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {canCreateCompany ? (
        <section className="rounded-lg border border-[#d7dde5] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-950">Create company</h2>
          <p className="mt-1 text-sm text-gray-500">
            Add a company account for an owner or rental business.
          </p>
          <form action={createCompany} className="mt-5 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Company name</span>
              <input
                className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                name="name"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                Registration number
              </span>
              <input
                className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                name="registration_number"
              />
            </label>
            {companyState.message ? (
              <p className={`text-sm ${companyState.ok ? "text-[#126b5f]" : "text-red-600"}`}>
                {companyState.message}
              </p>
            ) : null}
            <button
              className="rounded-md bg-[#126b5f] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f5a50] disabled:opacity-60"
              disabled={isCreatingCompany}
              type="submit"
            >
              {isCreatingCompany ? "Creating..." : "Create company"}
            </button>
          </form>
        </section>
      ) : null}

      <section className="rounded-lg border border-[#d7dde5] bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-950">Create company user</h2>
        <p className="mt-1 text-sm text-gray-500">
          Create an owner, admin, technician, or tenant login and assign a company.
        </p>
        <form action={createUser} className="mt-5 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Company</span>
            <select
              className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
              name="company_id"
              required
            >
              <option value="">Select company</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Full name</span>
            <input
              className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
              name="full_name"
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Email</span>
            <input
              className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
              name="email"
              type="email"
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Temporary password</span>
            <input
              className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
              name="password"
              type="password"
              minLength={6}
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Role</span>
            <select
              className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
              name="role"
              required
            >
              <option value="owner">Owner</option>
              <option value="admin_team">Admin Team</option>
              <option value="technician_team">Technician Team</option>
              <option value="tenant">Tenant</option>
            </select>
          </label>
          {userState.message ? (
            <p className={`text-sm ${userState.ok ? "text-[#126b5f]" : "text-red-600"}`}>
              {userState.message}
            </p>
          ) : null}
          <button
            className="rounded-md bg-[#126b5f] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f5a50] disabled:opacity-60"
            disabled={isCreatingUser || companies.length === 0}
            type="submit"
          >
            {isCreatingUser ? "Creating..." : "Create user"}
          </button>
        </form>
      </section>
    </div>
  );
}
