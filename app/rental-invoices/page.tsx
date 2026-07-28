import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import {
  getHistoricalInvoiceOptions,
  getRentalInvoiceArchive,
} from "@/lib/data/rental-invoices";
import { invoiceDate, invoiceMonth } from "@/lib/invoices/format";
import { statusBadgeClass } from "@/lib/status-styles";
import { HistoricalInvoiceForm } from "./historical-invoice-form";
import { InvoiceActions } from "./invoice-actions";

type PageProps = {
  searchParams: Promise<{
    invoice?: string;
    month?: string;
    page?: string;
    status?: string;
    created?: string;
    existing?: string;
    removed?: string;
    error?: string;
  }>;
};

const money = new Intl.NumberFormat("en-MY", {
  currency: "MYR",
  style: "currency",
});

const statuses = [
  "all",
  "draft",
  "upcoming",
  "due_today",
  "overdue",
  "payment_submitted",
  "pending_verification",
  "partially_paid",
  "partial",
  "paid",
  "waived",
  "cancelled",
];

const errorMessages: Record<string, string> = {
  missing: "Complete all required invoice fields and check the amounts.",
  balance: "The outstanding amount does not match the selected payment status.",
  selection: "The selected tenant, property, or room could not be verified.",
  duplicate: "An invoice already exists for this tenant and rental month.",
  create: "The historical invoice could not be created.",
  remove_reason: "A reason is required before removing an invoice.",
  remove: "The invoice could not be removed or voided.",
};

function archiveHref(
  query: Awaited<PageProps["searchParams"]>,
  page: number,
) {
  const params = new URLSearchParams();
  if (query.invoice) params.set("invoice", query.invoice);
  if (query.month) params.set("month", query.month);
  if (query.status) params.set("status", query.status);
  params.set("page", String(page));
  return `/rental-invoices?${params.toString()}`;
}

