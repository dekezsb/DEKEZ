import Link from "next/link";

const categories = [
  {
    title: "Owner",
    description: "Manage companies, properties, rooms, tenants and reports.",
    href: "/login",
    action: "Login only for now",
  },
  {
    title: "Admin Team",
    description: "Daily operations for rooms, tenants and collections.",
    href: "/login",
    action: "Login",
  },
  {
    title: "Technician Team",
    description: "View assigned repair work and update repair status.",
    href: "/login",
    action: "Login",
  },
  {
    title: "Tenant",
    description: "View rental details, payments and maintenance requests.",
    href: "/auth/tenant/login",
    action: "Login or sign up",
  },
];

export default function Home() {
  return (
    <section className="w-full">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-normal text-[#126b5f]">
            Welcome to DEKEZ
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-normal text-gray-950 sm:text-5xl">
            Choose your account type
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-gray-600">
            Selecting a category only opens the correct login or signup page. Your
            real access is always verified from your account role.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {categories.map((category) => (
            <Link
              className="rounded-lg border border-[#d7dde5] bg-white p-5 shadow-sm transition hover:border-[#126b5f] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#126b5f] focus:ring-offset-2"
              href={category.href}
              key={category.title}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-950">
                    {category.title}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-gray-600">
                    {category.description}
                  </p>
                </div>
                <span className="rounded-full bg-[#e7f2f0] px-3 py-1 text-xs font-semibold text-[#126b5f]">
                  {category.action}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
