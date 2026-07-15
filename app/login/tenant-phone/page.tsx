import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PhoneLoginForm } from "./phone-login-form";

export default function TenantPhoneLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f7f9] px-4 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <p className="text-xs font-semibold uppercase text-[#126b5f]">Tenant Access</p>
          <CardTitle className="text-3xl">Login with WhatsApp / mobile</CardTitle>
          <CardDescription>
            Enter your number in international format. Example: +60123456789.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PhoneLoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
