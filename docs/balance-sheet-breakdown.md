# Balance Sheet supporting records and comparisons

The Balance Sheet shows a full chart-based Assets / Liabilities / Equity list, including inactive accounts and an optional zero-balance display. Every row expands into supporting records for the current and comparison date. Records include date, reference, description, outlet, source and signed balance effect. The row amount is derived from those same records in cents; CSV exports contain both comparison totals and supporting records.

Monthly, six-month, full-year and custom period controls choose the closing date and comparison closing date. These compare point-in-time balances, not sums of monthly balances. The all-outlet table is derived from the same supporting records; shared bank balances appear once under Office / unallocated. Bank figures identify the actual latest statement date used, which can be earlier than the requested date.

Sources: currently outstanding invoices, confirmed deposit receipts, currently unpaid verified bills and staff claims, posted journal lines, bank voucher offsets, imported bank closing balances and YTD P&L supporting records. All chart account types are classified by Assets/Liabilities/Equity, without requiring a particular report-group value. Negative asset adjustments (including contra accounts) reduce assets. Bank-side vouchers are not added again to an imported closing balance.

## Explicit limitations

The existing invoice/bill open-balance model uses current settlement status and editable source records; prior periods are management reconstructions, not immutable historical snapshots. This limitation is displayed on screen. The new report does not silently invent historical settlements or opening journals. The unexplained Assets minus Liabilities minus Equity difference remains visible for both dates and is not automatically classified as income or expense.

No financial transactions, permissions or schema are changed by this report update.
