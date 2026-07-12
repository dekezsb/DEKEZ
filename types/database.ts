export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type AppRole = "super_admin" | "owner" | "admin_team" | "technician_team" | "tenant";
type CompanyStatus = "active" | "inactive" | "suspended";
type CompanyUserStatus = "active" | "inactive" | "invited";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          phone: string | null;
          avatar_url: string | null;
          global_role: AppRole;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          phone?: string | null;
          avatar_url?: string | null;
          global_role?: AppRole;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          phone?: string | null;
          avatar_url?: string | null;
          global_role?: AppRole;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      companies: {
        Row: {
          id: string;
          name: string;
          registration_number: string | null;
          status: CompanyStatus;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          registration_number?: string | null;
          status?: CompanyStatus;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          registration_number?: string | null;
          status?: CompanyStatus;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "companies_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      company_users: {
        Row: {
          id: string;
          company_id: string;
          profile_id: string;
          role: AppRole;
          status: CompanyUserStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          profile_id: string;
          role: AppRole;
          status?: CompanyUserStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          profile_id?: string;
          role?: AppRole;
          status?: CompanyUserStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "company_users_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "company_users_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      app_role: AppRole;
      company_status: CompanyStatus;
      company_user_status: CompanyUserStatus;
      room_status: "vacant" | "occupied" | "maintenance" | "reserved";
      tenancy_status: "draft" | "active" | "ended" | "cancelled";
      payment_status: "pending" | "paid" | "partial" | "overdue" | "cancelled";
      maintenance_status: "open" | "assigned" | "in_progress" | "resolved" | "cancelled";
      maintenance_priority: "low" | "medium" | "high" | "urgent";
    };
    CompositeTypes: Record<string, never>;
  };
};
