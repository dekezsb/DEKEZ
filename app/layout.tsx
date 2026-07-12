import Link from "next/link";
import type { Metadata } from "next";
import "./globals.css";

const navigation = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Properties", href: "/properties" },
  { label: "Rooms", href: "/rooms" },
  { label: "Tenants", href: "/tenants" },
  { label: "Settings", href: "/settings" },
];

export const metadata: Metadata = {
  title: "DEKEZ",
  description: "DEKEZ Rental Management System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen bg-[#f6f7f9] text-gray-950 lg:flex">
          <aside className="border-b border-[#d7dde5] bg-white lg:fixed lg:inset-y-0 lg:left-0 lg:w-72 lg:border-b-0 lg:border-r">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 lg:h-full lg:flex-col lg:items-stretch lg:justify-start lg:px-6 lg:py-8">
              <div>
                <p className="text-xl font-bold tracking-normal text-[#126b5f]">DEKEZ</p>
                <p className="mt-1 hidden text-sm text-gray-500 sm:block lg:block">
                  Rental Management
                </p>
              </div>
              <nav aria-label="Main navigation" className="flex gap-1 overflow-x-auto lg:mt-8 lg:flex-col lg:overflow-visible">
                {navigation.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-[#e8f3f1] hover:text-[#126b5f] focus:outline-none focus:ring-2 focus:ring-[#126b5f] focus:ring-offset-2 lg:px-4"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </aside>
          <main className="min-h-screen lg:pl-72">
            <div className="mx-auto flex min-h-[calc(100vh-73px)] max-w-6xl items-center px-5 py-10 lg:min-h-screen lg:px-10">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
