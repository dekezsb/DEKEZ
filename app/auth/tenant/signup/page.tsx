import Link from "next/link";
import { TenantSignupForm } from "./tenant-signup-form";

export default function TenantSignupPage() {
  return (
    <section className="w-full">
      <div className="mx-auto max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-normal text-[#126b5f]">
          Tenant signup
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-normal text-gray-950">
          Create Tenant Account
        </h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          No document upload is required. Your room can be assigned later by the
          Owner or Admin Team.
        </p>
        <TenantSignupForm />
        <p className="mt-5 text-sm text-gray-600">
          Already have an account?{" "}
          <Link className="font-semibold text-[#126b5f]" href="/auth/tenant/login">
            Login here
          </Link>
        </p>
      </div>
    </section>
  );
}
