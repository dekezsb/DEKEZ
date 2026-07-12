import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginShell />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginShell() {
  return (
    <section className="w-full">
      <div className="max-w-md">
        <p className="text-sm font-semibold uppercase tracking-normal text-[#126b5f]">
          Secure access
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-normal text-gray-950">
          Admin Login
        </h1>
        <p className="mt-8 text-sm text-gray-600">Loading...</p>
      </div>
    </section>
  );
}
