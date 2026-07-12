export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      app_role: "super_admin" | "owner" | "admin_team" | "technician_team" | "tenant";
      company_status: "active" | "inactive" | "suspended";
      company_user_status: "active" | "inactive" | "invited";
      room_status: "vacant" | "occupied" | "maintenance" | "reserved";
      tenancy_status: "draft" | "active" | "ended" | "cancelled";
      payment_status: "pending" | "paid" | "partial" | "overdue" | "cancelled";
      maintenance_status: "open" | "assigned" | "in_progress" | "resolved" | "cancelled";
      maintenance_priority: "low" | "medium" | "high" | "urgent";
    };
    CompositeTypes: Record<string, never>;
  };
};
