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
  userName?: string | null;
};

const backendRoles: Array<AppRole> = ["super_admin", "owner", "admin"];

export function AppShell({ children, role, userName }: AppShellProps) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const navigation: NavigationItem[] = role ? roleNavigation[role] : [];
  const currentPage =
    navigation.find((item) => pathname.startsWith(item.href))?.label ?? "DEKEZ";
  const isPublicPage = pathname === "/" || pathname.startsWith("/login");
  const isBackend = role ? backendRoles.includes(role) : false;

  if (isPublicPage) {
    return <>{children}</>;
  }

  return (
    <div className={cn("min-h-screen text-[#0b1733]", isBackend ? "bg-[#eef3f9]" : "bg-[#f4f6f8]")}>
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-72 -translate-x-full transition-transform lg:translate-x-0",
          isBackend
            ? "border-r border-[#18130b] bg-[#090806] text-[#f8f0df]"
            : "border-r border-[#d7dde5] bg-white",
          isOpen && "translate-x-0",
        )}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-20 items-center justify-between px-5">
            <Link href="/dashboard" className="flex items-center gap-3">
              <span className={cn(
                "flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold",
                isBackend ? "bg-black text-[#c4942e] ring-1 ring-[#2c2417]" : "bg-[#126b5f] text-white",
              )}>
                {isBackend ? "DK" : "D"}
              </span>
              <span>
                <span className={cn("block text-lg font-bold tracking-wide", isBackend && "text-[#c4942e]")}>DEKEZ</span>
                <span className={cn("block text-xs", isBackend ? "text-[#d7c6a8]" : "text-gray-500")}>
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
                    isBackend
                      ? isActive
                        ? "bg-[#2a2110] text-[#c4942e]"
                        : "text-[#d9d1c2] hover:bg-[#18130b] hover:text-[#f8f0df]"
                      : isActive
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

          <div className={cn("border-t p-4", isBackend ? "border-[#1b1711]" : "border-[#d7dde5]")}>
            <div className={cn("rounded-lg p-4", isBackend ? "bg-[#15120d]" : "bg-[#f4f6f8]")}>
              <p className="text-sm font-semibold">Phase 2 Auth</p>
              <p className={cn("mt-1 text-xs leading-5", isBackend ? "text-[#a99c85]" : "text-gray-500")}>
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
                <p className="text-xs text-[#496386]">{role ? roleLabels[role] : "DEKEZ"}</p>
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
        <nav className={cn("fixed inset-x-0 bottom-0 z-30 border-t lg:hidden", isBackend ? "border-[#1b1711] bg-[#090806]" : "border-[#d7dde5] bg-white")}>
          <div className="grid grid-cols-4">
            {navigation.slice(0, 4).map((item) => {
              const Icon = item.icon;
              const isActive = pathname.startsWith(item.href);

              return (
                <Link
                  className={cn(
                    "flex min-h-16 flex-col items-center justify-center gap-1 px-2 text-xs font-medium",
                    isBackend
                      ? isActive ? "text-[#c4942e]" : "text-[#d9d1c2]"
                      : isActive ? "text-[#126b5f]" : "text-gray-500",
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
