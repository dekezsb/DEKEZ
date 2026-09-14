# Payment voucher account selection

Every money-out payment voucher uses the active company Chart of Accounts, grouped into Assets, Liabilities, Equity, Income and Expenses. New active custom accounts appear automatically. Each line has its own account, outlet, description and amount. The source bank's own ledger is excluded to prevent a circular entry.

The server validates company/account ownership, active status, property scope, unlocked period, positive two-decimal amounts and an exact total against the bank line's remaining amount. Saving is atomic and repeat saving cannot allocate the same amount twice. Existing bills must be matched rather than entered again.

Voucher offsets feed balance-sheet balances and outlet comparisons; only income/expense offsets feed P&L. The imported bank balance already contains the bank side, so it is not added twice. The balance-sheet voucher query is paginated and fails visibly on errors.

September 2026 release repair: restore the shared full-account selector on top of the live tenant-registration release; correct the database decimal validation. No existing business transactions are rewritten.
