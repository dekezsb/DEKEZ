import type { Metadata } from "next";
import {
  Archive,
  Building2,
  FileCheck2,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";

export const metadata: Metadata = {
  title: "DEKEZ Rental Management System",
  description:
    "DEKEZ helps authorised property teams manage rooms, tenancies, rent, maintenance and compliant document archives.",
};

const features = [
  {
    description:
      "Manage properties, rooms, tenant assignments and recurring tenancy information.",
    icon: Building2,
    title: "Rental operations",
  },
  {
    description:
      "Track rental invoices, verified payments, deposits and outstanding balances.",
    icon: FileCheck2,
    title: "Billing records",
  },
  {
    description:
      "Receive maintenance reports and coordinate authorised repair work.",
    icon: Wrench,
    title: "Maintenance",
  },
  {
    description:
      "Provide protected access for administrators, owners, staff and tenants.",
    icon: Users,
    title: "Role-based portals",
  },
];

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[#f2f4f7] text-[#17130d]">
      <header className="border-b border-[#2a2110] bg-[#090806] text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link className="flex items-center gap-3" href="/about">
            <BrandLogo className="rounded-md" priority size={50} />
            <span>
              <span className="block text-lg font-bold text-[#c99a3e]">
                DEKEZ
              </span>
              <span className="block text-xs text-[#d7c6a8]">
                Rental Management System
              </span>
            </span>
          </Link>
          <Link
            className="rounded-md border border-[#6f5a33] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1b1711]"
            href="/"
          >
            Sign in
          </Link>
        </div>
      </header>

      <section className="border-b border-[#d7dde5] bg-white">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <p className="text-sm font-semibold uppercase text-[#8a641d]">
            DEKEZ SDN BHD
          </p>
          <h1 className="mt-3 max-w-4xl text-4xl font-bold leading-tight text-[#111827] sm:text-5xl">
            DEKEZ Rental Management System
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-[#4b5563]">
            DEKEZ is a secure room-rental management application for authorised
            property administrators, owners, management teams, technicians and
            tenants. It centralises daily rental operations without providing
            public access to private property or tenant records.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <h2 className="text-2xl font-bold text-[#111827]">What DEKEZ does</h2>
        <div className="mt-6 grid gap-px overflow-hidden rounded-md border border-[#d7dde5] bg-[#d7dde5] sm:grid-cols-2">
          {features.map((feature) => {
            const Icon = feature.icon;

            return (
              <article className="bg-white p-6" key={feature.title}>
                <Icon className="h-6 w-6 text-[#9a711f]" aria-hidden="true" />
                <h3 className="mt-4 text-lg font-semibold text-[#111827]">
                  {feature.title}
                </h3>
                <p className="mt-2 leading-7 text-[#4b5563]">
                  {feature.description}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="border-y border-[#d7dde5] bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <div>
            <Archive className="h-7 w-7 text-[#9a711f]" aria-hidden="true" />
            <h2 className="mt-4 text-2xl font-bold text-[#111827]">
              Google Drive document archive
            </h2>
          </div>
          <div className="space-y-4 leading-7 text-[#4b5563]">
            <p>
              DEKEZ uses Google Drive only when an authorised DEKEZ
              administrator connects the company archive. The connection is
              used to organise and retain generated rental invoices, payment
              evidence, tenancy agreements, utility bills and approved expense
              records.
            </p>
            <p>
              DEKEZ does not read unrelated personal Drive content or sell
              Google user data. Archive access is limited to the operational
              documents and folders required by the connected DEKEZ account.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex items-start gap-4">
          <ShieldCheck
            className="mt-1 h-7 w-7 shrink-0 text-[#0f766e]"
            aria-hidden="true"
          />
          <div>
            <h2 className="text-2xl font-bold text-[#111827]">
              Privacy and access
            </h2>
            <p className="mt-3 max-w-3xl leading-7 text-[#4b5563]">
              Private records are protected by authentication, role-based
              permissions and company-level access controls. Only authorised
              users can enter the operational portals.
            </p>
            <div className="mt-5 flex flex-wrap gap-4 text-sm font-semibold">
              <Link className="text-[#8a641d] hover:underline" href="/privacy">
                Privacy Policy
              </Link>
              <Link className="text-[#8a641d] hover:underline" href="/terms">
                Terms of Service
              </Link>
              <a
                className="text-[#8a641d] hover:underline"
                href="mailto:dekezsdnbhd@gmail.com"
              >
                Contact DEKEZ
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#2a2110] bg-[#090806] text-[#d7c6a8]">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm sm:px-6">
          <p>DEKEZ SDN BHD - Company Registration No. 202501054747</p>
        </div>
      </footer>
    </main>
  );
}
