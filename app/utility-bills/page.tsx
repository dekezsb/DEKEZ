import { Link } from "@/components/app-link";
import {
  Banknote,
  CalendarDays,
  FileText,
  Pencil,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DocumentPreview } from "@/components/ui/document-preview";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { formatMalaysiaDate } from "@/lib/date-format";
import { statusBadgeClass } from "@/lib/status-styles";
import { createClient } from "@/lib/supabase/server";
import { createUtilityBill, updateUtilityBill } from "./actions";
import { UtilityBillActions } from "./utility-controls";

const ringgitFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

type UtilityBillsPageProps = {
  searchParams: Promise<{
    created?: string;
    updated?: string;
    paid?: string;
    receipt?: string;
    cancelled?: string;
    error?: string;
    existing?: string;
    edit?: string;
    view?: string;
    property?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  missing: "Please complete all required bill fields and check the amounts.",
  property: "The selected property was not found or is not assigned to your account.",
  duplicate: "A bill for this property, utility type and billing month already exists. Edit the existing bill instead.",
  create: "The utility bill could not be saved.",
  update: "The utility bill could not be updated.",
  upload: "The bill or receipt file could not be uploaded.",
  file_size: "The selected file is larger than 10 MB.",
  file_type: "Only images and PDF documents can be uploaded.",
  cancel_reason: "A cancellation reason is required.",
};

function relatedProperty(
  value: { name?: string | null } | { name?: string | null }[] | null,
) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function utilityLabel(type: string) {
  return type.charAt(0).toUpperCase() + type.slice(1).replaceAll("_", " ");
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    partially_paid: "Partially Paid",
    partial: "Partially Paid",
    unpaid: "Unpaid",
    paid: "Paid",
    overdue: "Overdue",
    cancelled: "Cancelled",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}

function monthLabel(value: string) {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function dateLabel(value: string | null) {
  return formatMalaysiaDate(value);
}

function fieldClass() {
  return "mt-1.5 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-sm text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20";
}

export default async function UtilityBillsPage({ searchParams }: UtilityBillsPageProps) {
  await requireRole(["super_admin", "owner", "admin"]);
  const params = await searchParams;
  const supabase = await createClient();
  let billsQuery = supabase
    .from("utility_bills")
    .select(
      "id, property_id, utility_type, bill_month, amount, paid_amount, status, account_number, reference_number, due_date, payment_date, notes, bill_attachment_path, bill_attachment_name, bill_attachment_type, receipt_path, receipt_name, receipt_type, created_at, properties(name)",
    )
    .eq("billing_scope", "property")
    .order("bill_month", { ascending: false })
    .order("created_at", { ascending: false });
  if (params.property) {
    billsQuery = billsQuery.eq("property_id", params.property);
  }

  const [billsResult, propertiesResult] = await Promise.all([
    billsQuery,
    supabase
      .from("properties")
      .select("id, name, property_code")
      .order("name", { ascending: true }),
  ]);
  const bills = billsResult.data ?? [];
  const properties = propertiesResult.data ?? [];
  const editBill = bills.find((bill) => bill.id === params.edit);
  const viewBill = bills.find((bill) => bill.id === params.view);
  const signedDocuments = new Map<string, string>();

  await Promise.all(
    bills.flatMap((bill) =>
      [
        ["bill", bill.bill_attachment_path],
        ["receipt", bill.receipt_path],
      ].map(async ([kind, path]) => {
        if (!path) return;
        const { data } = await supabase.storage
          .from("utility-bill-documents")
          .createSignedUrl(path, 60 * 60);
        if (data?.signedUrl) signedDocuments.set(`${bill.id}:${kind}`, data.signedUrl);
      }),
    ),
  );

  const activeBills = bills.filter((bill) => bill.status !== "cancelled");
  const totalAmount = activeBills.reduce((sum, bill) => sum + Number(bill.amount ?? 0), 0);
  const totalPaid = activeBills.reduce((sum, bill) => sum + Number(bill.paid_amount ?? 0), 0);
  const totalOutstanding = activeBills.reduce(
    (sum, bill) => sum + Math.max(Number(bill.amount ?? 0) - Number(bill.paid_amount ?? 0), 0),
    0,
  );
  const overdueCount = activeBills.filter((bill) => bill.status === "overdue").length;
  const successMessage =
    params.created === "1"
      ? "Property utility bill saved successfully."
      : params.updated === "1"
        ? "Utility bill updated successfully."
        : params.paid === "1"
          ? "Utility bill marked as paid."
          : params.receipt === "1"
            ? "Receipt uploaded successfully."
            : params.cancelled === "1"
              ? "Utility bill cancelled. Its history was kept."
              : null;

  return (
    <section className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase text-[#126b5f]">Property Expenses</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Property Utility Bills</h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-600">
            Create and manage water, electricity or other utility bills for a property.
          </p>
        </div>
        {params.property ? (
          <Button asChild variant="outline">
            <Link href="/utility-bills">Show All Properties</Link>
          </Button>
        ) : null}
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        These are the main property bills paid by DEKEZ and reported to Owners. Individual tenant
        smart-meter readings remain separate in Room Details.
      </div>
      {successMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {successMessage}
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {errorMessages[params.error] ?? "The utility bill request could not be completed."}
          {params.existing ? (
            <Link className="ml-2 underline" href={`?edit=${params.existing}#utility-form`}>
              Edit existing bill
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <ReceiptText className="h-5 w-5 text-[#126b5f]" />
            <CardDescription>Total Property Bills</CardDescription>
            <CardTitle>{ringgitFormatter.format(totalAmount)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <Banknote className="h-5 w-5 text-[#126b5f]" />
            <CardDescription>Amount Paid</CardDescription>
            <CardTitle>{ringgitFormatter.format(totalPaid)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <WalletCards className="h-5 w-5 text-amber-700" />
            <CardDescription>Outstanding</CardDescription>
            <CardTitle>{ringgitFormatter.format(totalOutstanding)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CalendarDays className="h-5 w-5 text-red-600" />
            <CardDescription>Overdue Bills</CardDescription>
            <CardTitle>{overdueCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card id="utility-form">
        <CardHeader>
          <CardTitle>{editBill ? "Edit Utility Bill" : "Add Utility Bill"}</CardTitle>
          <CardDescription>
            One bill is allowed per property, utility type and billing month.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {properties.length ? (
            <form
              action={editBill ? updateUtilityBill : createUtilityBill}
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
            >
              {editBill ? <input name="billId" type="hidden" value={editBill.id} /> : null}
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Property</span>
                <select
                  className={fieldClass()}
                  defaultValue={editBill?.property_id ?? params.property ?? ""}
                  name="propertyId"
                  required
                >
                  <option disabled value="">Select property</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.property_code ? `${property.property_code} - ` : ""}
                      {property.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Type</span>
                <select
                  className={fieldClass()}
                  defaultValue={editBill?.utility_type ?? "water"}
                  name="utilityType"
                >
                  <option value="water">Water</option>
                  <option value="electricity">Electricity</option>
                  <option value="sewerage">Sewerage</option>
                  <option value="internet">Internet</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Billing month</span>
                <input
                  className={fieldClass()}
                  defaultValue={editBill?.bill_month?.slice(0, 7) ?? ""}
                  name="billMonth"
                  required
                  type="month"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Bill amount (RM)</span>
                <input
                  className={fieldClass()}
                  defaultValue={editBill?.amount ?? ""}
                  min="0.01"
                  name="amount"
                  required
                  step="0.01"
                  type="number"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Due date</span>
                <input
                  className={fieldClass()}
                  defaultValue={editBill?.due_date ?? ""}
                  name="dueDate"
                  type="date"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Payment status</span>
                <select
                  className={fieldClass()}
                  defaultValue={editBill?.status ?? "unpaid"}
                  name="paymentStatus"
                >
                  <option value="unpaid">Unpaid</option>
                  <option value="partially_paid">Partially Paid</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Amount paid (RM)</span>
                <input
                  className={fieldClass()}
                  defaultValue={editBill?.paid_amount ?? 0}
                  min="0"
                  name="paidAmount"
                  step="0.01"
                  type="number"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Payment date</span>
                <input
                  className={fieldClass()}
                  defaultValue={editBill?.payment_date ?? ""}
                  name="paymentDate"
                  type="date"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Account number, optional</span>
                <input
                  className={fieldClass()}
                  defaultValue={editBill?.account_number ?? ""}
                  name="accountNumber"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Bill reference, optional</span>
                <input
                  className={fieldClass()}
                  defaultValue={editBill?.reference_number ?? ""}
                  name="referenceNumber"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Upload bill</span>
                <input
                  accept="image/*,application/pdf"
                  className={`${fieldClass()} file:mr-3 file:border-0 file:bg-transparent`}
                  name="billFile"
                  type="file"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Upload receipt</span>
                <input
                  accept="image/*,application/pdf"
                  className={`${fieldClass()} file:mr-3 file:border-0 file:bg-transparent`}
                  name="receiptFile"
                  type="file"
                />
              </label>
              <label className="block sm:col-span-2 xl:col-span-4">
                <span className="text-sm font-medium text-gray-700">Notes</span>
                <textarea
                  className={`${fieldClass()} min-h-24 resize-y`}
                  defaultValue={editBill?.notes ?? ""}
                  name="notes"
                />
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-4">
                <Button type="submit">{editBill ? "Save Changes" : "Add Bill"}</Button>
                {editBill ? (
                  <Button asChild variant="outline">
                    <Link href={params.property ? `/utility-bills?property=${params.property}` : "/utility-bills"}>
                      Cancel Edit
                    </Link>
                  </Button>
                ) : null}
              </div>
            </form>
          ) : (
            <p className="text-sm text-gray-500">
              Create or assign a property before adding utility bills.
            </p>
          )}
        </CardContent>
      </Card>

      {viewBill ? (
        <Card>
          <CardHeader>
            <CardTitle>Utility Bill Details</CardTitle>
            <CardDescription>
              {relatedProperty(viewBill.properties)?.name ?? "Property"} ·{" "}
              {utilityLabel(viewBill.utility_type)} · {monthLabel(viewBill.bill_month)}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <p><span className="block text-gray-500">Bill amount</span>{ringgitFormatter.format(Number(viewBill.amount ?? 0))}</p>
            <p><span className="block text-gray-500">Paid amount</span>{ringgitFormatter.format(Number(viewBill.paid_amount ?? 0))}</p>
            <p><span className="block text-gray-500">Outstanding</span>{ringgitFormatter.format(Math.max(Number(viewBill.amount ?? 0) - Number(viewBill.paid_amount ?? 0), 0))}</p>
            <p><span className="block text-gray-500">Status</span>{statusLabel(viewBill.status)}</p>
            <p><span className="block text-gray-500">Account number</span>{viewBill.account_number ?? "-"}</p>
            <p><span className="block text-gray-500">Reference</span>{viewBill.reference_number ?? "-"}</p>
            <p><span className="block text-gray-500">Due date</span>{dateLabel(viewBill.due_date)}</p>
            <p><span className="block text-gray-500">Payment date</span>{dateLabel(viewBill.payment_date)}</p>
            <p className="sm:col-span-2 lg:col-span-4"><span className="block text-gray-500">Notes</span>{viewBill.notes ?? "-"}</p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Property Bills</CardTitle>
          <CardDescription>
            Property-level operating expenses visible to your assigned role.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bills.length ? (
            <>
              <div className="hidden overflow-x-auto xl:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Property</TableHead>
                      <TableHead>Utility</TableHead>
                      <TableHead>Month</TableHead>
                      <TableHead>Bill Amount</TableHead>
                      <TableHead>Paid</TableHead>
                      <TableHead>Outstanding</TableHead>
                      <TableHead>Due / Paid</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Documents</TableHead>
                      <TableHead className="min-w-72">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bills.map((bill) => {
                      const amount = Number(bill.amount ?? 0);
                      const paid = Number(bill.paid_amount ?? 0);
                      const propertyName = relatedProperty(bill.properties)?.name ?? "Property";
                      return (
                        <TableRow id={`bill-${bill.id}`} key={bill.id}>
                          <TableCell className="font-medium text-gray-950">{propertyName}</TableCell>
                          <TableCell>{utilityLabel(bill.utility_type)}</TableCell>
                          <TableCell>{monthLabel(bill.bill_month)}</TableCell>
                          <TableCell>{ringgitFormatter.format(amount)}</TableCell>
                          <TableCell>{ringgitFormatter.format(paid)}</TableCell>
                          <TableCell className={amount - paid > 0 ? "font-medium text-red-600" : "text-emerald-700"}>
                            {ringgitFormatter.format(Math.max(amount - paid, 0))}
                          </TableCell>
                          <TableCell>
                            <p>{dateLabel(bill.due_date)}</p>
                            <p className="text-xs text-gray-500">Paid: {dateLabel(bill.payment_date)}</p>
                          </TableCell>
                          <TableCell>
                            <Badge className={statusBadgeClass(bill.status)}>{statusLabel(bill.status)}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              {signedDocuments.get(`${bill.id}:bill`) ? (
                                <DocumentPreview
                                  contentType={bill.bill_attachment_type}
                                  fileName={bill.bill_attachment_name}
                                  label="Utility bill"
                                  showName={false}
                                  size="sm"
                                  url={signedDocuments.get(`${bill.id}:bill`)}
                                />
                              ) : null}
                              {signedDocuments.get(`${bill.id}:receipt`) ? (
                                <DocumentPreview
                                  contentType={bill.receipt_type}
                                  fileName={bill.receipt_name}
                                  label="Utility receipt"
                                  showName={false}
                                  size="sm"
                                  url={signedDocuments.get(`${bill.id}:receipt`)}
                                />
                              ) : null}
                              {!signedDocuments.get(`${bill.id}:bill`)
                              && !signedDocuments.get(`${bill.id}:receipt`) ? (
                                <span className="text-gray-400">No documents</span>
                                ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-2">
                                <Button asChild size="sm" variant="outline">
                                  <Link href={`?view=${bill.id}${params.property ? `&property=${params.property}` : ""}#bill-${bill.id}`}>
                                    <FileText className="h-4 w-4" /> View
                                  </Link>
                                </Button>
                                {bill.status !== "cancelled" ? (
                                  <Button asChild size="sm" variant="outline">
                                    <Link href={`?edit=${bill.id}${params.property ? `&property=${params.property}` : ""}#utility-form`}>
                                      <Pencil className="h-4 w-4" /> Edit
                                    </Link>
                                  </Button>
                                ) : null}
                              </div>
                              <UtilityBillActions
                                amount={ringgitFormatter.format(amount)}
                                billId={bill.id}
                                billMonth={monthLabel(bill.bill_month)}
                                isCancelled={bill.status === "cancelled"}
                                isPaid={bill.status === "paid"}
                                propertyId={bill.property_id}
                                propertyName={propertyName}
                                utilityLabel={utilityLabel(bill.utility_type)}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="grid gap-4 xl:hidden">
                {bills.map((bill) => {
                  const amount = Number(bill.amount ?? 0);
                  const paid = Number(bill.paid_amount ?? 0);
                  const propertyName = relatedProperty(bill.properties)?.name ?? "Property";
                  return (
                    <article className="rounded-md border border-[#d7dde5] p-4" id={`bill-${bill.id}`} key={bill.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-gray-950">{propertyName}</h3>
                          <p className="text-sm text-gray-600">{utilityLabel(bill.utility_type)} · {monthLabel(bill.bill_month)}</p>
                        </div>
                        <Badge className={statusBadgeClass(bill.status)}>{statusLabel(bill.status)}</Badge>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <p><span className="block text-gray-500">Bill</span>{ringgitFormatter.format(amount)}</p>
                        <p><span className="block text-gray-500">Paid</span>{ringgitFormatter.format(paid)}</p>
                        <p><span className="block text-gray-500">Outstanding</span><span className={amount - paid > 0 ? "text-red-600" : "text-emerald-700"}>{ringgitFormatter.format(Math.max(amount - paid, 0))}</span></p>
                        <p><span className="block text-gray-500">Due date</span>{dateLabel(bill.due_date)}</p>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2 border-t border-[#e5e9ef] pt-4">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`?view=${bill.id}#bill-${bill.id}`}>View</Link>
                        </Button>
                        {bill.status !== "cancelled" ? (
                          <Button asChild size="sm" variant="outline">
                            <Link href={`?edit=${bill.id}#utility-form`}>Edit</Link>
                          </Button>
                        ) : null}
                      </div>
                      <div className="mt-3 flex gap-3">
                        {signedDocuments.get(`${bill.id}:bill`) ? (
                          <DocumentPreview
                            contentType={bill.bill_attachment_type}
                            fileName={bill.bill_attachment_name}
                            label="Utility bill"
                            url={signedDocuments.get(`${bill.id}:bill`)}
                          />
                        ) : null}
                        {signedDocuments.get(`${bill.id}:receipt`) ? (
                          <DocumentPreview
                            contentType={bill.receipt_type}
                            fileName={bill.receipt_name}
                            label="Utility receipt"
                            url={signedDocuments.get(`${bill.id}:receipt`)}
                          />
                        ) : null}
                      </div>
                      <div className="mt-3">
                        <UtilityBillActions
                          amount={ringgitFormatter.format(amount)}
                          billId={bill.id}
                          billMonth={monthLabel(bill.bill_month)}
                          isCancelled={bill.status === "cancelled"}
                          isPaid={bill.status === "paid"}
                          propertyId={bill.property_id}
                          propertyName={propertyName}
                          utilityLabel={utilityLabel(bill.utility_type)}
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">No property utility bills have been recorded yet.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
