with ranked_pending_submissions as (
  select
    id,
    row_number() over (
      partition by rent_bill_id
      order by created_at desc, id desc
    ) as submission_rank
  from public.payment_submissions
  where rent_bill_id is not null
    and verification_status = 'pending_verification'
)
update public.payment_submissions as submission
set
  verification_status = 'rejected',
  rejection_reason = coalesce(
    nullif(submission.rejection_reason, ''),
    'Superseded duplicate submission'
  ),
  updated_at = now()
from ranked_pending_submissions as ranked
where submission.id = ranked.id
  and ranked.submission_rank > 1;

create unique index if not exists payment_submissions_one_pending_per_rent_bill
  on public.payment_submissions (rent_bill_id)
  where rent_bill_id is not null
    and verification_status = 'pending_verification';
