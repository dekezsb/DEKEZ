# Reservations and monthly tenant activity

- Main portal menu: **Reservations** (`/reservations`) and **Monthly Check-ins & Check-outs** (`/tenant-movements`). Both are also linked from the main dashboard and from each other.
- Existing property-view permission is required. This release grants no new permissions and exposes no tenant data to public or tenant accounts.
- Reservations reuse the existing reservation applications, instalment slips, check-in request and cancellation actions. The outlet filter does not change a reservation. Cancellation remains restricted to the main account; management actions still require property-manage permission.
- To continue a booking, open its existing reservation and use **Tenant arriving — request check-in** with the actual arrival date. Do not register a second tenant. Approval and payment verification retain their existing workflow.
- The monthly report is read-only. Select a month and either all outlets or one outlet. It reads active/ended tenancies using the saved check-in date (start date only when check-in date is absent), and the saved check-out date. Future dates are not counted as completed activity.
- A tenant checking in and out in the same month appears in both lists. A transfer preserving the original check-in date is not counted as a fresh arrival in the transfer month. The check-in room is the room currently recorded on the tenancy, not a reconstructed historical transfer location.
- Checkout names/rooms and staff details use retained checkout audit snapshots where available. Older records without staff attribution explicitly say so.
- Queries page through records and use the signed-in user's visible properties to scope historical reads. Failed queries show an error instead of false zero totals.
- This release does not change tenant registrations, check-in/check-out dates, reservation conversion, receipts, slips, payment statuses, deposits, invoices, reconciliation or journal entries. No database migration or data correction is included.

Verification: `node --test tests/tenant-movements.test.cjs tests/room-availability-access.test.cjs tests/tenant-reconciliation.test.cjs tests/payment-folder-ui.test.cjs` and `node node_modules/typescript/bin/tsc --noEmit`.
