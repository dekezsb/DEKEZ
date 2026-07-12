import type { AppRole } from "./roles";

export type Permission =
  | "companies.manage"
  | "users.manage"
  | "properties.manage"
  | "rooms.manage"
  | "tenants.manage"
  | "tenancies.manage"
  | "payments.view"
  | "payments.collect"
  | "maintenance.view"
  | "maintenance.assign"
  | "maintenance.update"
  | "reports.view"
  | "audit_logs.view"
  | "tenant_portal.view";

const rolePermissions: Record<AppRole, Permission[]> = {
  super_admin: [
    "companies.manage",
    "users.manage",
    "properties.manage",
    "rooms.manage",
    "tenants.manage",
    "tenancies.manage",
    "payments.view",
    "payments.collect",
    "maintenance.view",
    "maintenance.assign",
    "maintenance.update",
    "reports.view",
    "audit_logs.view",
    "tenant_portal.view",
  ],
  owner: [
    "users.manage",
    "properties.manage",
    "rooms.manage",
    "tenants.manage",
    "tenancies.manage",
    "payments.view",
    "payments.collect",
    "maintenance.view",
    "maintenance.assign",
    "maintenance.update",
    "reports.view",
  ],
  admin_team: [
    "properties.manage",
    "rooms.manage",
    "tenants.manage",
    "tenancies.manage",
    "payments.view",
    "payments.collect",
    "maintenance.view",
    "maintenance.assign",
    "maintenance.update",
    "reports.view",
  ],
  technician_team: ["maintenance.view", "maintenance.update"],
  tenant: ["tenant_portal.view", "maintenance.view"],
};

export function hasPermission(role: AppRole, permission: Permission) {
  return rolePermissions[role].includes(permission);
}
