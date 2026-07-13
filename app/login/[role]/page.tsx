import { notFound } from "next/navigation";
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
    <section className="flex min-h-screen items-center bg-[#f4f6f8] px-4 py-10">
      <div className="mx-auto w-full max-w-md rounded-lg border border-[#d7dde5] bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase text-[#126b5f]">
          {roleLabels[role]} access
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-normal text-gray-950">
          Login to DEKEZ
        </h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          Your role is checked after login. Selecting this page does not grant
          permission.
        </p>
        <LoginForm expectedRole={role} />
      </div>
    </section>
  );
}
