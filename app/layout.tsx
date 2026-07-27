import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import {
  resolveUserModuleAccess,
  resolveUserRole,
} from "@/lib/auth/session";
import type { UserAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "DEKEZ",
  description: "DEKEZ Rental Management System",
  icons: {
    icon: "/dekez-logo.jpg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <RootLayoutContent>{children}</RootLayoutContent>;
}

async function RootLayoutContent({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let role = null;
  let userName = null;
  let access: UserAccess | null = null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userName = user?.user_metadata?.full_name ?? user?.phone ?? user?.email ?? null;

    if (user) {
      role = await resolveUserRole(user);
      access = await resolveUserModuleAccess(user, role);
    }
  } catch {
    role = null;
    access = null;
  }

  return (
    <html lang="en">
      <body>
        <AppShell access={access} role={role} userName={userName}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
