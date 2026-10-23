export const contractorSections = [
  "dashboard", "jobs", "quotations", "my-jobs", "messages", "subscription",
  "subscription/billing", "profile", "profile/services", "profile/portfolio",
  "profile/verification", "reviews", "support",
] as const;
export type ContractorSection = typeof contractorSections[number];
export const contractorPreviewPath = "/admin/marketplace/contractor-preview";
export function contractorSection(value: string): ContractorSection | null {
  return contractorSections.find(section => section === value) ?? null;
}
export const sectionTitles: Record<ContractorSection, string> = {
  dashboard: "Contractor Portal", jobs: "Job Opportunities", quotations: "My Quotations",
  "my-jobs": "My Jobs", messages: "Messages", subscription: "Subscription",
  "subscription/billing": "Billing History", profile: "Company Profile",
  "profile/services": "Services & Areas", "profile/portfolio": "Portfolio",
  "profile/verification": "Business Verification", reviews: "Reviews", support: "Help & Support",
};
export function contractorMobileSection(section: ContractorSection): string {
  if (section === "my-jobs" || section.startsWith("subscription") || section.startsWith("profile")
    || section === "reviews" || section === "support") return "profile";
  return section;
}
