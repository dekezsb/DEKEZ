# Rental and deposit payment folders

- Rent Due Tracker and the management dashboard open the same payment folder.
- Rental history is grouped by invoice / billing month. Deposit history is grouped by tenancy across months. Do not merge tenants merely because they used the same room.
- Three optional slip boxes are shown for each tab; staff may add more. Each transfer has its own amount, date, bank reference, photo/PDF and note.
- Save all selected boxes together in the UI, but transmit each file separately to respect hosting upload limits. Snapshot form data before disabling controls. Show per-box success/failure; retry using the same submission key.
- Saved slips remain visible. Pending uploads never reduce the official balance. Still to submit is official outstanding less pending submissions, never below zero. Flag pending totals above the balance.
- Block identical file fingerprints or normalized bank references for the same tenancy; compare older same-invoice files without fingerprints. Similar amount/date requires an explicit confirmation that it is a different transfer. Re-photographed slips cannot reliably be recognized by file hashing; bank reference and manual bank checks remain necessary.
- Verification shows all slips inside a selected folder, including earlier verified slips. New folder slips have an explicit bank-received confirmation. Posting payment, updating the balance and recording verification are transactional and idempotent.
- Do not bulk-verify receipts solely because they were uploaded together. Do not infer receipt amounts from the rental charge.
- Legacy combined rent/deposit slips remain visible, but are excluded from separate pending summary totals until their allocation is reviewed.
- BDS and PTT retain their existing single-slip registration/payment workflow.

Checks: TypeScript; payment-folder unit/render tests; rollback-only database tests for duplicate submission, idempotent verification, rental totals and deposit separation. Signed-in browser verification must be reported separately from these checks.
