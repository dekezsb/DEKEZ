# Room-scoped reconciliation restoration

This additive change starts from current production with restored confidence filters and protected booking-fee verification; it does not replace either implementation.

- Parse all ten existing property codes and numeric/alphanumeric room numbers from the bank reference and description. Conflicting room references stop matching for review.
- Filter actual dropdown choices and suggestions by the identified property, room and bank month. Do not offer another room when none exists.
- Show same-month invoice links on each identified-room row, including paid invoices. Invoice balance is not used to gate reconciliation of an existing payment.
- Exact-amount unambiguous matches remain ready for the user's Reconcile click. Different amounts and duplicate candidates remain review-only.
- No submission, receipt, payment, bank posting, schema or server reconciliation action is changed by this restoration. Existing split-payment allocation remains separate unfinished work.
- The release suite retains filter, duplicate protection, voucher account, reservation and monthly movement checks; room-scoping checks are added to the same mandatory gate.

The prior tests that expected a wrong-room candidate plus warning now require that candidate to be excluded. Priority fixtures use dates within the same month so they continue to test date/reference/name ranking without allowing cross-month matching.
