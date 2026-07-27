import {
  BarChart3,
  Building2,
  CalendarClock,
  Droplets,
  ClipboardList,
  CreditCard,
  FileSignature,
  LayoutDashboard,
  ReceiptText,
  ShieldCheck,
  Settings,
  UserCog,
  Wrench,
  type LucideIcon,
} from "lucide-react";

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
};

const adminNavigation: NavigationItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Admin Setup", href: "/admin-setup", icon: UserCog },
  { label: "Properties", href: "/properties", icon: Building2 },
  { label: "Verification", href: "/verification", icon: ShieldCheck },
  { label: "Rent Due Tracker", href: "/rent-due-tracker", icon: CalendarClock },
  { label: "Utility Bills", href: "/utility-bills", icon: Droplets },
  { label: "Expense Bills", href: "/expenses", icon: ReceiptText },
  { label: "Maintenance", href: "/maintenance", icon: Wrench },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Settings", href: "/settings", icon: Settings },
];

export const roleLabels: Record<AppRole, string> = {
  super_admin: "Super Admin",
  owner: "Owner",
  admin: "Admin Team",
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
    { label: "Super Admin", href: "/super-admin", icon: ShieldCheck },
    ...adminNavigation,
  ],
  owner: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Properties", href: "/properties", icon: Building2 },
    { label: "Payments", href: "/payments", icon: CreditCard },
    { label: "Rent Due Tracker", href: "/rent-due-tracker", icon: CalendarClock },
    { label: "Tenancy Agreements", href: "/e-tenancy", icon: FileSignature },
    { label: "Utility Bills", href: "/utility-bills", icon: Droplets },
    { label: "Expense Bills", href: "/expenses", icon: ReceiptText },
    { label: "Maintenance", href: "/maintenance", icon: Wrench },
    { label: "Claims", href: "/claims", icon: ClipboardList },
    { label: "Reports", href: "/reports", icon: BarChart3 },
    { label: "Settings", href: "/settings", icon: Settings },
  ],
  admin: adminNavigation.filter((item) => item.href !== "/settings"),
  technician: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Maintenance", href: "/maintenance", icon: Wrench },
    { label: "Expense Bills", href: "/expenses", icon: ReceiptText },
    { label: "Claims", href: "/claims", icon: ClipboardList },
  ],
  maintenance_staff: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Maintenance", href: "/maintenance", icon: Wrench },
    { label: "Expense Bills", href: "/expenses", icon: ReceiptText },
    { label: "Claims", href: "/claims", icon: ClipboardList },
  ],
  cleaning_staff: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Maintenance", href: "/maintenance", icon: Wrench },
    { label: "Expense Bills", href: "/expenses", icon: ReceiptText },
    { label: "Claims", href: "/claims", icon: ClipboardList },
  ],
  tenant: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Onboarding", href: "/onboarding", icon: UserCog },
    { label: "My Tenancy Agreement", href: "/e-tenancy", icon: FileSignature },
    { label: "Payments", href: "/payments", icon: CreditCard },
    { label: "Maintenance", href: "/maintenance", icon: Wrench },
  ],
};

export const protectedRoutes = [
  "/dashboard",
  "/admin-setup",
  "/register-tenant",
  "/properties",
  "/rooms",
  "/tenants",
  "/verification",
  "/tenant-verification",
  "/payments",
  "/payment-verification",
  "/rent-due-tracker",
  "/onboarding",
  "/e-tenancy",
  "/utility-bills",
  "/expenses",
  "/maintenance",
  "/claims",
  "/reports",
  "/settings",
  "/setup",
  "/super-admin",
];

export function normalizeRole(value: unknown): AppRole | null {
  return appRoles.find((role) => role === value) ?? null;
}
