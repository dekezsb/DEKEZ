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
type RoomStatus = "vacant" | "occupied" | "maintenance" | "reserved";

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
      properties: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string | null;
          name: string;
          address: string | null;
          city: string | null;
          state: string | null;
          postcode: string | null;
          property_type: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          branch_id?: string | null;
          name: string;
          address?: string | null;
          city?: string | null;
          state?: string | null;
          postcode?: string | null;
          property_type?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          branch_id?: string | null;
          name?: string;
          address?: string | null;
          city?: string | null;
          state?: string | null;
          postcode?: string | null;
          property_type?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "properties_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      units: {
        Row: {
          id: string;
          company_id: string;
          property_id: string;
          name: string;
          floor: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          property_id: string;
          name: string;
          floor?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          property_id?: string;
          name?: string;
          floor?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "units_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "units_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
        ];
      };
      rooms: {
        Row: {
          id: string;
          company_id: string;
          unit_id: string;
          room_number: string;
          status: RoomStatus;
          current_tenancy_id: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          unit_id: string;
          room_number: string;
          status?: RoomStatus;
          current_tenancy_id?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          unit_id?: string;
          room_number?: string;
          status?: RoomStatus;
          current_tenancy_id?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rooms_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rooms_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
        ];
      };
      tenants: {
        Row: {
          id: string;
          company_id: string;
          profile_id: string | null;
          full_name: string;
          email: string | null;
          phone: string | null;
          identity_number: string | null;
          emergency_contact_name: string | null;
          emergency_contact_phone: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          profile_id?: string | null;
          full_name: string;
          email?: string | null;
          phone?: string | null;
          identity_number?: string | null;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          profile_id?: string | null;
          full_name?: string;
          email?: string | null;
          phone?: string | null;
          identity_number?: string | null;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenants_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenants_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      tenancies: {
        Row: {
          id: string;
          company_id: string;
          tenant_id: string;
          room_id: string;
          monthly_rent: number;
          deposit: number;
          start_date: string;
          end_date: string | null;
          due_day: number;
          status: "draft" | "active" | "ended" | "cancelled";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          tenant_id: string;
          room_id: string;
          monthly_rent: number;
          deposit?: number;
          start_date: string;
          end_date?: string | null;
          due_day: number;
          status?: "draft" | "active" | "ended" | "cancelled";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          tenant_id?: string;
          room_id?: string;
          monthly_rent?: number;
          deposit?: number;
          start_date?: string;
          end_date?: string | null;
          due_day?: number;
          status?: "draft" | "active" | "ended" | "cancelled";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenancies_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenancies_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenancies_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
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
      room_status: RoomStatus;
      tenancy_status: "draft" | "active" | "ended" | "cancelled";
      payment_status: "pending" | "paid" | "partial" | "overdue" | "cancelled";
      maintenance_status: "open" | "assigned" | "in_progress" | "resolved" | "cancelled";
      maintenance_priority: "low" | "medium" | "high" | "urgent";
    };
    CompositeTypes: Record<string, never>;
  };
};
