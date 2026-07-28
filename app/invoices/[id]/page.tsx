import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { InvoicePrintButton } from "@/components/invoices/invoice-print-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/session";
import { getRentalInvoice } from "@/lib/data/rental-invoices";
import {
  invoiceDate,
  invoiceMonth,
  ringgitInWords,
} from "@/lib/invoices/format";
import { statusBadgeClass } from "@/lib/status-styles";

type PageProps = {
  params: Promise<{ id: string }>;
};

const money = new Intl.NumberFormat("en-MY", {
  currency: "MYR",
  minimumFractionDigits: 2,
  style: "currency",
});

export default async function RentalInvoicePage({ params }: PageProps) {
  const role = await requireRole([
    "super_admin",
    "admin",
    "owner",
    "tenant",
  ]);
  const { id } = await params;
  const invoice = await getRentalInvoice(id);

  if (!invoice) {
    notFound();
  }

  const month = invoiceMonth(invoice.billMonth);
  const invoiceDateLabel = invoiceDate(invoice.invoiceDate);
  const propertyLabel = [invoice.propertyCode, invoice.propertyName]
    .filter(Boolean)
    .join(" - ");
  const description = `${propertyLabel} ${invoice.roomName} - RENTAL FOR ${month.toUpperCase()}`;
  const returnHref = role === "tenant" ? "/payments" : "/rental-invoices";

  return (
    <main className="min-h-screen bg-[#eceff3] px-4 py-6 text-[#17130d] print:bg-white print:p-0 sm:px-6">
      <div className="mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3 print:hidden">
        <Button asChild variant="outline">
          <Link href={returnHref}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>
        <InvoicePrintButton />
      </div>

      <article className="invoice-sheet mx-auto min-h-[277mm] max-w-[210mm] bg-white px-8 py-9 shadow-sm print:min-h-0 print:max-w-none print:px-0 print:py-0 print:shadow-none sm:px-12">
        <header className="grid gap-8 border-b-2 border-[#17130d] pb-7 sm:grid-cols-[1fr_auto]">
          <div className="flex items-start gap-4">
            <BrandLogo className="rounded-sm" priority size={72} />
            <div>
              <h1 className="text-xl font-bold tracking-normal">
                DEKEZ SDN BHD
              </h1>
              <p className="mt-1 text-xs text-gray-600">
                202501054747 (1656153-U)
              </p>
              <address className="mt-3 max-w-md text-xs not-italic leading-5 text-gray-700">
                Lot 30, Kian Yap Industrial Estate, Lorong Durian 3,
                <br />
                Kota Kinabalu, Sabah, Malaysia
                <br />
                Tel: +6016-8173911
                <br />
                TIN: C60479177010
              </address>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-4xl font-light uppercase tracking-normal">
              Invoice
            </p>
            <p className="mt-3 text-sm font-semibold">
              {invoice.invoiceNumber}
            </p>
            <Badge className={`mt-2 ${statusBadgeClass(invoice.status)}`}>
              {invoice.status.replaceAll("_", " ")}
            </Badge>
          </div>
        </header>

        {invoice.status === "cancelled" ? (
          <section className="border-b-2 border-red-700 bg-red-50 px-4 py-3 text-center text-red-800">
            <p className="text-lg font-bold uppercase tracking-normal">
              Cancelled / Voided
            </p>
            {invoice.removalReason ? (
              <p className="mt-1 text-xs">Reason: {invoice.removalReason}</p>
            ) : null}
          </section>
        ) : null}

        <section className="grid gap-8 py-8 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase text-gray-500">
              Billed To
            </p>
            <p className="mt-2 text-base font-bold">{invoice.tenantName}</p>
            {invoice.tenantIdentityNumber ? (
              <p className="mt-1 text-sm text-gray-700">
                IC / Passport: {invoice.tenantIdentityNumber}
              </p>
            ) : null}
            {invoice.tenantPhone ? (
              <p className="mt-1 text-sm text-gray-700">
                {invoice.tenantPhone}
              </p>
            ) : null}
            <p className="mt-2 text-sm text-gray-700">
              {propertyLabel}
              <br />
              {invoice.roomName}
            </p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm sm:justify-self-end">
            <dt className="font-semibold text-gray-600">Invoice Date</dt>
            <dd>{invoiceDateLabel}</dd>
            <dt className="font-semibold text-gray-600">Terms</dt>
            <dd>C.O.D.</dd>
          </dl>
        </section>

        <section className="overflow-hidden border border-[#17130d]">
          <div className="grid grid-cols-[3rem_1fr_4rem_5rem_7rem] bg-[#17130d] px-3 py-2 text-xs font-semibold uppercase text-white">
            <span>Item</span>
            <span>Description</span>
            <span className="text-center">Qty</span>
            <span className="text-center">UOM</span>
            <span className="text-right">Total</span>
          </div>
          <div className="grid min-h-32 grid-cols-[3rem_1fr_4rem_5rem_7rem] px-3 py-4 text-sm">
            <span>1</span>
            <span className="pr-4 font-medium">{description}</span>
            <span className="text-center">1</span>
            <span className="text-center">UNIT</span>
            <span className="text-right">{money.format(invoice.amount)}</span>
          </div>
        </section>

        <section className="grid gap-8 border-b border-[#b9c0c9] py-6 sm:grid-cols-[1fr_18rem]">
          <div>
            <p className="text-xs font-semibold uppercase text-gray-500">
              Amount In Words
            </p>
            <p className="mt-2 text-sm font-medium">
              {ringgitInWords(invoice.amount)}
            </p>
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-5 gap-y-2 text-sm">
            <dt>Subtotal</dt>
            <dd>{money.format(invoice.amount)}</dd>
            <dt>Paid</dt>
            <dd>{money.format(invoice.paidAmount)}</dd>
            <dt className="border-t border-[#17130d] pt-2 text-base font-bold">
              Outstanding
            </dt>
            <dd className="border-t border-[#17130d] pt-2 text-base font-bold">
              {money.format(invoice.outstanding)}
            </dd>
          </dl>
        </section>

        <footer className="grid gap-8 pt-7 text-xs leading-5 text-gray-700 sm:grid-cols-[1fr_auto]">
          <div>
            <p className="font-semibold text-[#17130d]">Payment Details</p>
            <p className="mt-1">
              Public Bank Berhad
              <br />
              Account No: 3247421720
            </p>
            <p className="mt-4 max-w-xl">
              Please include the invoice number as the payment reference.
              Payments are reflected only after verification by DEKEZ.
            </p>
            {invoice.notes ? (
              <p className="mt-4 max-w-xl">
                <span className="font-semibold text-[#17130d]">Notes:</span>{" "}
                {invoice.notes}
              </p>
            ) : null}
          </div>
          <div className="min-w-64 pt-8 text-center">
            <p
              className="mb-2 text-2xl text-[#17130d]"
              style={{
                fontFamily: '"Brush Script MT", "Segoe Script", cursive',
              }}
            >
              DEKEZ SDN BHD
            </p>
            <div className="border-t border-[#17130d] pt-2">
              Authorised Signature
            </div>
          </div>
        </footer>
      </article>
    </main>
  );
}
