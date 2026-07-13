import Link from "next/link";
import { roleLabels, type AppRole } from "@/lib/auth/roles";

const loginCards: Array<{
  role: AppRole;
  description: string;
}> = [
  {
    role: "owner",
    description: "Access portfolio, rooms, rent collection and reports.",
  },
  {
    role: "admin",
    description: "Manage daily room-rental operations and tenant activity.",
  },
  {
    role: "technician",
    description: "View assigned repair work and update maintenance status.",
  },
  {
    role: "tenant",
    description: "View rental details, payment history and maintenance requests.",
  },
];

export default function Home() {
  return (
    <section className="flex min-h-screen items-center bg-[#f4f6f8] px-4 py-10">
      <div className="mx-auto w-full max-w-5xl">
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
                Continue to login
              </p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
