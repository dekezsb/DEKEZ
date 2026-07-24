import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { normalizeRole } from "@/lib/auth/roles";
import "./globals.css";

export const metadata: Metadata = {
  title: "DEKEZ",
  description: "DEKEZ Rental Management System",
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

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    role = normalizeRole(user?.user_metadata?.role);
    userName = user?.user_metadata?.full_name ?? user?.email ?? user?.phone ?? null;

    if (user && !role) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, full_name")
        .eq("id", user.id)
        .maybeSingle();
      role = normalizeRole(profile?.role);
      userName = profile?.full_name ?? userName;
    }
  } catch {
    role = null;
  }

  return (
    <html lang="en">
      <body>
        <AppShell role={role} userName={userName}>{children}</AppShell>
      </body>
    </html>
  );
}
