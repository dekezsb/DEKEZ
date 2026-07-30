import {
  BarChart3,
  Building2,
  CalendarClock,
  CircleUserRound,
  Droplets,
  CreditCard,
  FileSignature,
  FileText,
  House,
  LayoutDashboard,
  ReceiptText,
  ShieldCheck,
  Settings,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { AccessModule } from "./access";

export const appRoles = [
  "super_admin",
  "owner",
  "admin",
  "technician",
  "maintenance_staff",
  "cleaning_staff",
  "tenant",
] as const;

export type AppRole = (typeof appRoles)[number];

export type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  module: AccessModule;
};

const adminNavigation: NavigationItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "dashboard" },
  { label: "Admin Settings", href: "/admin-setup", icon: Settings, module: "admin_setup" },
  { label: "Properties", href: "/properties", icon: Building2, module: "properties" },
  { label: "Verification", href: "/verification", icon: ShieldCheck, module: "verification" },
  { label: "Rent Due Tracker", href: "/rent-due-tracker", icon: CalendarClock, module: "rent_due_tracker" },
  { label: "Rental Invoices", href: "/rental-invoices", icon: FileText, module: "rent_due_tracker" },
  { label: "Tenancy Agreements", href: "/tenancy-agreements", icon: FileSignature, module: "tenancy_agreements" },
  { label: "Utility Bills", href: "/utility-bills", icon: Droplets, module: "utility_bills" },
  { label: "Expense Bills", href: "/expenses", icon: ReceiptText, module: "expenses" },
  { label: "Maintenance", href: "/maintenance", icon: Wrench, module: "maintenance" },
  { label: "Reports", href: "/reports", icon: BarChart3, module: "reports" },
];

const managementNavigation: NavigationItem[] = [
  { label: "Home", href: "/dashboard", icon: House, module: "dashboard" },
  { label: "Maintenance", href: "/maintenance", icon: Wrench, module: "maintenance" },
  { label: "Verification", href: "/verification", icon: ShieldCheck, module: "verification" },
  { label: "Claims", href: "/claims", icon: ReceiptText, module: "claims" },
  { label: "Profile", href: "/staff/profile", icon: CircleUserRound, module: "dashboard" },
];

export const roleLabels: Record<AppRole, string> = {
  super_admin: "Super Admin",
  owner: "Owner",
  admin: "Management",
  technician: "Maintenance & Cleaning Team",
  maintenance_staff: "Maintenance Team",
  cleaning_staff: "Cleaning Team",
  tenant: "Tenant",
};

export const roleHome: Record<AppRole, string> = {
  super_admin: "/super-admin",
  owner: "/dashboard",
  admin: "/dashboard",
  technician: "/dashboard",
  maintenance_staff: "/dashboard",
  cleaning_staff: "/dashboard",
  tenant: "/dashboard",
};

export const roleNavigation: Record<AppRole, NavigationItem[]> = {
  super_admin: [
    { label: "Super Admin", href: "/super-admin", icon: ShieldCheck, module: "dashboard" },
    ...adminNavigation,
  ],
  owner: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "dashboard" },
    { label: "Properties", href: "/properties", icon: Building2, module: "properties" },
    { label: "Payments", href: "/payments", icon: CreditCard, module: "payments" },
    { label: "Rent Due Tracker", href: "/rent-due-tracker", icon: CalendarClock, module: "rent_due_tracker" },
    { label: "Rental Invoices", href: "/rental-invoices", icon: FileText, module: "rent_due_tracker" },
    { label: "Tenancy Agreements", href: "/tenancy-agreements", icon: FileSignature, module: "tenancy_agreements" },
    { label: "Utility Bills", href: "/utility-bills", icon: Droplets, module: "utility_bills" },
    { label: "Expense Bills", href: "/expenses", icon: ReceiptText, module: "expenses" },
    { label: "Maintenance", href: "/maintenance", icon: Wrench, module: "maintenance" },
    { label: "Reports", href: "/reports", icon: BarChart3, module: "reports" },
    { label: "Settings", href: "/settings", icon: Settings, module: "settings" },
  ],
  admin: managementNavigation,
  technician: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "dashboard" },
    { label: "Maintenance", href: "/maintenance", icon: Wrench, module: "maintenance" },
    { label: "Expense Bills", href: "/expenses", icon: ReceiptText, module: "expenses" },
  ],
  maintenance_staff: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "dashboard" },
    { label: "Maintenance", href: "/maintenance", icon: Wrench, module: "maintenance" },
    { label: "Expense Bills", href: "/expenses", icon: ReceiptText, module: "expenses" },
  ],
  cleaning_staff: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "dashboard" },
    { label: "Maintenance", href: "/maintenance", icon: Wrench, module: "maintenance" },
    { label: "Expense Bills", href: "/expenses", icon: ReceiptText, module: "expenses" },
  ],
  tenant: [
    { label: "Home", href: "/dashboard", icon: House, module: "dashboard" },
    { label: "Maintenance", href: "/maintenance", icon: Wrench, module: "maintenance" },
    { label: "Bills", href: "/payments", icon: ReceiptText, module: "payments" },
    { label: "Profile", href: "/tenant/profile", icon: CircleUserRound, module: "dashboard" },
  ],
};

export const protectedRoutes = [
  "/dashboard",
  "/admin-setup",
  "/register-tenant",
  "/properties",
  "/rooms",
  "/tenants",
  "/tenant",
  "/verification",
  "/tenant-verification",
  "/payments",
  "/payment-verification",
  "/rent-due-tracker",
  "/rental-invoices",
  "/invoices",
  "/onboarding",
  "/e-tenancy",
  "/tenancy-agreements",
  "/utility-bills",
  "/expenses",
  "/maintenance",
  "/claims",
  "/reports",
  "/settings",
  "/staff",
  "/setup",
  "/super-admin",
];

export function normalizeRole(value: unknown): AppRole | null {
  return appRoles.find((role) => role === value) ?? null;
}
