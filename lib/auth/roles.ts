export const appRoles = [
  "super_admin",
  "owner",
  "admin_team",
  "technician_team",
  "tenant",
] as const;

export type AppRole = (typeof appRoles)[number];

export const companyRoles = [
  "owner",
  "admin_team",
  "technician_team",
  "tenant",
] as const;

export type CompanyRole = (typeof companyRoles)[number];

export const protectedRoutes = [
  "/dashboard",
  "/properties",
  "/rooms",
  "/tenants",
  "/tenancies",
  "/payments",
  "/maintenance",
  "/reports",
  "/settings",
  "/tenant-portal",
];
