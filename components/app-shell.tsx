"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { BrandLogo } from "@/components/brand-logo";
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
  userName?: string | null;
};

export function AppShell({ children, role, userName }: AppShellProps) {
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
    <div className="min-h-screen bg-[#f2f4f7] text-[#17130d]">
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-72 -translate-x-full border-r border-[#211b11] bg-[#090806] text-[#f8f0df] transition-transform lg:translate-x-0",
          isOpen && "translate-x-0",
        )}
      >
        <div className="flex h-full flex-col">
          <div className="flex min-h-24 items-center justify-between border-b border-[#211b11] px-5 py-3">
            <Link href="/dashboard" className="flex items-center gap-3">
              <BrandLogo className="rounded-md" priority size={58} />
              <span>
                <span className="block text-lg font-bold text-[#c99a3e]">DEKEZ</span>
                <span className="block text-xs text-[#d7c6a8]">
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
                      ? "bg-[#2a2110] text-[#c99a3e]"
                      : "text-[#d9d1c2] hover:bg-[#18130b] hover:text-[#f8f0df]",
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

          <div className="border-t border-[#1b1711] p-4">
            <div className="rounded-md bg-[#15120d] p-4">
              <p className="text-sm font-semibold text-[#c99a3e]">DEKEZ</p>
              <p className="mt-1 text-xs leading-5 text-[#a99c85]">
                Rental Management System
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
        <header className="sticky top-0 z-20 border-b border-[#d7dde5] bg-white/95 backdrop-blur">
          <div className="flex h-20 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
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
                <p className="text-lg font-semibold">{currentPage}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-semibold text-gray-950">{userName ?? (role ? roleLabels[role] : "User")}</p>
                <p className="text-xs text-[#8a641d]">{role ? roleLabels[role] : "DEKEZ"}</p>
              </div>
              <form action="/logout" method="post">
                <Button className="border-[#cfd8e5] px-5" type="submit" variant="outline">
                  Logout
                </Button>
              </form>
            </div>
          </div>
        </header>

        <main className="min-h-[calc(100vh-80px)] px-4 py-8 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl pb-20 lg:pb-0">{children}</div>
        </main>
      </div>

      {navigation.length ? (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#1b1711] bg-[#090806] lg:hidden">
          <div className="grid grid-cols-4">
            {navigation.slice(0, 4).map((item) => {
              const Icon = item.icon;
              const isActive = pathname.startsWith(item.href);

              return (
                <Link
                  className={cn(
                    "flex min-h-16 flex-col items-center justify-center gap-1 px-2 text-xs font-medium",
                    isActive ? "text-[#c99a3e]" : "text-[#d9d1c2]",
                  )}
                  href={item.href}
                  key={item.href}
                >
                  <Icon className="h-5 w-5" />
                  <span className="max-w-full truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
