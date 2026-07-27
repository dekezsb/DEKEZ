import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PhoneLoginForm } from "./phone-login-form";

export default function TenantPhoneLoginPage() {
  return (
    <main className="min-h-screen border-t-4 border-[#b8892c] bg-[#080706] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-lg">
        <BrandLogo className="mx-auto rounded-md" priority size={112} />
        <Card className="mt-6 border-[#2b2316] shadow-xl">
          <CardHeader>
            <p className="text-xs font-semibold uppercase text-[#8a641d]">Tenant Access</p>
            <CardTitle className="text-3xl">Login with WhatsApp / mobile</CardTitle>
            <CardDescription>
              Enter your number in international format. Example: +60123456789.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PhoneLoginForm />
          </CardContent>
        </Card>
        <Link
          className="mx-auto mt-5 flex w-fit items-center gap-2 text-sm font-medium text-[#c99a3e] hover:text-white"
          href="/"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to login categories
        </Link>
      </div>
    </main>
  );
}
