import { Link } from "@/components/app-link";
import { hasModuleAccess } from "@/lib/auth/access";
import { getCurrentUserAccess } from "@/lib/auth/session";

export async function BillSections({ active, propertyId }: {
  active: "expenses" | "utilities";
  propertyId?: string;
}) {
  const { access, role } = await getCurrentUserAccess();
  const sections = [
    { key: "expenses", label: "Expenses & claims", href: "/expenses", allowed: hasModuleAccess(access, "expenses") },
    { key: "utilities", label: "Water, electricity & utilities", href: "/utility-bills", allowed:
      ["super_admin", "owner", "admin"].includes(role) && hasModuleAccess(access, "utility_bills") },
  ].filter((section) => section.allowed);
  return <nav aria-label="Expense bill sections" className="flex flex-wrap gap-2">
    {sections.map((section) => <Link key={section.key}
      href={section.href + (propertyId ? `?property=${encodeURIComponent(propertyId)}` : "")}
      aria-current={active === section.key ? "page" : undefined}
      className={`rounded-md border px-4 py-2 text-sm font-medium ${active === section.key
        ? "border-[#b98a2c] bg-[#b98a2c] text-white"
        : "border-[#d7dde5] bg-white text-gray-700 hover:bg-gray-50"}`}>
      {section.label}
    </Link>)}
  </nav>;
}
