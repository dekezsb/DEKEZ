import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";

type LegalSection = {
  title: string;
  paragraphs?: string[];
  items?: string[];
};

type LegalPageProps = {
  title: string;
  summary: string;
  updated: string;
  sections: LegalSection[];
};

export function LegalPage({
  title,
  summary,
  updated,
  sections,
}: LegalPageProps) {
  return (
    <main className="min-h-screen bg-[#f2f4f7] text-[#17130d]">
      <header className="border-b border-[#2a2110] bg-[#090806] text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link className="flex items-center gap-3" href="/">
            <BrandLogo className="rounded-md" priority size={48} />
            <span>
              <span className="block font-bold text-[#c99a3e]">DEKEZ</span>
              <span className="block text-xs text-[#d7c6a8]">
                Rental Management System
              </span>
            </span>
          </Link>
          <Link
            className="text-sm font-medium text-[#e7d8bb] hover:text-white"
            href="/"
          >
            Sign in
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="rounded-md border border-[#d7dde5] bg-white p-6 shadow-sm sm:p-10">
          <p className="text-sm font-semibold uppercase text-[#8a641d]">
            DEKEZ SDN BHD
          </p>
          <h1 className="mt-2 text-3xl font-bold text-[#111827]">{title}</h1>
          <p className="mt-3 max-w-2xl leading-7 text-[#4b5563]">
            {summary}
          </p>
          <p className="mt-3 text-sm text-[#6b7280]">
            Last updated: {updated}
          </p>

          <div className="mt-8 space-y-8">
            {sections.map((section) => (
              <section key={section.title}>
                <h2 className="text-xl font-semibold text-[#111827]">
                  {section.title}
                </h2>
                {section.paragraphs?.map((paragraph) => (
                  <p className="mt-3 leading-7 text-[#374151]" key={paragraph}>
                    {paragraph}
                  </p>
                ))}
                {section.items?.length ? (
                  <ul className="mt-3 list-disc space-y-2 pl-6 leading-7 text-[#374151]">
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>

          <footer className="mt-10 border-t border-[#e5e7eb] pt-6 text-sm text-[#4b5563]">
            <p>
              DEKEZ SDN BHD - Company Registration No. 202501054747
            </p>
            <p className="mt-1">
              Questions:{" "}
              <a
                className="font-semibold text-[#8a641d] hover:underline"
                href="mailto:dekezsdnbhd@gmail.com"
              >
                dekezsdnbhd@gmail.com
              </a>
            </p>
            <div className="mt-4 flex gap-4">
              <Link className="font-semibold hover:underline" href="/privacy">
                Privacy Policy
              </Link>
              <Link className="font-semibold hover:underline" href="/terms">
                Terms of Service
              </Link>
            </div>
          </footer>
        </div>
      </article>
    </main>
  );
}