export default async function RentalInvoicesPage({
  searchParams,
}: PageProps) {
  const role = await requireRole(["super_admin", "admin", "owner"], {
    module: "rent_due_tracker",
    level: "view",
  });
  const query = await searchParams;
  const page = Math.max(Number(query.page ?? 1) || 1, 1);
  const canManage = role === "super_admin" || role === "admin";
  const [archive, options] = await Promise.all([
    getRentalInvoiceArchive({
      invoiceNumber: query.invoice,
      month: query.month,
      page,
      status: query.status,
    }),
    canManage
      ? getHistoricalInvoiceOptions()
      : Promise.resolve({ tenants: [], properties: [], rooms: [] }),
  ]);
  const pageCount = Math.max(
    Math.ceil(archive.total / archive.pageSize),
    1,
  );

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#b17f19]">
          Billing Archive
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          Rental Invoices
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Permanent monthly rental invoices with running invoice numbers.
        </p>
      </div>

      {query.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessages[query.error] ?? "The invoice action could not be completed."}
        </div>
      ) : null}
      {query.created ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Historical rental invoice created with the next running invoice number.
        </div>
      ) : null}
      {query.removed === "deleted" ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          The clean draft invoice was removed. Its original details remain in the audit log.
        </div>
      ) : null}
      {query.removed === "voided" ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          The invoice was marked Cancelled and retained with its audit history.
        </div>
      ) : null}
      {query.existing ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>An invoice already exists for that tenant and rental month.</span>
          <Button asChild size="sm" variant="outline">
            <Link href={`/invoices/${query.existing}`}>Open Existing Invoice</Link>
          </Button>
        </div>
      ) : null}

      {canManage ? (
        <Card id="historical-invoice">
          <CardHeader>
            <CardTitle>Add Missing Historical Invoice</CardTitle>
            <CardDescription>
              Add an accounting invoice for a current or former tenant without
              reopening their tenancy or changing payment history.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HistoricalInvoiceForm
              properties={options.properties}
              rooms={options.rooms}
              tenants={options.tenants}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Find Invoices</CardTitle>
          <CardDescription>
            Search by invoice number, rental month, or payment status.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_14rem_14rem_auto]">
            <input
              className="h-10 rounded-md border border-[#cfd6df] bg-white px-3 text-sm"
              defaultValue={query.invoice}
              name="invoice"
              placeholder="Invoice number"
            />
            <input
              className="h-10 rounded-md border border-[#cfd6df] bg-white px-3 text-sm"
              defaultValue={query.month}
              name="month"
              type="month"
            />
            <select
              className="h-10 rounded-md border border-[#cfd6df] bg-white px-3 text-sm"
              defaultValue={query.status ?? "all"}
              name="status"
            >
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status === "all"
                    ? "All statuses"
                    : status.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <Button type="submit">Search</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Invoice Archive</CardTitle>
            <CardDescription>
              {archive.total} invoice{archive.total === 1 ? "" : "s"} retained.
            </CardDescription>
          </div>
          <FileText className="h-5 w-5 text-[#b17f19]" />
        </CardHeader>
        <CardContent>
          {archive.invoices.length ? (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice No.</TableHead>
                      <TableHead>Invoice Date</TableHead>
                      <TableHead>Rental Month</TableHead>
                      <TableHead>Tenant</TableHead>
                      <TableHead>Property / Room</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Outstanding</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Retain Until</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {archive.invoices.map((invoice) => (
                      <TableRow id={`invoice-${invoice.id}`} key={invoice.id}>
                        <TableCell className="font-semibold">
                          {invoice.invoiceNumber}
                        </TableCell>
                        <TableCell>{invoiceDate(invoice.invoiceDate)}</TableCell>
                        <TableCell>{invoiceMonth(invoice.billMonth)}</TableCell>
                        <TableCell>{invoice.tenantName}</TableCell>
                        <TableCell>
                          {invoice.propertyCode || invoice.propertyName} /{" "}
                          {invoice.roomName}
                        </TableCell>
                        <TableCell>{money.format(invoice.amount)}</TableCell>
                        <TableCell
                          className={
                            invoice.outstanding > 0
                              ? "font-medium text-red-600"
                              : "text-emerald-700"
                          }
                        >
                          {money.format(invoice.outstanding)}
                        </TableCell>
                        <TableCell>
                          <Badge className={statusBadgeClass(invoice.status)}>
                            {invoice.status.replaceAll("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {invoiceDate(invoice.retainUntil)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button asChild size="sm" variant="outline">
                              <Link href={`/invoices/${invoice.id}`}>
                                View / Print
                              </Link>
                            </Button>
                            {canManage && invoice.status !== "cancelled" ? (
                              <InvoiceActions
                                invoiceId={invoice.id}
                                invoiceNumber={invoice.invoiceNumber}
                                tenantName={invoice.tenantName}
                              />
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-3 lg:hidden">
                {archive.invoices.map((invoice) => (
                  <article
                    className="rounded-md border border-[#d7dde5] p-4"
                    id={`invoice-${invoice.id}`}
                    key={invoice.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">
                          {invoice.invoiceNumber}
                        </p>
                        <p className="mt-1 text-sm text-gray-600">
                          {invoice.tenantName}
                        </p>
                        <p className="mt-1 text-sm text-gray-600">
                          {invoice.propertyCode || invoice.propertyName} /{" "}
                          {invoice.roomName}
                        </p>
                      </div>
                      <Badge className={statusBadgeClass(invoice.status)}>
                        {invoice.status.replaceAll("_", " ")}
                      </Badge>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-gray-500">Invoice date</dt>
                        <dd>{invoiceDate(invoice.invoiceDate)}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Rental month</dt>
                        <dd>{invoiceMonth(invoice.billMonth)}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Amount</dt>
                        <dd>{money.format(invoice.amount)}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Outstanding</dt>
                        <dd
                          className={
                            invoice.outstanding > 0
                              ? "font-semibold text-red-600"
                              : "font-semibold text-emerald-700"
                          }
                        >
                          {money.format(invoice.outstanding)}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-4 grid gap-2">
                      <Button asChild className="w-full" variant="outline">
                        <Link href={`/invoices/${invoice.id}`}>
                          View / Print
                        </Link>
                      </Button>
                      {canManage && invoice.status !== "cancelled" ? (
                        <InvoiceActions
                          invoiceId={invoice.id}
                          invoiceNumber={invoice.invoiceNumber}
                          tenantName={invoice.tenantName}
                        />
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">
              No invoices match these filters.
            </p>
          )}

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-[#e3e7ec] pt-4">
            <Button
              asChild={page > 1}
              disabled={page <= 1}
              variant="outline"
            >
              {page > 1 ? (
                <Link href={archiveHref(query, page - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Link>
              ) : (
                <span>
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </span>
              )}
            </Button>
            <p className="text-sm text-gray-600">
              Page {Math.min(page, pageCount)} of {pageCount}
            </p>
            <Button
              asChild={page < pageCount}
              disabled={page >= pageCount}
              variant="outline"
            >
              {page < pageCount ? (
                <Link href={archiveHref(query, page + 1)}>
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Link>
              ) : (
                <span>
                  Next
                  <ChevronRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
