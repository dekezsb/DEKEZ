/** Marketplace-only vocabulary. These states never issue accounting documents. */
export const jobStatuses = [
  "DRAFT", "PENDING_REVIEW", "OPEN_FOR_MATCHING", "OPEN_FOR_QUOTATIONS",
  "QUOTATIONS_RECEIVED", "CONTRACTOR_SELECTED", "IN_PROGRESS",
  "WORK_REPORTED_COMPLETED", "COMPLETED", "CLOSED", "CANCELLED",
  "EXPIRED", "DISPUTED", "REJECTED",
] as const;
export type JobStatus = typeof jobStatuses[number];

export const verificationStatuses = [
  "REGISTERED", "PENDING_VERIFICATION", "ADDITIONAL_INFORMATION_REQUIRED",
  "VERIFIED", "REJECTED", "SUSPENDED",
] as const;
export type VerificationStatus = typeof verificationStatuses[number];

export const subscriptionStatuses = [
  "TRIAL", "ACTIVE", "PAST_DUE", "EXPIRED", "CANCELLED", "SUSPENDED",
] as const;
export type SubscriptionStatus = typeof subscriptionStatuses[number];

export const quotationStatuses = [
  "DRAFT", "SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "REJECTED", "EXPIRED", "WITHDRAWN",
] as const;
export type QuotationStatus = typeof quotationStatuses[number];

export const invitationStatuses = ["INVITED", "DECLINED", "EXPIRED", "QUOTED", "REVOKED"] as const;
export type InvitationStatus = typeof invitationStatuses[number];

// REVIEW_AVAILABLE is derived separately so opening reviews does not overwrite completion.
// CONTRACTOR_SELECTED is displayed as Awaiting Start until the contractor starts the work.
export const jobStatusLabels: Record<JobStatus, string> = {
  DRAFT: "Draft", PENDING_REVIEW: "Pending review", OPEN_FOR_MATCHING: "Finding contractors",
  OPEN_FOR_QUOTATIONS: "Open for quotations", QUOTATIONS_RECEIVED: "Quotations received",
  CONTRACTOR_SELECTED: "Awaiting start", IN_PROGRESS: "In progress",
  WORK_REPORTED_COMPLETED: "Awaiting owner completion confirmation", COMPLETED: "Completed",
  CLOSED: "Closed", CANCELLED: "Cancelled", EXPIRED: "Expired", DISPUTED: "Disputed", REJECTED: "Rejected",
};
