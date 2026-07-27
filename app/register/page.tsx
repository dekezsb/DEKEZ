import { BrandLogo } from "@/components/brand-logo";
import { RegistrationForm } from "./registration-form";

export default function RegisterPage() {
  return (
    <main className="min-h-screen border-t-4 border-[#b8892c] bg-[#080706] px-4 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-sm">
        <div className="flex items-center justify-center gap-3">
          <BrandLogo className="rounded-md" priority size={54} />
          <div>
            <p className="text-lg font-bold text-[#c99a3e]">DEKEZ</p>
            <p className="text-sm text-[#d7c6a8]">New user</p>
          </div>
        </div>

        <section className="mt-6 rounded-md bg-white p-6 shadow-xl sm:p-8">
          <h1 className="text-2xl font-semibold text-[#111827]">Register</h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            Use Malaysian 01x format or an international number with country
            code. An Admin will assign your DEKEZ permission after registration.
          </p>
          <RegistrationForm />
        </section>
      </div>
    </main>
  );
}
