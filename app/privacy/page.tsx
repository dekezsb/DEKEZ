import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy | DEKEZ",
  description: "Privacy policy for the DEKEZ Rental Management System.",
};

const sections = [
  {
    title: "1. Who we are",
    paragraphs: [
      "DEKEZ SDN BHD operates the DEKEZ Rental Management System for property owners, management teams, technicians, tenants and authorised administrators.",
    ],
  },
  {
    title: "2. Information we collect",
    items: [
      "Account and contact details, including name, phone number and optional email address.",
      "Identity, company and supporting documents submitted for registration, verification or tenancy administration.",
      "Property, room, tenancy, invoice, payment, deposit and outstanding balance records.",
      "Payment evidence, maintenance reports, photographs, agreements and electronic signatures.",
      "Security, access and technical records needed to operate and protect the service.",
    ],
  },
  {
    title: "3. How we use information",
    items: [
      "Create and manage user accounts, properties, rooms and tenancies.",
      "Verify registrations, documents and payment submissions.",
      "Generate invoices, receipts, tenancy agreements, reminders and reports.",
      "Manage maintenance work, claims and communications.",
      "Protect the service, prevent misuse and meet legal or regulatory obligations.",
    ],
  },
  {
    title: "4. Service providers and disclosure",
    paragraphs: [
      "We use trusted service providers, including Supabase, Vercel and Google Drive, to host, process, secure and archive DEKEZ information. Information is shared only when needed to provide the service, comply with law, protect users or enforce agreements. We do not sell personal information.",
    ],
  },
  {
    title: "5. Retention",
    paragraphs: [
      "Accounting records, rental invoices, payment evidence and tenancy agreements may be retained for at least seven years or longer when required by law, an active dispute or a contractual obligation. Other information is retained only for as long as reasonably necessary for the purposes described in this policy.",
    ],
  },
  {
    title: "6. Security",
    paragraphs: [
      "We use role-based access, protected routes, database access controls and restricted document storage. No online service is completely risk-free, so users must also protect their login credentials and promptly report suspected unauthorised access.",
    ],
  },
  {
    title: "7. Your choices and rights",
    paragraphs: [
      "You may request access to or correction of your personal information, subject to identity verification and applicable Malaysian law. Some verified or historical records cannot be changed or deleted when they must be preserved for legal, accounting or security purposes.",
    ],
  },
  {
    title: "8. International processing",
    paragraphs: [
      "Some service providers may process or store information outside Malaysia. We take reasonable steps to use providers and safeguards appropriate to the sensitivity of the information.",
    ],
  },
  {
    title: "9. Contact",
    paragraphs: [
      "Privacy questions and requests may be sent to dekezsdnbhd@gmail.com. Please include enough information for us to identify your DEKEZ account and understand the request.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      sections={sections}
      summary="This policy explains how DEKEZ SDN BHD collects, uses, protects and retains information in the DEKEZ Rental Management System."
      title="Privacy Policy"
      updated="29 July 2026"
    />
  );
}
