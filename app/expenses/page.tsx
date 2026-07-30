import { FileImage, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentPreview } from "@/components/ui/document-preview";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { statusBadgeClass } from "@/lib/status-styles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createExpense, createExpenseCategory, reviewExpense } from "./actions";

const ringgitFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

type ExpenseRecord = {
  id: string;
  property_id: string | null;
  unit_id: string | null;
  room_id: string | null;
  maintenance_ticket_id: string | null;
  claim_id: string | null;
  category_id: string | null;
  expense_date: string;
  amount: number | string | null;
  tax_amount: number | string | null;
  supplier: string | null;
  description: string | null;
  paid_by: string | null;
  payment_method: string;
  funding_source: string;
  reimbursement_source: string | null;
  charge_to: string;
  status: string;
  tax_claimable: boolean;
  uploaded_by: string | null;
  verified_at: string | null;
  created_at: string;
  expense_categories?: { name: string } | { name: string }[] | null;
  properties?: { name: string } | { name: string }[] | null;
  units?: { name: string } | { name: string }[] | null;
  rooms?: { name: string; room_number: string | null } | { name: string; room_number: string | null }[] | null;
  maintenance_tickets?: { ticket_number: string | null } | { ticket_number: string | null }[] | null;
};

type AttachmentRecord = {
  id: string;
  expense_id: string;
  file_path: string;
  file_name: string | null;
  content_type: string | null;
  signedUrl?: string | null;
};

type PageProps = {
  searchParams: Promise<{
    created?: string;
    reviewed?: string;
    error?: string;
    month?: string;
    year?: string;
    property?: string;
    category?: string;
    status?: string;
    charge_to?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  missing: "Please enter amount and category.",
  create: "Expense could not be saved.",
  upload: "Receipt upload failed.",
  category_missing: "Please enter a category name.",
  category_create: "Category could not be created.",
  review_missing: "Choose an expense and review action.",
  review: "Expense review could not be saved.",
  use_claim_payout:
    "Use Verification → Claim Bills to record a staff lump-sum payout with proof.",
};

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

function money(value: number | string | null | undefined) {
  return ringgitFormatter.format(Number(value ?? 0));
}

function single<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function monthKey(dateText: string) {
  return dateText.slice(0, 7);
}

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleString("en-MY", { month: "long", year: "numeric" }).toUpperCase();
}

function sumExpenses(expenses: ExpenseRecord[]) {
  return expenses.reduce((total, expense) => total + Number(expense.amount ?? 0), 0);
}

function groupByMonth(expenses: ExpenseRecord[]) {
  const groups = new Map<string, ExpenseRecord[]>();

  for (const expense of expenses) {
    const key = monthKey(expense.expense_date);
    groups.set(key, [...(groups.get(key) ?? []), expense]);
  }

  return Array.from(groups.entries()).sort(([left], [right]) => right.localeCompare(left));
}

function categorySummary(expenses: ExpenseRecord[]) {
  const totals = new Map<string, number>();

  for (const expense of expenses) {
    const category = single(expense.expense_categories)?.name ?? "Other";
    totals.set(category, (totals.get(category) ?? 0) + Number(expense.amount ?? 0));
  }

  return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
}

