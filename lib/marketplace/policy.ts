import type { InvitationStatus, JobStatus, SubscriptionStatus, VerificationStatus } from "./status";

/**
 * Pure policy checks for server and UI use. Inputs must be loaded by the server,
 * never trusted from a request body. These checks do NOT replace database
 * authorization, row locks, unique constraints or transactional state checks.
 */
export type PolicyResult = { allowed: true } | { allowed: false; reason: string };
const allow: PolicyResult = { allowed: true };
const deny = (reason: string): { allowed: false; reason: string } => ({ allowed: false, reason });
const timestamp = (value: string | null) => value ? Date.parse(value) : NaN;
const afterNow = (value: string | null, now: number) => Number.isFinite(timestamp(value)) && timestamp(value) > now;

export type ContractorEligibility = {
  contractorId: string;
  verification: VerificationStatus;
  subscription: SubscriptionStatus;
  subscriptionStartsAt: string | null;
  subscriptionEndsAt: string | null;
  // Backed by verified provider events, not browser success or editable metadata.
  billingVerified: boolean;
  available: boolean;
  categoryEligible: boolean;
  areaEligible: boolean;
  qualificationsCurrent: boolean;
};

export function newOpportunityEligibility(input: ContractorEligibility, now: number): PolicyResult {
  if (!Number.isFinite(now) || !input.contractorId) return deny("eligibility_unavailable");
  if (input.verification !== "VERIFIED") return deny("verification_required");
  if (input.subscription !== "ACTIVE" || input.billingVerified !== true) return deny("active_membership_required");
  const start = timestamp(input.subscriptionStartsAt);
  if (!Number.isFinite(start) || start > now || !afterNow(input.subscriptionEndsAt, now)) return deny("membership_not_current");
  if (input.available !== true) return deny("contractor_unavailable");
  if (input.categoryEligible !== true || input.areaEligible !== true) return deny("service_not_eligible");
  if (input.qualificationsCurrent !== true) return deny("qualification_required");
  return allow;
}

export type QuotationSubmissionContext = {
  jobId: string;
  jobStatus: JobStatus;
  quotationDeadline: string;
  invitation: {
    jobId: string;
    contractorId: string;
    status: InvitationStatus;
    expiresAt: string;
  } | null;
  hasCurrentSubmittedQuotation: boolean;
  activeQuotationCount: number;
  maximumActiveQuotations: number;
};

export function quotationSubmissionEligibility(
  contractor: ContractorEligibility, context: QuotationSubmissionContext, now: number,
): PolicyResult {
  const membership = newOpportunityEligibility(contractor, now);
  if (!membership.allowed) return membership;
  if (!context.jobId || !["OPEN_FOR_QUOTATIONS", "QUOTATIONS_RECEIVED"].includes(context.jobStatus)) return deny("job_not_open");
  if (!afterNow(context.quotationDeadline, now)) return deny("quotation_deadline_passed");
  const invitation = context.invitation;
  if (!invitation || invitation.jobId !== context.jobId || invitation.contractorId !== contractor.contractorId || invitation.status !== "INVITED") return deny("invitation_required");
  if (!afterNow(invitation.expiresAt, now)) return deny("invitation_expired");
  if (context.hasCurrentSubmittedQuotation !== false) return deny("quotation_already_submitted");
  if (!Number.isSafeInteger(context.activeQuotationCount) || context.activeQuotationCount < 0
    || !Number.isSafeInteger(context.maximumActiveQuotations) || context.maximumActiveQuotations < 1
    || context.activeQuotationCount >= context.maximumActiveQuotations) return deny("quotation_capacity_reached");
  return allow;
}

export type JobActor =
  | { kind: "owner"; userId: string }
  | { kind: "contractor"; userId: string; contractorId: string }
  | { kind: "admin"; userId: string; canManageMarketplace: boolean }
  | { kind: "worker"; authorized: boolean };

export type JobPolicySnapshot = {
  ownerUserId: string;
  status: JobStatus;
  selectedContractorId: string | null;
  ownerConfirmedCompletionAt: string | null;
};

export type JobAction = "SUBMIT" | "APPROVE" | "REJECT" | "INVITE" | "QUOTATION_RECEIVED"
  | "SELECT_CONTRACTOR" | "START_WORK" | "REPORT_COMPLETION" | "CONFIRM_COMPLETION"
  | "REQUEST_FURTHER_WORK" | "CANCEL" | "EXPIRE" | "RAISE_DISPUTE" | "CLOSE";

