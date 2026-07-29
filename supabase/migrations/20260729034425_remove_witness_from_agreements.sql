-- Witness details are no longer part of the DEKEZ agreement workflow.
-- Signed agreements remain immutable and are intentionally excluded.
update public.tenancy_agreements
set
  rendered_content = regexp_replace(
    rendered_content,
    E'\\n+### WITNESS\\n+Witness Name:[^\\n]*\\nIC / Passport No\\.:[^\\n]*\\n+Signature:\\n+[^\\n]*\\n+Date:\\n+[^\\n]*\\n*',
    E'\\n\\n',
    'g'
  ),
  updated_at = now()
where signed_at is null
  and rendered_content ilike '%witness%';

-- Keep the currently active database template aligned immediately. The
-- application will install version 8 of the master template on next use.
update public.tenancy_agreement_templates
set
  template_content = regexp_replace(
    template_content,
    E'\\n+### WITNESS\\n+Witness Name:[^\\n]*\\nIC / Passport No\\.:[^\\n]*\\n+Signature:\\n+[^\\n]*\\n+Date:\\n+[^\\n]*\\n*',
    E'\\n\\n',
    'g'
  ),
  updated_at = now()
where is_active
  and template_content ilike '%witness%';
