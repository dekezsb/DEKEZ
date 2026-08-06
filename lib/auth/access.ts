import type { AppRole } from "./roles";

export const accessLevels = ["none", "view", "manage"] as const;
export type AccessLevel = (typeof accessLevels)[number];

export const accessModules = [
  "dashboard",
  "admin_setup",
  "properties",
  "verification",
  "payments",
  "rent_due_tracker",
  "tenancy_agreements",
  "utility_bills",
  "expenses",
  "maintenance",
  "claims",
  "reports",
  "settings",
  "onboarding",
] as const;

export type AccessModule = (typeof accessModules)[number];
export type UserAccess = Record<AccessModule, AccessLevel>;

export const accessModuleDetails: Array<{
  key: AccessModule;
  label: string;
  description: string;
}> = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "Summary counts and assigned operational information.",
  },
  {
    key: "admin_setup",
    label: "User Administration",
    description: "User profiles, roles, permissions and company setup.",
  },
  {
    key: "properties",
    label: "Properties & Rooms",
    description: "Properties, rooms, tenants and tenancy assignments.",
  },
  {
    key: "verification",
    label: "Verification",
    description: "Registrations, payment slips, claims and tenancy progress.",
  },
  {
    key: "payments",
    label: "Payments",
    description: "Rent payments, payment history and proof submissions.",
  },
  {
    key: "rent_due_tracker",
    label: "Rent Due Tracker",
    description: "Upcoming, due and overdue rent bills.",
  },
  {
    key: "tenancy_agreements",
    label: "Tenancy Agreements",
    description: "Generate, send, sign and review tenancy agreements.",
  },
  {
    key: "utility_bills",
    label: "Utility Bills",
    description: "Property water, electricity and other utility bills.",
  },
  {
    key: "expenses",
    label: "Expense Bills",
    description: "Expense records, receipts and approval status.",
  },
  {
    key: "maintenance",
    label: "Maintenance",
    description: "Maintenance requests, assignments and work updates.",
  },
  {
    key: "claims",
    label: "Claims",
    description: "Repair and operating expense claims.",
  },
  {
    key: "reports",
    label: "Reports",
    description: "Property, rent and operating reports.",
  },
  {
    key: "settings",
    label: "Settings",
    description: "Company and application settings.",
  },
  {
    key: "onboarding",
    label: "Tenant Onboarding",
    description: "Tenant registration details and document submissions.",
  },
];

const noAccess = (): UserAccess =>
  Object.fromEntries(accessModules.map((module) => [module, "none"])) as UserAccess;

export function getRoleDefaultAccess(role: AppRole): UserAccess {
  const access = noAccess();
  access.dashboard = "view";

  if (role === "super_admin") {
    for (const module of accessModules) {
      access[module] = "manage";
    }
    return access;
  }

  if (role === "admin") {
    for (const module of [
      "properties",
      "verification",
      "payments",
      "rent_due_tracker",
      "tenancy_agreements",
      "utility_bills",
      "expenses",
      "maintenance",
      "claims",
    ] satisfies AccessModule[]) {
      access[module] = "manage";
    }
    access.reports = "view";
    return access;
  }

  if (role === "owner") {
    for (const module of [
      "properties",
      "payments",
      "rent_due_tracker",
      "tenancy_agreements",
      "utility_bills",
      "expenses",
      "maintenance",
      "claims",
      "reports",
    ] satisfies AccessModule[]) {
      access[module] = "view";
    }
    return access;
  }

  if (role === "tenant") {
    access.onboarding = "manage";
    access.tenancy_agreements = "manage";
    access.payments = "manage";
    access.maintenance = "manage";
    return access;
  }

  access.maintenance = "manage";
  access.expenses = "manage";
  access.claims = "manage";
  return access;
}

export function resolveUserAccess(
  role: AppRole,
  rows: Array<{ module_key: string; access_level: string }> = [],
): UserAccess {
  const access = getRoleDefaultAccess(role);
  const maximumAccess = getRoleDefaultAccess(role);
  const rank: Record<AccessLevel, number> = {
    none: 0,
    view: 1,
    manage: 2,
  };

  for (const row of rows) {
    if (
      accessModules.includes(row.module_key as AccessModule) &&
      accessLevels.includes(row.access_level as AccessLevel)
    ) {
      const module = row.module_key as AccessModule;
      const requested = row.access_level as AccessLevel;
      access[module] =
        rank[requested] <= rank[maximumAccess[module]]
          ? requested
          : maximumAccess[module];
    }
  }

  access.dashboard = role === "super_admin" ? "manage" : "view";
  return access;
}

export function hasModuleAccess(
  access: UserAccess,
  module: AccessModule,
  required: Exclude<AccessLevel, "none"> = "view",
) {
  const rank: Record<AccessLevel, number> = {
    none: 0,
    view: 1,
    manage: 2,
  };
  return rank[access[module]] >= rank[required];
}

export function moduleForPath(pathname: string): AccessModule | null {
  const routeModules: Array<[string, AccessModule]> = [
    ["/staff", "dashboard"],
    ["/admin-setup", "admin_setup"],
    ["/register-tenant", "properties"],
    ["/properties", "properties"],
    ["/smart-devices", "properties"],
    ["/rooms", "properties"],
    ["/tenants", "properties"],
    ["/tenant", "dashboard"],
    ["/payment-verification", "verification"],
    ["/tenant-verification", "verification"],
    ["/verification", "verification"],
    ["/referrals", "verification"],
    ["/rent-due-tracker", "rent_due_tracker"],
    ["/payments", "payments"],
    ["/e-tenancy", "tenancy_agreements"],
    ["/tenancy-agreements", "tenancy_agreements"],
    ["/utility-bills", "utility_bills"],
    ["/expenses", "expenses"],
    ["/maintenance", "maintenance"],
    ["/claims", "claims"],
    ["/reports", "reports"],
    ["/settings", "settings"],
    ["/setup", "settings"],
    ["/onboarding", "onboarding"],
    ["/super-admin", "dashboard"],
    ["/dashboard", "dashboard"],
  ];

  return (
    routeModules.find(([route]) => pathname.startsWith(route))?.[1] ?? null
  );
}
