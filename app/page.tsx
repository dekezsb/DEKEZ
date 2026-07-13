import Link from "next/link";
import { roleLabels, type AppRole } from "@/lib/auth/roles";

const loginCards: Array<{
  role: AppRole;
  description: string;
  action: string;
}> = [
  {
    role: "owner",
    description: "Create or access your owner account for portfolio operations.",
    action: "Login or sign up",
  },
  {
    role: "admin",
    description: "Manage daily room-rental operations and tenant activity.",
    action: "Continue to login",
  },
  {
    role: "technician",
    description: "View assigned repair work and update maintenance status.",
    action: "Continue to login",
  },
  {
    role: "tenant",
    description: "Create or access your tenant account for rental information.",
    action: "Login or sign up",
  },
];

type HomeProps = {
  searchParams: Promise<{
    verified?: string;
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const { verified } = await searchParams;

  return (
    <section className="flex min-h-screen items-center bg-[#f4f6f8] px-4 py-10">
      <div className="mx-auto w-full max-w-5xl">
        {verified === "1" ? (
          <div className="mb-6 rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
            Email verified successfully. Please choose your category and login.
          </div>
        ) : null}
        {verified === "0" ? (
          <div className="mb-6 rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
            Email verification failed or expired. Please try signing up again.
          </div>
        ) : null}
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase text-[#126b5f]">
            DEKEZ Rental Management System
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-normal text-gray-950 sm:text-5xl">
            Choose your login category
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-gray-600">
            This only opens the correct login screen. Your real permissions are
            verified from your Supabase account role after login.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {loginCards.map((card) => (
            <Link
              className="rounded-lg border border-[#d7dde5] bg-white p-5 shadow-sm transition hover:border-[#126b5f] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#126b5f] focus:ring-offset-2"
              href={`/login/${card.role}`}
              key={card.role}
            >
              <h2 className="text-lg font-semibold text-gray-950">
                {roleLabels[card.role]}
              </h2>
              <p className="mt-2 text-sm leading-6 text-gray-600">
                {card.description}
              </p>
              <p className="mt-4 text-sm font-semibold text-[#126b5f]">
                {card.action}
              </p>
            </Link>
          ))}
        </div>
        <div className="mt-6 text-center">
          <Link
            className="text-sm font-semibold text-[#126b5f] underline-offset-4 hover:underline"
            href="/login/super_admin"
          >
            Backend access
          </Link>
        </div>
      </div>
    </section>
  );
}