export default async function ExpensesPage({ searchParams }: PageProps) {
  const role = await requireRole([
    "super_admin",
    "owner",
    "admin",
    "technician",
    "maintenance_staff",
    "cleaning_staff",
  ]);
  const params = await searchParams;
  const supabase = await getAdmin();
  const currentDate = new Date();
  const selectedMonth = params.month ?? String(currentDate.getMonth() + 1).padStart(2, "0");
  const selectedYear = params.year ?? String(currentDate.getFullYear());

  let expenseQuery = supabase
    .from("expenses")
    .select("id, property_id, unit_id, room_id, maintenance_ticket_id, claim_id, category_id, expense_date, amount, tax_amount, supplier, description, paid_by, payment_method, funding_source, reimbursement_source, charge_to, status, tax_claimable, uploaded_by, verified_at, created_at, expense_categories(name), properties(name), units(name), rooms(name, room_number), maintenance_tickets(ticket_number)")
    .order("expense_date", { ascending: false });

  if (selectedMonth && selectedYear) {
    const start = `${selectedYear}-${selectedMonth}-01`;
    const endDate = new Date(Number(selectedYear), Number(selectedMonth), 1);
    const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-01`;
    expenseQuery = expenseQuery.gte("expense_date", start).lt("expense_date", end);
  }
  if (params.property) {
    expenseQuery = expenseQuery.eq("property_id", params.property);
  }
  if (params.category) {
    expenseQuery = expenseQuery.eq("category_id", params.category);
  }
  if (params.status) {
    expenseQuery = expenseQuery.eq("status", params.status);
  }
  if (params.charge_to) {
    expenseQuery = expenseQuery.eq("charge_to", params.charge_to);
  }

  const [
    expensesResult,
    categoriesResult,
    propertiesResult,
    unitsResult,
    roomsResult,
    ticketsResult,
    claimsResult,
    profilesResult,
  ] = await Promise.all([
    expenseQuery,
    supabase.from("expense_categories").select("id, name").order("name", { ascending: true }),
    supabase.from("properties").select("id, name").order("name", { ascending: true }),
    supabase.from("units").select("id, property_id, name").order("name", { ascending: true }),
    supabase.from("rooms").select("id, property_id, unit_id, name, room_number").order("name", { ascending: true }),
    supabase.from("maintenance_tickets").select("id, ticket_number, description, status").order("created_at", { ascending: false }).limit(100),
    supabase.from("claims").select("id, description, status, total_amount").order("submitted_at", { ascending: false }).limit(100),
    supabase.from("profiles").select("id, full_name, role").order("full_name", { ascending: true }),
  ]);

  const expenses = (expensesResult.data ?? []) as ExpenseRecord[];
  const categories = categoriesResult.data ?? [];
  const properties = propertiesResult.data ?? [];
  const units = unitsResult.data ?? [];
  const rooms = roomsResult.data ?? [];
  const tickets = ticketsResult.data ?? [];
  const claims = claimsResult.data ?? [];
  const profiles = profilesResult.data ?? [];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile.full_name ?? profile.id]));
  const canVerify = ["super_admin", "owner", "admin"].includes(role);

  const { data: attachmentsData } = expenses.length
    ? await supabase
      .from("expense_attachments")
      .select("id, expense_id, file_path, file_name, content_type")
      .in("expense_id", expenses.map((expense) => expense.id))
    : { data: [] };

  const attachmentsByExpense = new Map<string, AttachmentRecord[]>();
  for (const attachment of (attachmentsData ?? []) as AttachmentRecord[]) {
    const { data } = await supabase.storage.from("expense-receipts").createSignedUrl(attachment.file_path, 60 * 10);
    const list = attachmentsByExpense.get(attachment.expense_id) ?? [];
    list.push({ ...attachment, signedUrl: data?.signedUrl ?? null });
    attachmentsByExpense.set(attachment.expense_id, list);
  }

  const groupedExpenses = groupByMonth(expenses);
  const totalThisMonth = sumExpenses(expenses.filter((expense) => expense.status !== "rejected"));
  const propertyExpenses = sumExpenses(expenses.filter((expense) => expense.property_id && expense.status === "verified"));
  const companyExpenses = sumExpenses(expenses.filter((expense) => expense.charge_to === "company" && expense.status === "verified"));
  const pendingExpenses = expenses.filter((expense) => expense.status === "pending_verification").length;
  const taxClaimable = sumExpenses(expenses.filter((expense) => expense.tax_claimable && expense.status === "verified"));

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-[#b98a2c]">Expense Bills</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Expense Bills</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
            Monthly receipt, invoice, property expense and claim-linked spending records.
          </p>
        </div>
        <Button asChild className="bg-[#b98a2c] text-white hover:bg-[#9d7424]">
          <a href="#add-expense">+ Add Expense</a>
        </Button>
      </div>

      {params.created ? (
        <div className="rounded-lg border border-[#b98a2c]/30 bg-white px-4 py-3 text-sm font-medium text-[#9d7424] shadow-sm">
          Saved successfully.
        </div>
      ) : null}
      {params.reviewed === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Expense review saved.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {errorMessages[params.error] ?? "Expense could not be saved."}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard title="Total Expenses This Month" value={money(totalThisMonth)} />
        <SummaryCard title="Property Expenses" value={money(propertyExpenses)} />
        <SummaryCard title="Company Expenses" value={money(companyExpenses)} />
        <SummaryCard title="Pending Verification" value={pendingExpenses} />
        <SummaryCard title="Tax Claimable" value={money(taxClaimable)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Filter by month, property, category, status and charge type.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 lg:grid-cols-6" method="get">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Month</span>
              <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="month" defaultValue={selectedMonth}>
                {Array.from({ length: 12 }, (_, index) => {
                  const value = String(index + 1).padStart(2, "0");
                  return <option key={value} value={value}>{value}</option>;
                })}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Year</span>
              <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="year" defaultValue={selectedYear} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Property</span>
              <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="property" defaultValue={params.property ?? ""}>
                <option value="">All</option>
                {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Category</span>
              <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="category" defaultValue={params.category ?? ""}>
                <option value="">All</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Status</span>
              <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="status" defaultValue={params.status ?? ""}>
                <option value="">All</option>
                <option value="draft">Draft</option>
                <option value="pending_verification">Pending verification</option>
                <option value="verified">Verified</option>
                <option value="rejected">Rejected</option>
                <option value="reimbursed">Reimbursed</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Charge to</span>
              <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="charge_to" defaultValue={params.charge_to ?? ""}>
                <option value="">All</option>
                <option value="company">Company</option>
                <option value="owner">Owner</option>
                <option value="tenant">Tenant</option>
              </select>
            </label>
            <Button className="lg:col-span-6" type="submit" variant="outline">Apply filters</Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {groupedExpenses.map(([key, monthExpenses]) => (
            <Card key={key}>
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>{monthLabel(key)} - {monthExpenses.length} BILLS</CardTitle>
                    <CardDescription>Total: {money(sumExpenses(monthExpenses))}</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {categorySummary(monthExpenses).slice(0, 5).map(([category, total]) => (
                      <Badge className="bg-[#f4ead7] text-[#9d7424]" key={category}>{category} - {money(total)}</Badge>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {monthExpenses.map((expense) => {
                  const category = single(expense.expense_categories)?.name ?? "Other";
                  const property = single(expense.properties)?.name ?? "General Company Expense";
                  const room = single(expense.rooms);
                  const ticket = single(expense.maintenance_tickets);
                  const attachments = attachmentsByExpense.get(expense.id) ?? [];
                  const firstAttachment = attachments[0];
                  const isImage = firstAttachment?.content_type?.startsWith("image/");

                  return (
                    <details className="rounded-lg border border-[#d7dde5] bg-white p-4" key={expense.id}>
                      <summary className="grid cursor-pointer gap-4 sm:grid-cols-[72px_1fr_auto] sm:items-center">
                        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md bg-[#f4f6f8]">
                          {firstAttachment?.signedUrl && isImage ? (
                            <img alt={`Receipt for ${category}`} className="h-full w-full object-cover" src={firstAttachment.signedUrl} />
                          ) : (
                            <FileImage className="h-6 w-6 text-[#496386]" />
                          )}
                        </div>
                        <div>
                          <p className="text-lg font-semibold text-[#07142f]">{money(expense.amount)}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Badge>{category}</Badge>
                            <Badge className={statusBadgeClass(expense.status)}>{expense.status}</Badge>
                            <Badge className="bg-[#eef3f9] text-[#496386]">charge to {expense.charge_to}</Badge>
                          </div>
                          <p className="mt-2 text-sm text-[#496386]">
                            {expense.expense_date} - {property}
                            {room ? ` - ${room.room_number ?? room.name}` : ""}
                          </p>
                          <p className="text-sm text-[#496386]">Uploaded by {profileById.get(expense.uploaded_by ?? "") ?? "-"}</p>
                        </div>
                        <span className="text-sm font-medium text-[#b98a2c]">View details</span>
                      </summary>
                      <div className="mt-4 grid gap-4 border-t border-[#e3e8ef] pt-4 lg:grid-cols-2">
                        <div className="space-y-2 text-sm text-gray-600">
                          <p>Supplier: {expense.supplier ?? "-"}</p>
                          <p>Description: {expense.description ?? "-"}</p>
                          <p>Payment method: {expense.payment_method}</p>
                          <p>Paid from: {expense.funding_source.replaceAll("_", " ")}</p>
                          {expense.reimbursement_source ? (
                            <p>Reimbursed from: {expense.reimbursement_source.replaceAll("_", " ")}</p>
                          ) : null}
                          <p>Tax amount: {money(expense.tax_amount)}</p>
                          <p>Tax claimable: {expense.tax_claimable ? "Yes" : "No"}</p>
                          <p>Maintenance ticket: {ticket?.ticket_number ?? "-"}</p>
                          <p>Claim link: {expense.claim_id ?? "-"}</p>
                        </div>
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-3">
                            {attachments.map((attachment) => (
                              attachment.signedUrl ? (
                                <DocumentPreview
                                  contentType={attachment.content_type}
                                  fileName={attachment.file_name}
                                  key={attachment.id}
                                  label="Expense receipt"
                                  url={attachment.signedUrl}
                                />
                              ) : null
                            ))}
                          </div>
                          {canVerify ? (
                            <form action={reviewExpense} className="grid gap-3">
                              <input name="expenseId" type="hidden" value={expense.id} />
                              <label className="block">
                                <span className="text-sm font-medium text-gray-700">
                                  Bill date
                                </span>
                                <input
                                  className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
                                  defaultValue={expense.expense_date}
                                  name="expenseDate"
                                  required
                                  type="date"
                                />
                                <span className="mt-1 block text-xs text-gray-500">
                                  Expense reports use this month.
                                </span>
                              </label>
                              <label className="block">
                                <span className="text-sm font-medium text-gray-700">Correct amount</span>
                                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="amount" type="number" step="0.01" defaultValue={Number(expense.amount ?? 0)} />
                              </label>
                              <label className="block">
                                <span className="text-sm font-medium text-gray-700">Category</span>
                                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="categoryId" defaultValue={expense.category_id ?? ""}>
                                  {categories.map((categoryItem) => <option key={categoryItem.id} value={categoryItem.id}>{categoryItem.name}</option>)}
                                </select>
                              </label>
                              <label className="block">
                                <span className="text-sm font-medium text-gray-700">Property</span>
                                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="propertyId" defaultValue={expense.property_id ?? ""}>
                                  <option value="">General company expense</option>
                                  {properties.map((propertyItem) => <option key={propertyItem.id} value={propertyItem.id}>{propertyItem.name}</option>)}
                                </select>
                              </label>
                              <label className="block">
                                <span className="text-sm font-medium text-gray-700">Charge to</span>
                                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="chargeTo" defaultValue={expense.charge_to}>
                                  <option value="company">Company</option>
                                  <option value="owner">Owner</option>
                                  <option value="tenant">Tenant</option>
                                </select>
                              </label>
                              <label className="block">
                                <span className="text-sm font-medium text-gray-700">Originally paid from</span>
                                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="fundingSource" defaultValue={expense.funding_source}>
                                  <option value="company_cash">Company cash</option>
                                  <option value="company_bank">Company bank</option>
                                  <option value="staff_personal">Staff personal money</option>
                                </select>
                              </label>
                              <label className="block">
                                <span className="text-sm font-medium text-gray-700">When reimbursing, pay from</span>
                                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="reimbursementSource" defaultValue={expense.reimbursement_source ?? "company_bank"}>
                                  <option value="company_bank">Company bank</option>
                                  <option value="company_cash">Company cash</option>
                                </select>
                              </label>
                              <input className="rounded-md border border-[#d7dde5] px-3 py-2" name="rejectionReason" placeholder="Reason if rejecting" />
                              <div className="grid gap-2 sm:grid-cols-3">
                                <Button name="decision" type="submit" value="verified">Verify</Button>
                                {expense.claim_id &&
                                expense.funding_source === "staff_personal" ? (
                                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-800">
                                    Use Claim Bills lump-sum payout
                                  </div>
                                ) : (
                                  <Button name="decision" type="submit" value="reimbursed" variant="outline">Reimbursed</Button>
                                )}
                                <Button className="border-red-200 text-red-700 hover:bg-red-50" name="decision" type="submit" value="rejected" variant="outline">Reject</Button>
                              </div>
                            </form>
                          ) : null}
                        </div>
                      </div>
                    </details>
                  );
                })}
              </CardContent>
            </Card>
          ))}
          {!groupedExpenses.length ? (
            <Card>
              <CardHeader>
                <CardTitle>No expense bills found</CardTitle>
                <CardDescription>Add your first receipt or change the filters.</CardDescription>
              </CardHeader>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card id="add-expense">
            <CardHeader>
              <CardTitle>+ Add Expense</CardTitle>
              <CardDescription>Take a receipt photo on mobile or upload image/PDF invoice.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={createExpense} className="space-y-4">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Receipt / invoice</span>
                  <input accept="image/*,.pdf" capture="environment" className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="receipt" type="file" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Expense date</span>
                  <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="expenseDate" type="date" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Amount RM</span>
                  <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="amount" type="number" min="0" step="0.01" required />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Tax amount RM</span>
                  <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="taxAmount" type="number" min="0" step="0.01" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Category</span>
                  <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="categoryId" required>
                    <option value="">Choose category</option>
                    {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Property optional</span>
                  <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="propertyId">
                    <option value="">General Company Expense</option>
                    {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Unit optional</span>
                  <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="unitId">
                    <option value="">No unit</option>
                    {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Room optional</span>
                  <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="roomId">
                    <option value="">No room</option>
                    {rooms.map((room) => <option key={room.id} value={room.id}>{room.room_number ?? room.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Maintenance ticket optional</span>
                  <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="maintenanceTicketId">
                    <option value="">No ticket</option>
                    {tickets.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.ticket_number ?? ticket.id} - {ticket.status}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Claim optional</span>
                  <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="claimId">
                    <option value="">No claim link</option>
                    {claims.map((claim) => <option key={claim.id} value={claim.id}>{claim.description ?? claim.id} - {claim.status}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Supplier</span>
                  <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="supplier" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Receipt number</span>
                  <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="receiptNumber" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Paid by</span>
                  <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="paidBy">
                    <option value="">Current user</option>
                    {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name ?? profile.id}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Payment method</span>
                  <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="paymentMethod" defaultValue="cash">
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank transfer</option>
                    <option value="duitnow">DuitNow</option>
                    <option value="online_payment">Online payment</option>
                    <option value="cheque">Cheque</option>
                    <option value="card">Card</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Paid from</span>
                  <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="fundingSource" defaultValue="company_cash">
                    <option value="company_cash">Company cash in hand</option>
                    <option value="company_bank">Company bank account</option>
                    <option value="staff_personal">Staff personal money (company owes staff)</option>
                  </select>
                  <span className="mt-1 block text-xs text-gray-500">
                    This controls the Cash in Hand and Owed to Staff dashboard totals.
                  </span>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Charge to</span>
                  <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="chargeTo" defaultValue="company">
                    <option value="company">Company</option>
                    <option value="owner">Owner</option>
                    <option value="tenant">Tenant</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Description</span>
                  <textarea className="mt-2 min-h-24 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="description" />
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input name="taxClaimable" type="checkbox" />
                  Tax claimable
                </label>
                <Button className="w-full" type="submit">Submit expense</Button>
              </form>
            </CardContent>
          </Card>

          {canVerify ? (
            <Card>
              <CardHeader>
                <CardTitle>Categories</CardTitle>
                <CardDescription>Create custom expense categories.</CardDescription>
              </CardHeader>
              <CardContent>
                <form action={createExpenseCategory} className="space-y-3">
                  <input className="w-full rounded-md border border-[#d7dde5] px-3 py-2" name="categoryName" placeholder="Category name" />
                  <input className="w-full rounded-md border border-[#d7dde5] px-3 py-2" name="categoryDescription" placeholder="Description optional" />
                  <Button className="w-full" type="submit" variant="outline">Add category</Button>
                </form>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function SummaryCard({ title, value }: { title: string; value: string | number }) {
  return (
    <Card>
      <CardHeader>
        <ReceiptText className="h-5 w-5 text-[#b98a2c]" />
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
