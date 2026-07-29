import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service | DEKEZ",
  description: "Terms of service for the DEKEZ Rental Management System.",
};

const sections = [
  {
    title: "1. Acceptance",
    paragraphs: [
      "By accessing or using DEKEZ, you agree to these Terms of Service. If you use DEKEZ for a company or property owner, you confirm that you are authorised to act for that organisation.",
    ],
  },
  {
    title: "2. Accounts and access",
    items: [
      "You must provide accurate registration information and keep it current.",
      "You are responsible for protecting your phone login, password or PIN.",
      "Access is controlled by the role and permissions assigned to the account.",
      "You must not access another user, company, property or financial record without authorisation.",
    ],
  },
  {
    title: "3. Rental and property records",
    paragraphs: [
      "DEKEZ helps authorised users manage properties, rooms, tenancies, maintenance, invoices and related records. A tenancy agreement, property rule or other signed document remains a separate legal agreement and will control where it conflicts with general application information.",
    ],
  },
  {
    title: "4. Payments and verification",
    paragraphs: [
      "Uploading a payment slip does not by itself confirm payment. A payment affects the official paid amount and outstanding balance only after verification by an authorised user. Users must provide accurate payment amounts, dates and evidence.",
    ],
  },
  {
    title: "5. Documents and signatures",
    paragraphs: [
      "Users may upload identity documents, receipts, photographs and supporting records. Electronic agreement acceptance and signatures may be stored with date, time and related audit information. Users must not upload unlawful, misleading or unauthorised material.",
    ],
  },
  {
    title: "6. Acceptable use",
    items: [
      "Do not misuse, disrupt, reverse engineer or attempt to bypass DEKEZ security.",
      "Do not upload malware, fraudulent documents or content that violates another person's rights.",
      "Do not use DEKEZ for illegal activity or to misrepresent payment, tenancy or property information.",
    ],
  },
  {
    title: "7. Service availability",
    paragraphs: [
      "We work to keep DEKEZ available and accurate, but maintenance, provider outages or technical issues may occasionally interrupt the service. Users should promptly report important errors and retain any records they are independently required to keep.",
    ],
  },
  {
    title: "8. Suspension and termination",
    paragraphs: [
      "DEKEZ may restrict or suspend access when required for security, suspected misuse, legal compliance or account administration. Ending application access does not automatically cancel a tenancy, payment obligation or signed agreement.",
    ],
  },
  {
    title: "9. Responsibility and limitation",
    paragraphs: [
      "DEKEZ is a rental management and cash-flow record system, not legal, tax or accounting advice. To the extent permitted by law, DEKEZ SDN BHD is not responsible for indirect losses caused by unauthorised use, inaccurate user-submitted information or third-party service interruptions.",
    ],
  },
  {
    title: "10. Governing law and changes",
    paragraphs: [
      "These terms are governed by the laws of Malaysia, with applicable proceedings subject to the courts of Sabah. We may update these terms when the service or legal requirements change, and the updated date will be displayed on this page.",
    ],
  },
  {
    title: "11. Contact",
    paragraphs: [
      "Questions about these terms may be sent to dekezsdnbhd@gmail.com.",
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      sections={sections}
      summary="These terms govern access to and use of the DEKEZ Rental Management System."
      title="Terms of Service"
      updated="29 July 2026"
    />
  );
}