type Transition = { from: readonly JobStatus[]; to: JobStatus; actors: readonly JobActor["kind"][]; reasonRequired?: boolean };
const open: readonly JobStatus[] = ["OPEN_FOR_MATCHING", "OPEN_FOR_QUOTATIONS", "QUOTATIONS_RECEIVED"];
const matched: readonly JobStatus[] = ["CONTRACTOR_SELECTED", "IN_PROGRESS", "WORK_REPORTED_COMPLETED"];
const transitions: Record<JobAction, Transition> = {
  SUBMIT: { from: ["DRAFT"], to: "PENDING_REVIEW", actors: ["owner"] },
  APPROVE: { from: ["PENDING_REVIEW"], to: "OPEN_FOR_MATCHING", actors: ["admin"] },
  REJECT: { from: ["PENDING_REVIEW"], to: "REJECTED", actors: ["admin"], reasonRequired: true },
  INVITE: { from: ["OPEN_FOR_MATCHING"], to: "OPEN_FOR_QUOTATIONS", actors: ["worker"] },
  QUOTATION_RECEIVED: { from: ["OPEN_FOR_QUOTATIONS"], to: "QUOTATIONS_RECEIVED", actors: ["worker"] },
  SELECT_CONTRACTOR: { from: ["QUOTATIONS_RECEIVED"], to: "CONTRACTOR_SELECTED", actors: ["owner"] },
  START_WORK: { from: ["CONTRACTOR_SELECTED"], to: "IN_PROGRESS", actors: ["contractor"] },
  REPORT_COMPLETION: { from: ["IN_PROGRESS"], to: "WORK_REPORTED_COMPLETED", actors: ["contractor"] },
  CONFIRM_COMPLETION: { from: ["WORK_REPORTED_COMPLETED"], to: "COMPLETED", actors: ["owner"] },
  REQUEST_FURTHER_WORK: { from: ["WORK_REPORTED_COMPLETED"], to: "IN_PROGRESS", actors: ["owner"], reasonRequired: true },
  CANCEL: { from: ["DRAFT", "PENDING_REVIEW", ...open], to: "CANCELLED", actors: ["owner", "admin"], reasonRequired: true },
  EXPIRE: { from: open, to: "EXPIRED", actors: ["worker"] },
  RAISE_DISPUTE: { from: matched, to: "DISPUTED", actors: ["owner", "contractor"], reasonRequired: true },
  CLOSE: { from: ["COMPLETED"], to: "CLOSED", actors: ["owner", "admin"] },
};

function isScopedActor(job: JobPolicySnapshot, actor: JobActor): boolean {
  switch (actor.kind) {
    case "owner": return !!actor.userId && actor.userId === job.ownerUserId;
    // Contractor ID and membership must be resolved from the authenticated session.
    case "contractor": return !!actor.userId && !!actor.contractorId && actor.contractorId === job.selectedContractorId;
    case "admin": return !!actor.userId && actor.canManageMarketplace === true;
    case "worker": return actor.authorized === true;
    default: return false;
  }
}

export function evaluateJobTransition(job: JobPolicySnapshot, actor: JobActor, action: JobAction, reason = ""):
  | { allowed: true; nextStatus: JobStatus }
  | { allowed: false; reason: string } {
  const rule = Object.hasOwn(transitions, action) ? transitions[action] : undefined;
  if (!rule || !rule.from.includes(job.status) || !rule.actors.includes(actor.kind)) return deny("invalid_transition");
  if (!isScopedActor(job, actor)) return { allowed: false, reason: "permission_denied" };
  if (rule.reasonRequired && !reason.trim()) return { allowed: false, reason: "reason_required" };
  if (action === "SELECT_CONTRACTOR" && job.selectedContractorId) return { allowed: false, reason: "contractor_already_selected" };
  if (["START_WORK", "REPORT_COMPLETION", "CONFIRM_COMPLETION", "REQUEST_FURTHER_WORK", "RAISE_DISPUTE", "CLOSE"].includes(action)
    && !job.selectedContractorId) return { allowed: false, reason: "confirmed_match_required" };
  if (action === "CLOSE" && !Number.isFinite(timestamp(job.ownerConfirmedCompletionAt))) return { allowed: false, reason: "owner_completion_required" };
  return { allowed: true, nextStatus: rule.to };
}

/** Membership expiry never removes accepted-job history or essential communication. */
export function canAccessAcceptedJob(job: JobPolicySnapshot, actor: JobActor): boolean {
  return !!job.selectedContractorId && [...matched, "COMPLETED", "CLOSED", "DISPUTED"].includes(job.status)
    && actor.kind !== "worker" && isScopedActor(job, actor);
}

export function canSubmitReview(job: JobPolicySnapshot, actor: JobActor, alreadyReviewed: boolean): boolean {
  return alreadyReviewed === false && ["COMPLETED", "CLOSED"].includes(job.status)
    && Number.isFinite(timestamp(job.ownerConfirmedCompletionAt))
    && (actor.kind === "owner" || actor.kind === "contractor") && canAccessAcceptedJob(job, actor);
}
