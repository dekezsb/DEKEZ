import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { getOptionalUserAccess } from "@/lib/auth/session";
import type { UserAccess } from "@/lib/auth/access";
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
    const context = await getOptionalUserAccess();
    const user = context?.user;
    userName = user?.user_metadata?.full_name ?? user?.phone ?? user?.email ?? null;
    role = context?.role ?? null;
    access = context?.access ?? null;
  } catch {
    role = null;
    access = null;
  }

  return (
    <html lang="en-MY">
      <body>
        <AppShell access={access} role={role} userName={userName}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
