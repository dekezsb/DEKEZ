# DEKEZ

DEKEZ Rental Management SaaS — a Next.js + Supabase portal for managing properties, tenants, tenancy agreements, rent payments and accounting reconciliation.

## Development

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and fill in the values before running locally.

## Release checks

`npm run build` runs the mandatory release regression tests first (via `prebuild`). You can run them on their own with:

```bash
npm run test:release-regressions
```

Do not remove or bypass these tests to make a release pass. See [AGENTS.md](AGENTS.md) for the standing requirements every change must preserve.

## Standard operating procedures

- [Monthly tenant invoice generation](docs/monthly-tenant-invoice-sop.md)
- [Tenant payment bank reconciliation (accounting only)](docs/accounting-reconciliation-sop.md)
- [Verified-payment reconciliation](docs/partial-payment-reconciliation.md)

## Feature notes

- [Balance Sheet supporting records and comparisons](docs/balance-sheet-breakdown.md)
- [Rental and deposit payment folders](docs/payment-folders.md)
- [Payment Verification: slip rows and reference-only saving](docs/payment-verification-rows.md)
- [Payment voucher account selection](docs/payment-voucher-accounts.md)
- [Room-scoped reconciliation](docs/room-scoped-reconciliation.md)
- [Reconciliation shows unfinished work only](docs/statement-work-queue.md)
- [Reservations and monthly tenant activity](docs/tenant-activity-pages.md)
- [Bank reference restoration](docs/verification-bank-reference.md)
