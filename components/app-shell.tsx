"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const navigation = [
  { label: "Dashboard", href: "/dashboard", initial: "D" },
  { label: "Properties", href: "/properties", initial: "P" },
  { label: "Rooms", href: "/rooms", initial: "R" },
  { label: "Tenants", href: "/tenants", initial: "T" },
  { label: "Settings", href: "/settings", initial: "S" },
];

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const currentPage =
    navigation.find((item) => pathname.startsWith(item.href))?.label ?? "Home";

  return (
    <div className="min-h-screen bg-[#f4f6f8] text-gray-950">
      <aside className="border-b border-[#d7dde5] bg-white lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:w-72 lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-3 px-5 py-5 lg:px-6">
            <Link href="/" className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#126b5f] text-sm font-bold text-white">
                D
              </span>
              <span>
                <span className="block text-lg font-bold tracking-normal text-gray-950">
                  DEKEZ
                </span>
                <span className="block text-xs font-medium text-gray-500">
                  Rental Management
                </span>
              </span>
            </Link>
          </div>

          <nav
            aria-label="Main navigation"
            className="flex gap-2 overflow-x-auto px-5 pb-4 lg:flex-1 lg:flex-col lg:overflow-visible lg:px-4 lg:py-3"
          >
            {navigation.map((item) => {
              const isActive = pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex min-w-fit items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-[#126b5f] focus:ring-offset-2 ${
                    isActive
                      ? "bg-[#e7f2f0] text-[#126b5f]"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-950"
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold ${
                      isActive
                        ? "bg-[#126b5f] text-white"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {item.initial}
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden border-t border-[#d7dde5] p-4 lg:block">
            <div className="rounded-lg bg-[#f4f6f8] p-4">
              <p className="text-sm font-semibold text-gray-950">Phase 1</p>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                Supabase foundation and protected pages are active.
              </p>
            </div>
          </div>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-[#d7dde5] bg-white/90 backdrop-blur">
          <div className="flex min-h-16 items-center justify-between gap-4 px-5 lg:px-8">
            <div>
              <p className="text-xs font-medium uppercase tracking-normal text-gray-500">
                Current page
              </p>
              <p className="text-base font-semibold text-gray-950">{currentPage}</p>
            </div>

            <form action="/logout" method="post">
              <button
                type="submit"
                className="rounded-md border border-[#d7dde5] bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-[#126b5f] hover:text-[#126b5f] focus:outline-none focus:ring-2 focus:ring-[#126b5f] focus:ring-offset-2"
              >
                Logout
              </button>
            </form>
          </div>
        </header>

        <main className="min-h-[calc(100vh-64px)] px-5 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
