import {
  BarChart3,
  Building2,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  Settings,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export const appRoles = ["owner", "admin", "technician", "tenant"] as const;

export type AppRole = (typeof appRoles)[number];

export type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

const adminNavigation: NavigationItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Properties", href: "/properties", icon: Building2 },
  { label: "Rooms", href: "/rooms", icon: ClipboardList },
  { label: "Tenants", href: "/tenants", icon: Users },
  { label: "Payments", href: "/payments", icon: CreditCard },
  { label: "Maintenance", href: "/maintenance", icon: Wrench },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Settings", href: "/settings", icon: Settings },
];

export const roleLabels: Record<AppRole, string> = {
  owner: "Owner",
  admin: "Admin Team",
  technician: "Technician Team",
  tenant: "Tenant",
};

export const roleHome: Record<AppRole, string> = {
  owner: "/dashboard",
  admin: "/dashboard",
  technician: "/maintenance",
  tenant: "/dashboard",
};

export const roleNavigation: Record<AppRole, NavigationItem[]> = {
  owner: adminNavigation,
  admin: adminNavigation.filter((item) => item.href !== "/settings"),
  technician: [
    { label: "Maintenance", href: "/maintenance", icon: Wrench },
  ],
  tenant: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Payments", href: "/payments", icon: CreditCard },
    { label: "Maintenance", href: "/maintenance", icon: Wrench },
  ],
};

export const protectedRoutes = [
  "/dashboard",
  "/properties",
  "/rooms",
  "/tenants",
  "/payments",
  "/maintenance",
  "/reports",
  "/settings",
];

export function normalizeRole(value: unknown): AppRole | null {
  return appRoles.find((role) => role === value) ?? null;
}
