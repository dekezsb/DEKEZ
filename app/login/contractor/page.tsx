import { BrandLogo } from "@/components/brand-logo";
import { PhoneSignInForm } from "@/app/phone-sign-in-form";

export default function ContractorLogin() {
  return <main className="min-h-dvh bg-[#f8f5ef] px-4 py-12 text-[#17130d]">
    <section className="mx-auto w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
      <BrandLogo size={54} /><h1 className="mt-5 text-2xl font-semibold">Contractor Portal</h1>
      <p className="mt-3 text-sm leading-6 text-gray-600">Sign in with your approved test phone number and temporary password. This is a read-only preview. No WhatsApp OTP is required.</p>
      <PhoneSignInForm contractorPreview />
    </section>
  </main>;
}
