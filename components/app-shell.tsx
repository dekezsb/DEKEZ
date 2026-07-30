"use client";

import { LogOut, Menu, X } from "lucide-react";
import { Link } from "@/components/app-link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { LanguageSelector } from "@/components/language-selector";
import { useLanguage } from "@/components/language-provider";
import { PortalLiveSync } from "@/components/portal-live-sync";
import { Button } from "@/components/ui/button";
import { hasModuleAccess, type UserAccess } from "@/lib/auth/access";
import {
  roleNavigation,
  type AppRole,
  type NavigationItem,
} from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n";

type AppShellProps = {
  children: ReactNode;
  access: UserAccess | null;
  role: AppRole | null;
  userName?: string | null;
};

export function AppShell({ access, children, role, userName }: AppShellProps) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const navigation: NavigationItem[] =
    role && access
      ? roleNavigation[role].filter((item) =>
          hasModuleAccess(access, item.module),
        )
      : [];
  const currentPage =
    navigation.find((item) => pathname.startsWith(item.href))?.label;
  const currentPageLabel = currentPage
    ? t(navigationTranslationKeys[currentPage] ?? "nav.dashboard")
    : "DEKEZ";
  const isPublicPage =
    pathname === "/" ||
    pathname === "/about" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/register" ||
    pathname === "/reset-password" ||
    pathname === "/registration-status" ||
    pathname.startsWith("/login");

  if (isPublicPage) {
    return <>{children}</>;
  }

  if (pathname.startsWith("/invoices/")) {
    return <>{children}</>;
  }

  if (role === "tenant") {
    return (
      <div className="tenant-portal-bg min-h-screen text-[#17130d]">
        <PortalLiveSync />
        <header className="sticky top-0 z-20 border-b border-[#28231b] bg-[#090806] text-white shadow-sm print:hidden">
          <div className="mx-auto flex h-18 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
            <Link className="flex items-center gap-3" href="/dashboard">
              <BrandLogo className="rounded-md" priority size={46} />
              <span>
                <span className="block text-base font-bold text-[#c99a3e]">
                  DEKEZ
                </span>
                <span className="block text-xs text-[#d7c6a8]">
                  {t("portal.tenant")}
                </span>
              </span>
            </Link>
            <div className="flex items-center gap-3">
              <LanguageSelector dark />
              <p className="hidden max-w-56 truncate text-sm font-medium sm:block">
                {userName ?? t("role.tenant")}
              </p>
              <form action="/logout" method="post">
                <Button
                  aria-label={t("common.logout")}
                  className="border-[#4a4031] bg-transparent text-[#f8f0df] hover:bg-[#1b1711]"
                  size="icon"
                  title={t("common.logout")}
                  type="submit"
                  variant="outline"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </div>
        </header>

        <main className="mx-auto min-h-[calc(100vh-72px)] max-w-5xl px-4 py-6 pb-28 sm:px-6 sm:py-8">
          {children}
        </main>

        <nav
          aria-label="Tenant portal"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-[#d8c28c] bg-white/95 shadow-[0_-8px_24px_rgba(23,19,13,0.08)] backdrop-blur print:hidden"
        >
          <div className="mx-auto grid max-w-2xl grid-cols-4">
            {navigation.map((item) => {
              const Icon = item.icon;
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));

              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-20 min-w-0 flex-col items-center justify-center gap-1 px-1 text-[11px] font-semibold transition sm:text-xs",
                    isActive
                      ? "text-[#ef5c5c]"
                      : "text-[#17130d] hover:text-[#8a641d]",
                  )}
                  href={item.href}
                  key={item.href}
                >
                  <Icon className="h-7 w-7" strokeWidth={1.8} />
                  <span className="max-w-full truncate">
                    {t(navigationTranslationKeys[item.label] ?? "nav.dashboard")}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    );
  }

  if (role === "admin") {
    return (
      <div className="tenant-portal-bg min-h-screen text-[#17130d]">
        <PortalLiveSync />
        <header className="sticky top-0 z-20 border-b border-[#28231b] bg-[#090806] text-white shadow-sm print:hidden">
          <div className="mx-auto flex h-18 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
            <Link className="flex items-center gap-3" href="/dashboard">
              <BrandLogo className="rounded-md" priority size={46} />
              <span>
                <span className="block text-base font-bold text-[#c99a3e]">
                  DEKEZ
                </span>
                <span className="block text-xs text-[#d7c6a8]">
                  {t("portal.management")}
                </span>
              </span>
            </Link>
            <div className="flex items-center gap-3">
              <LanguageSelector dark />
              <p className="hidden max-w-56 truncate text-sm font-medium sm:block">
                {userName ?? t("role.management")}
              </p>
              <form action="/logout" method="post">
                <Button
                  aria-label={t("common.logout")}
                  className="border-[#4a4031] bg-transparent text-[#f8f0df] hover:bg-[#1b1711]"
                  size="icon"
                  title={t("common.logout")}
                  type="submit"
                  variant="outline"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </div>
        </header>

        <main className="mx-auto min-h-[calc(100vh-72px)] max-w-6xl px-4 py-6 pb-28 sm:px-6 sm:py-8">
          {children}
        </main>

        <nav
          aria-label="Management portal"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-[#d8c28c] bg-white/95 shadow-[0_-8px_24px_rgba(23,19,13,0.08)] backdrop-blur print:hidden"
        >
          <div className="mx-auto grid max-w-3xl grid-cols-5">
            {navigation.map((item) => {
              const Icon = item.icon;
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));

              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-20 min-w-0 flex-col items-center justify-center gap-1 px-1 text-[10px] font-semibold transition sm:text-xs",
                    isActive
                      ? "text-[#ef5c5c]"
                      : "text-[#17130d] hover:text-[#8a641d]",
                  )}
                  href={item.href}
                  key={item.href}
                >
                  <Icon className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={1.8} />
                  <span className="max-w-full truncate">
                    {t(navigationTranslationKeys[item.label] ?? "nav.dashboard")}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f2f4f7] text-[#17130d]">
      <PortalLiveSync />
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
                  {role ? t(roleTranslationKeys[role]) : "Rental SaaS"}
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
                  {t(navigationTranslationKeys[item.label] ?? "nav.dashboard")}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-[#1b1711] p-4">
            <div className="rounded-md bg-[#15120d] p-4">
              <p className="text-sm font-semibold text-[#c99a3e]">DEKEZ</p>
              <p className="mt-1 text-xs leading-5 text-[#a99c85]">
                {t("portal.rental")}
              </p>
            </div>
          </div>
        </div>
      </div>

      {isOpen ? (
        <button
          aria-label={t("common.closeNavigation")}
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
                  {t("common.currentPage")}
                </p>
                <p className="text-lg font-semibold">{currentPageLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {role !== "super_admin" ? <LanguageSelector /> : null}
              <div className="hidden text-right sm:block">
                <p className="text-sm font-semibold text-gray-950">{userName ?? (role ? t(roleTranslationKeys[role]) : "User")}</p>
                <p className="text-xs text-[#8a641d]">{role ? t(roleTranslationKeys[role]) : "DEKEZ"}</p>
              </div>
              <form action="/logout" method="post">
                <Button className="border-[#cfd8e5] px-5" type="submit" variant="outline">
                  {t("common.logout")}
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
                  <span className="max-w-full truncate">
                    {t(navigationTranslationKeys[item.label] ?? "nav.dashboard")}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      ) : null}
    </div>
  );
}

const navigationTranslationKeys: Record<string, TranslationKey> = {
  "Super Admin": "nav.superAdmin",
  Dashboard: "nav.dashboard",
  Home: "nav.home",
  "Admin Settings": "nav.adminSettings",
  Properties: "nav.properties",
  Verification: "nav.verification",
  "Rent Due Tracker": "nav.rentDueTracker",
  "Rental Invoices": "nav.rentalInvoices",
  "Tenancy Agreements": "nav.tenancyAgreements",
  "Utility Bills": "nav.utilityBills",
  "Expense Bills": "nav.expenseBills",
  Maintenance: "nav.maintenance",
  Reports: "nav.reports",
  Payments: "nav.payments",
  Settings: "nav.settings",
  Claims: "nav.claims",
  Profile: "nav.profile",
  Bills: "nav.bills",
};

const roleTranslationKeys: Record<AppRole, TranslationKey> = {
  super_admin: "role.superAdmin",
  owner: "role.owner",
  admin: "role.management",
  technician: "role.technician",
  maintenance_staff: "role.maintenance",
  cleaning_staff: "role.cleaning",
  tenant: "role.tenant",
};
