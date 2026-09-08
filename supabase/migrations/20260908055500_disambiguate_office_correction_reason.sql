-- PostgreSQL can resolve an input parameter against a same-named table column
-- as ambiguous inside SQL statements. Recompile the correction RPC with the
-- positional parameter reference so the public API argument name stays stable.

do $migration$
declare
  original_definition text;
  corrected_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.issue_corrected_commercial_agreement(uuid,text,text,uuid,uuid)'::regprocedure
  )
  into original_definition;

  corrected_definition := pg_catalog.replace(
    original_definition,
    'btrim(correction_reason)',
    'btrim($2)'
  );
  corrected_definition := pg_catalog.replace(
    corrected_definition,
    'char_length(correction_reason)',
    'char_length($2)'
  );

  if corrected_definition = original_definition
    or position('btrim(correction_reason)' in corrected_definition) > 0
    or position('char_length(correction_reason)' in corrected_definition) > 0
  then
    raise exception 'office_correction_reason_disambiguation_failed';
  end if;

  execute corrected_definition;
end;
$migration$;

comment on function public.issue_corrected_commercial_agreement(
  uuid,
  text,
  text,
  uuid,
  uuid
) is
  'Idempotently issues one auditable corrected and restated commercial-office agreement for the active term while preserving the signed source content and PDF.';
