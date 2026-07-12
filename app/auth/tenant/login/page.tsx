import { Suspense } from "react";
import Link from "next/link";
import { TenantLoginForm } from "./tenant-login-form";

export default function TenantLoginPage() {
  return (
    <section className="w-full">
      <div className="mx-auto max-w-md">
        <p className="text-sm font-semibold uppercase tracking-normal text-[#126b5f]">
          Tenant access
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-normal text-gray-950">
          Tenant Login
        </h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          Login to view your tenancy, payments and maintenance requests.
        </p>
        <Suspense fallback={<p className="mt-8 text-sm text-gray-600">Loading...</p>}>
          <TenantLoginForm />
        </Suspense>
        <p className="mt-5 text-sm text-gray-600">
          New tenant?{" "}
          <Link className="font-semibold text-[#126b5f]" href="/auth/tenant/signup">
            Sign up here
          </Link>
        </p>
      </div>
    </section>
  );
}
