import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDriveArchiveConfig } from "@/lib/archive/config";
import { archivePdfToDrive } from "@/lib/archive/google-drive";
import {
  createArchivePdf,
  type ArchiveAttachment,
  type ArchiveSection,
} from "@/lib/archive/pdf";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAgreementAppendixDocuments } from "@/lib/tenancy/agreement-appendix";
import { agreementPdfName } from "@/lib/tenancy/agreement-filename";
import { createAgreementPdf } from "@/lib/tenancy/agreement-pdf";

type ArchiveSourceType =
  | "rental_invoice"
  | "tenancy_agreement"
  | "utility_bill"
  | "expense_bill";

type ArchiveJob = {
  id: string;
  source_type: ArchiveSourceType;
  source_id: string;
  archive_year: number;
  attempt_count: number;
  drive_file_id: string | null;
  content_checksum: string | null;
};

type PreparedArchive = {
  path: string[];
  name: string;
  bytes: Uint8Array;
};

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return `RM ${numberValue(value).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function monthLabel(value: string | null | undefined) {
  const date = value ? new Date(`${value.slice(0, 10)}T00:00:00+08:00`) : null;
  return date && !Number.isNaN(date.valueOf())
    ? new Intl.DateTimeFormat("en-MY", {
        timeZone: "Asia/Kuala_Lumpur",
        month: "long",
        year: "numeric",
      }).format(date)
    : "Undated";
}

function monthFolder(value: string | null | undefined) {
  return value?.match(/^(\d{4})-(\d{2})/)?.slice(1).join("-") ?? "UNDATED";
}

function dateLabel(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "-";
}

function filePart(value: string | null | undefined, fallback: string) {
  const normalized = (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return normalized || fallback;
}

function folderPart(value: string | null | undefined, fallback: string) {
  return (value ?? "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || fallback;
}

function roomLabel(room: { room_number?: string | null; name?: string | null } | null) {
  const value = room?.room_number ?? room?.name ?? "ROOM";
  return /^room\s+/i.test(value) ? value : `Room ${value}`;
}

function inferredContentType(fileName: string, contentType?: string | null) {
  if (contentType) return contentType;
  const extension = fileName.split(".").at(-1)?.toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  return "application/octet-stream";
}

async function storageAttachment(
  supabase: SupabaseClient,
  input: {
    bucket: string;
    path: string | null | undefined;
    fileName: string | null | undefined;
    contentType?: string | null;
    label: string;
  },
): Promise<ArchiveAttachment | null> {
  if (!input.path) return null;
  const { data, error } = await supabase.storage
    .from(input.bucket)
    .download(input.path);
  if (error || !data) {
    throw new Error(
      `Unable to download ${input.label}: ${error?.message ?? "file missing"}`,
    );
  }
  const fileName =
    input.fileName ?? input.path.split("/").at(-1) ?? "document";
  return {
    label: input.label,
    fileName,
    contentType: inferredContentType(fileName, input.contentType),
    bytes: new Uint8Array(await data.arrayBuffer()),
  };
}

async function prepareRentalInvoice(
  supabase: SupabaseClient,
  sourceId: string,
): Promise<PreparedArchive | null> {
  const { data: bill, error } = await supabase
    .from("rent_bills")
    .select(
      "id, invoice_number, invoice_date, bill_month, due_date, amount, deposit_amount, paid_amount, status, tenancy_id, tenant_record_id, property_id, room_id, notes",
    )
    .eq("id", sourceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!bill) return null;

  const [{ data: property }, { data: room }, { data: tenancy }] =
    await Promise.all([
      supabase
        .from("properties")
        .select("name, property_code, area, address")
        .eq("id", bill.property_id)
        .maybeSingle(),
      supabase
        .from("rooms")
        .select("room_number, name")
        .eq("id", bill.room_id)
        .maybeSingle(),
      bill.tenancy_id
        ? supabase
            .from("tenancies")
            .select("tenant_id, check_in_date, contract_start, checkout_date, contract_end")
            .eq("id", bill.tenancy_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

  const { data: canonicalTenant } = tenancy?.tenant_id
    ? await supabase
        .from("tenants")
        .select("full_name, phone, email, identity_number")
        .eq("id", tenancy.tenant_id)
        .maybeSingle()
    : { data: null };
  const { data: importedTenant } = bill.tenant_record_id
    ? await supabase
        .from("tenant_records")
        .select("full_name, phone, email, identification_number")
        .eq("id", bill.tenant_record_id)
        .maybeSingle()
    : { data: null };
  const tenant = canonicalTenant ?? importedTenant;

  const submissionFilters = [`rent_bill_id.eq.${bill.id}`];
  if (bill.deposit_amount > 0 && bill.tenancy_id) {
    submissionFilters.push(
      `and(tenancy_id.eq.${bill.tenancy_id},bill_type.eq.deposit)`,
    );
  }
  if (bill.deposit_amount > 0 && bill.tenant_record_id) {
    submissionFilters.push(
      `and(tenant_record_id.eq.${bill.tenant_record_id},bill_type.eq.deposit)`,
    );
  }
  const { data: submissions, error: submissionError } = await supabase
    .from("payment_submissions")
    .select(
      "id, amount, payment_date, payment_method, reference_number, receipt_url, verified_at",
    )
    .eq("verification_status", "verified")
    .or(submissionFilters.join(","))
    .order("payment_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (submissionError) throw new Error(submissionError.message);

  const submissionIds = (submissions ?? []).map((submission) => submission.id);
  const { data: attachmentRows } = submissionIds.length
    ? await supabase
        .from("payment_attachments")
        .select("payment_submission_id, file_name, content_type")
        .in("payment_submission_id", submissionIds)
    : { data: [] };
  const attachmentBySubmission = new Map(
    (attachmentRows ?? []).map((attachment) => [
      attachment.payment_submission_id,
      attachment,
    ]),
  );
  const attachments: ArchiveAttachment[] = [];
  const seenPaths = new Set<string>();
  for (const [index, submission] of (submissions ?? []).entries()) {
    if (!submission.receipt_url || seenPaths.has(submission.receipt_url)) continue;
    seenPaths.add(submission.receipt_url);
    const attachment = attachmentBySubmission.get(submission.id);
    const downloaded = await storageAttachment(supabase, {
      bucket: "payment-receipts",
      path: submission.receipt_url,
      fileName: attachment?.file_name,
      contentType: attachment?.content_type,
      label: `Verified payment receipt ${index + 1} - ${money(submission.amount)}`,
    });
    if (downloaded) attachments.push(downloaded);
  }

  const rentAmount = numberValue(bill.amount);
  const depositAmount = numberValue(bill.deposit_amount);
  const { data: extraChargeRows, error: extraChargeError } = await supabase
    .from("rental_invoice_line_items")
    .select("description, amount")
    .eq("rent_bill_id", bill.id)
    .order("created_at", { ascending: true });
  if (extraChargeError) throw new Error(extraChargeError.message);
  const extraChargeAmount = (extraChargeRows ?? []).reduce(
    (sum, item) => sum + numberValue(item.amount),
    0,
  );
  const verifiedTotal = (submissions ?? []).reduce(
    (sum, submission) => sum + numberValue(submission.amount),
    0,
  );
  const invoiceTotal = rentAmount + depositAmount + extraChargeAmount;
  const paidAmount = Math.min(
    Math.max(numberValue(bill.paid_amount), verifiedTotal),
    invoiceTotal,
  );
  const outstanding = ["cancelled", "waived"].includes(bill.status)
    ? 0
    : Math.max(invoiceTotal - paidAmount, 0);
  const propertyCode =
    property?.property_code ?? property?.name ?? "PROPERTY";
  const finalRoomLabel = roomLabel(room);
  const sections: ArchiveSection[] = [
    {
      heading: "Invoice",
      rows: [
        ["Invoice Number", bill.invoice_number],
        ["Invoice Date", dateLabel(bill.invoice_date)],
        ["Due Date", dateLabel(bill.due_date)],
        ["Billing Month", monthLabel(bill.bill_month)],
        ["Status", bill.status.replaceAll("_", " ").toUpperCase()],
      ],
    },
    {
      heading: "Billed To",
      rows: [
        ["Tenant", tenant?.full_name ?? "Tenant"],
        [
          "IC / Passport",
          canonicalTenant?.identity_number ??
            importedTenant?.identification_number ??
            "-",
        ],
        ["Phone", tenant?.phone ?? "-"],
        ["Property", property?.name ?? propertyCode],
        ["Room", finalRoomLabel],
      ],
    },
    {
      heading: "Amounts",
      rows: [
        [`Rental - ${monthLabel(bill.bill_month)}`, money(rentAmount)],
        ["Deposit", money(depositAmount)],
        ...(extraChargeRows ?? []).map((item) => [
          item.description,
          money(item.amount),
        ] as [string, string]),
        ["Invoice Total", money(invoiceTotal)],
        ["Verified Paid", money(paidAmount)],
        ["Outstanding", money(outstanding)],
        ["Notes", bill.notes ?? "-"],
      ],
    },
  ];
  const bytes = await createArchivePdf({
    title: "RENTAL INVOICE",
    subtitle: bill.invoice_number,
    sections,
    attachments,
  });
  const roomNumber = filePart(finalRoomLabel, "ROOM").replace(/^ROOM_?/, "");

  return {
    path: [
      "01 RENTAL INVOICES",
      monthFolder(bill.bill_month),
      folderPart(property?.area ?? propertyCode, "UNASSIGNED AREA"),
    ],
    name: `${filePart(bill.invoice_number, "INVOICE")}_${filePart(
      tenant?.full_name,
      "TENANT",
    )}_${filePart(propertyCode, "PROPERTY")}R${roomNumber}.pdf`,
    bytes,
  };
}

async function prepareTenancyAgreement(
  supabase: SupabaseClient,
  sourceId: string,
): Promise<PreparedArchive | null> {
  const { data: agreement, error } = await supabase
    .from("tenancy_agreements")
    .select(
      "id, tenancy_id, rendered_content, status, signed_at, term_start_date, tenant_name_snapshot, property_name_snapshot, room_name_snapshot",
    )
    .eq("id", sourceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!agreement) return null;

  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("tenant_id, property_id, room_id, status, checkout_date")
    .eq("id", agreement.tenancy_id)
    .maybeSingle();
  if (!tenancy) throw new Error("Tenancy for agreement was not found.");

  const [{ data: tenant }, { data: property }, { data: room }] =
    await Promise.all([
      supabase
        .from("tenants")
        .select("full_name, profile_id")
        .eq("id", tenancy.tenant_id)
        .maybeSingle(),
      supabase
        .from("properties")
        .select("property_code, name, area")
        .eq("id", tenancy.property_id)
        .maybeSingle(),
      supabase
        .from("rooms")
        .select("room_number, name")
        .eq("id", tenancy.room_id)
        .maybeSingle(),
    ]);
  const { data: signatureRecord } = await supabase
    .from("tenancy_agreement_signatures")
    .select("signature_url, signed_at")
    .eq("agreement_id", agreement.id)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let signatureBytes: Uint8Array | null = null;
  if (signatureRecord?.signature_url) {
    const { data: signature } = await supabase.storage
      .from("tenancy-signatures")
      .download(signatureRecord.signature_url);
    if (signature) {
      signatureBytes = new Uint8Array(await signature.arrayBuffer());
    }
  }
  const appendixDocuments = await loadAgreementAppendixDocuments(supabase, {
    tenancyId: agreement.tenancy_id,
    tenantProfileId: tenant?.profile_id,
  });
  const signed = ["signed", "renewal_signed"].includes(agreement.status);
  const bytes = await createAgreementPdf({
    content: agreement.rendered_content,
    signerName: signed
      ? agreement.tenant_name_snapshot ?? tenant?.full_name ?? "Tenant"
      : null,
    signedAt: signatureRecord?.signed_at ?? agreement.signed_at,
    tenantSignatureBytes: signatureBytes,
    appendixDocuments,
  });
  const checkedOut =
    Boolean(tenancy.checkout_date) ||
    ["completed", "terminated", "cancelled", "ended"].includes(tenancy.status);
  const propertyCode =
    property?.property_code ??
    agreement.property_name_snapshot ??
    property?.name;
  const roomNumber =
    agreement.room_name_snapshot ?? room?.room_number ?? room?.name;

  return {
    path: [
      "02 TENANCY AGREEMENTS",
      checkedOut ? "CHECKED OUT" : "ACTIVE",
      folderPart(property?.area ?? propertyCode, "UNASSIGNED AREA"),
    ],
    name: agreementPdfName({
      tenantName: agreement.tenant_name_snapshot ?? tenant?.full_name,
      propertyCode,
      roomNumber,
      termStartDate: agreement.term_start_date,
    }),
    bytes,
  };
}

async function prepareUtilityBill(
  supabase: SupabaseClient,
  sourceId: string,
): Promise<PreparedArchive | null> {
  const { data: bill, error } = await supabase
    .from("utility_bills")
    .select(
      "id, property_id, utility_type, bill_month, amount, paid_amount, status, account_number, reference_number, due_date, payment_date, notes, bill_attachment_path, bill_attachment_name, bill_attachment_type, receipt_path, receipt_name, receipt_type",
    )
    .eq("id", sourceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!bill) return null;

  const { data: property } = await supabase
    .from("properties")
    .select("name, property_code, area")
    .eq("id", bill.property_id)
    .maybeSingle();
  const attachments = (
    await Promise.all([
      storageAttachment(supabase, {
        bucket: "utility-bill-documents",
        path: bill.bill_attachment_path,
        fileName: bill.bill_attachment_name,
        contentType: bill.bill_attachment_type,
        label: "Original utility bill",
      }),
      storageAttachment(supabase, {
        bucket: "utility-bill-documents",
        path: bill.receipt_path,
        fileName: bill.receipt_name,
        contentType: bill.receipt_type,
        label: "Utility payment receipt",
      }),
    ])
  ).filter((item): item is ArchiveAttachment => Boolean(item));
  const outstanding = Math.max(
    numberValue(bill.amount) - numberValue(bill.paid_amount),
    0,
  );
  const propertyCode =
    property?.property_code ?? property?.name ?? "PROPERTY";
  const bytes = await createArchivePdf({
    title: "UTILITY BILL",
    subtitle: `${bill.utility_type.toUpperCase()} / ${monthLabel(bill.bill_month)}`,
    sections: [
      {
        heading: "Property Utility",
        rows: [
          ["Property", property?.name ?? propertyCode],
          ["Utility Type", bill.utility_type.replaceAll("_", " ").toUpperCase()],
          ["Billing Month", monthLabel(bill.bill_month)],
          ["Account Number", bill.account_number ?? "-"],
          ["Reference Number", bill.reference_number ?? "-"],
          ["Due Date", dateLabel(bill.due_date)],
          ["Payment Date", dateLabel(bill.payment_date)],
          ["Status", bill.status.replaceAll("_", " ").toUpperCase()],
        ],
      },
      {
        heading: "Amounts",
        rows: [
          ["Bill Amount", money(bill.amount)],
          ["Paid Amount", money(bill.paid_amount)],
          ["Outstanding", money(outstanding)],
          ["Notes", bill.notes ?? "-"],
        ],
      },
    ],
    attachments,
  });

  return {
    path: [
      "03 UTILITIES & EXPENSES",
      monthFolder(bill.bill_month),
      folderPart(property?.area ?? propertyCode, "UNASSIGNED AREA"),
    ],
    name: `${filePart(propertyCode, "PROPERTY")}_${filePart(
      bill.utility_type,
      "UTILITY",
    )}_${monthFolder(bill.bill_month)}.pdf`,
    bytes,
  };
}

async function prepareExpenseBill(
  supabase: SupabaseClient,
  sourceId: string,
): Promise<PreparedArchive | null> {
  const { data: expense, error } = await supabase
    .from("expenses")
    .select(
      "id, property_id, category_id, expense_date, amount, tax_amount, supplier, description, payment_method, funding_source, charge_to, status, receipt_number, rejection_reason",
    )
    .eq("id", sourceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!expense) return null;

  const [{ data: property }, { data: category }, { data: attachmentRows }] =
    await Promise.all([
      expense.property_id
        ? supabase
            .from("properties")
            .select("name, property_code, area")
            .eq("id", expense.property_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      expense.category_id
        ? supabase
            .from("expense_categories")
            .select("name")
            .eq("id", expense.category_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("expense_attachments")
        .select("bucket_name, file_path, file_name, content_type")
        .eq("expense_id", expense.id)
        .order("created_at", { ascending: true }),
    ]);
  const attachments: ArchiveAttachment[] = [];
  for (const [index, attachment] of (attachmentRows ?? []).entries()) {
    const downloaded = await storageAttachment(supabase, {
      bucket: attachment.bucket_name,
      path: attachment.file_path,
      fileName: attachment.file_name,
      contentType: attachment.content_type,
      label: `Expense bill or receipt ${index + 1}`,
    });
    if (downloaded) attachments.push(downloaded);
  }
  const propertyCode =
    property?.property_code ?? property?.name ?? "GENERAL";
  const bytes = await createArchivePdf({
    title: "EXPENSE RECORD",
    subtitle: dateLabel(expense.expense_date),
    sections: [
      {
        heading: "Expense",
        rows: [
          ["Property", property?.name ?? "General company expense"],
          ["Category", category?.name ?? "-"],
          ["Expense Date", dateLabel(expense.expense_date)],
          ["Supplier / Payee", expense.supplier ?? "-"],
          ["Description", expense.description ?? "-"],
          ["Receipt Number", expense.receipt_number ?? "-"],
          ["Payment Method", expense.payment_method.replaceAll("_", " ")],
          ["Funding Source", expense.funding_source.replaceAll("_", " ")],
          ["Charge To", expense.charge_to.replaceAll("_", " ")],
          ["Status", expense.status.replaceAll("_", " ").toUpperCase()],
        ],
      },
      {
        heading: "Amounts",
        rows: [
          ["Amount", money(expense.amount)],
          ["Tax Amount", money(expense.tax_amount)],
          ["Rejection Reason", expense.rejection_reason ?? "-"],
        ],
      },
    ],
    attachments,
  });

  return {
    path: [
      "03 UTILITIES & EXPENSES",
      monthFolder(expense.expense_date),
      folderPart(property?.area ?? propertyCode, "GENERAL"),
    ],
    name: `EXPENSE_${dateLabel(expense.expense_date).replaceAll("/", "")}_${filePart(
      expense.supplier ?? expense.description,
      expense.id.slice(0, 8),
    )}_${expense.id.slice(0, 8).toUpperCase()}.pdf`,
    bytes,
  };
}

async function prepareArchive(
  supabase: SupabaseClient,
  job: ArchiveJob,
) {
  switch (job.source_type) {
    case "rental_invoice":
      return prepareRentalInvoice(supabase, job.source_id);
    case "tenancy_agreement":
      return prepareTenancyAgreement(supabase, job.source_id);
    case "utility_bill":
      return prepareUtilityBill(supabase, job.source_id);
    case "expense_bill":
      return prepareExpenseBill(supabase, job.source_id);
  }
}

function retryAt(attemptCount: number) {
  const minutes = Math.min(5 * 2 ** Math.max(attemptCount - 1, 0), 24 * 60);
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export async function processDocumentArchiveJobs(limit = 4) {
  getDriveArchiveConfig();
  const supabase = createAdminClient();
  const staleProcessing = new Date(Date.now() - 20 * 60_000).toISOString();
  await supabase
    .from("document_archive_jobs")
    .update({
      status: "failed",
      next_attempt_at: new Date().toISOString(),
      last_error: "Recovered a stale archive job.",
      updated_at: new Date().toISOString(),
    })
    .eq("status", "processing")
    .lt("processing_started_at", staleProcessing);

  const { data: jobs, error } = await supabase
    .from("document_archive_jobs")
    .select(
      "id, source_type, source_id, archive_year, attempt_count, drive_file_id, content_checksum",
    )
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 10));
  if (error) throw new Error(error.message);

  const results: Array<{
    id: string;
    sourceType: string;
    status: "completed" | "failed" | "skipped";
    error?: string;
  }> = [];

  for (const rawJob of jobs ?? []) {
    const job = rawJob as ArchiveJob;
    const attemptCount = job.attempt_count + 1;
    const { data: claimed } = await supabase
      .from("document_archive_jobs")
      .update({
        status: "processing",
        attempt_count: attemptCount,
        processing_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .in("status", ["pending", "failed"])
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    try {
      const prepared = await prepareArchive(supabase, job);
      if (!prepared) {
        await supabase
          .from("document_archive_jobs")
          .update({
            status: "completed",
            archived_at: new Date().toISOString(),
            processing_started_at: null,
            last_error: "Source record no longer exists; prior Drive copy retained.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        results.push({
          id: job.id,
          sourceType: job.source_type,
          status: "skipped",
        });
        continue;
      }

      const checksum = createHash("sha256")
        .update(prepared.bytes)
        .digest("hex");
      if (
        job.drive_file_id &&
        job.content_checksum === checksum
      ) {
        await supabase
          .from("document_archive_jobs")
          .update({
            status: "completed",
            archived_at: new Date().toISOString(),
            processing_started_at: null,
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        results.push({
          id: job.id,
          sourceType: job.source_type,
          status: "completed",
        });
        continue;
      }

      const archived = await archivePdfToDrive({
        archiveYear: job.archive_year,
        path: prepared.path,
        name: prepared.name,
        bytes: prepared.bytes,
        existingFileId: job.drive_file_id,
      });
      await supabase
        .from("document_archive_jobs")
        .update({
          status: "completed",
          drive_file_id: archived.fileId,
          drive_url: archived.url,
          drive_path: archived.path,
          content_checksum: checksum,
          archived_at: new Date().toISOString(),
          processing_started_at: null,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      results.push({
        id: job.id,
        sourceType: job.source_type,
        status: "completed",
      });
    } catch (archiveError) {
      const message =
        archiveError instanceof Error
          ? archiveError.message
          : "Unknown document archive error.";
      await supabase
        .from("document_archive_jobs")
        .update({
          status: "failed",
          next_attempt_at: retryAt(attemptCount),
          processing_started_at: null,
          last_error: message.slice(0, 2000),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      results.push({
        id: job.id,
        sourceType: job.source_type,
        status: "failed",
        error: message,
      });
    }
  }

  return {
    processed: results.length,
    completed: results.filter((result) => result.status === "completed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
}
