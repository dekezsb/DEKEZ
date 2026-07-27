import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { LoginForm } from "./role-login-form";
import { normalizeRole, roleLabels } from "@/lib/auth/roles";

type RoleLoginPageProps = {
  params: Promise<{
    role: string;
  }>;
};

export default async function RoleLoginPage({ params }: RoleLoginPageProps) {
  const { role: roleParam } = await params;
  const role = normalizeRole(roleParam);

  if (!role) {
    notFound();
  }

  return (
    <section className="min-h-screen border-t-4 border-[#b8892c] bg-[#080706] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-md">
        <BrandLogo className="mx-auto rounded-md" priority size={112} />
        <div className="mt-6 rounded-md border border-[#2b2316] bg-white p-6 shadow-xl">
          <p className="text-sm font-semibold uppercase text-[#8a641d]">
            {roleLabels[role]} access
          </p>
          <h1 className="mt-3 text-3xl font-bold text-gray-950">DEKEZ</h1>
          <p className="mt-1 text-lg font-semibold text-gray-800">
            Login to your account
          </p>
          <p className="mt-3 text-sm leading-6 text-gray-600">
            Your role is checked after login. Selecting this page does not grant
            permission.
          </p>
          <LoginForm expectedRole={role} />
        </div>
        <Link
          className="mx-auto mt-5 flex w-fit items-center gap-2 text-sm font-medium text-[#c99a3e] hover:text-white"
          href="/"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to login categories
        </Link>
      </div>
    </section>
  );
}
