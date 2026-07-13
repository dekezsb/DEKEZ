"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  roleLabels,
  roleNavigation,
  type AppRole,
  type NavigationItem,
} from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: ReactNode;
  role: AppRole | null;
};

export function AppShell({ children, role }: AppShellProps) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const navigation: NavigationItem[] = role ? roleNavigation[role] : [];
  const currentPage =
    navigation.find((item) => pathname.startsWith(item.href))?.label ?? "DEKEZ";
  const isPublicPage = pathname === "/" || pathname.startsWith("/login");

  if (isPublicPage) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-[#f4f6f8] text-gray-950">
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-72 -translate-x-full border-r border-[#d7dde5] bg-white transition-transform lg:translate-x-0",
          isOpen && "translate-x-0",
        )}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center justify-between px-5">
            <Link href="/dashboard" className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#126b5f] text-sm font-bold text-white">
                D
              </span>
              <span>
                <span className="block text-lg font-bold">DEKEZ</span>
                <span className="block text-xs text-gray-500">
                  {role ? roleLabels[role] : "Rental SaaS"}
                </span>
              </span>
            </Link>
            <Button
              className="lg:hidden"
              size="icon"
              type="button"
              variant="ghost"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <nav className="flex flex-1 flex-col gap-1 px-4 py-3">
            {navigation.map((item) => {
              const Icon = item.icon;
              const isActive = pathname.startsWith(item.href);

              return (
                <Link
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition",
                    isActive
                      ? "bg-[#e7f2f0] text-[#126b5f]"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-950",
                  )}
                  href={item.href}
                  key={item.href}
                  onClick={() => setIsOpen(false)}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-[#d7dde5] p-4">
            <div className="rounded-lg bg-[#f4f6f8] p-4">
              <p className="text-sm font-semibold">Phase 2 Auth</p>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                Protected routes with role-aware navigation.
              </p>
            </div>
          </div>
        </div>
      </div>

      {isOpen ? (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-gray-950/30 lg:hidden"
          type="button"
          onClick={() => setIsOpen(false)}
        />
      ) : null}

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-[#d7dde5] bg-white/90 backdrop-blur">
          <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <Button
                className="lg:hidden"
                size="icon"
                type="button"
                variant="outline"
                onClick={() => setIsOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">
                  Current page
                </p>
                <p className="font-semibold">{currentPage}</p>
              </div>
            </div>
            <form action="/logout" method="post">
              <Button type="submit" variant="outline">
                Logout
              </Button>
            </form>
          </div>
        </header>

        <main className="min-h-[calc(100vh-64px)] px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
