-- Emergency contacts are no longer collected or printed by DEKEZ.
-- Signed agreements are immutable and are intentionally excluded.
update public.tenancy_agreements
set
  rendered_content = regexp_replace(
    rendered_content,
    E'\\n+### EMERGENCY CONTACT\\n+Name:[^\\n]*\\nContact No\\.:[^\\n]*\\nRelationship:[^\\n]*\\n+',
    E'\\n\\n',
    'g'
  ),
  updated_at = now()
where signed_at is null
  and rendered_content ilike '%emergency contact%';

-- Remove the obsolete block from the template currently used for new
-- agreements. Historical inactive templates remain available for audit.
update public.tenancy_agreement_templates
set
  template_content = regexp_replace(
    template_content,
    E'\\n+### EMERGENCY CONTACT\\n+Name:[^\\n]*\\nContact No\\.:[^\\n]*\\nRelationship:[^\\n]*\\n+',
    E'\\n\\n',
    'g'
  ),
  updated_at = now()
where is_active
  and template_content ilike '%emergency contact%';
