import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { resolveUserRole } from "@/lib/auth/session";
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

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userName = user?.user_metadata?.full_name ?? user?.email ?? user?.phone ?? null;

    if (user) {
      role = await resolveUserRole(user);
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
