alter table public.rental_invoice_line_items
  drop constraint if exists rental_invoice_line_items_category_check;

alter table public.rental_invoice_line_items
  add constraint rental_invoice_line_items_category_check
  check (
    category = any (
      array[
        'key_lock'::text,
        'electricity'::text,
        'water'::text,
        'access_card'::text,
        'damage'::text,
        'cleaning'::text,
        'furniture'::text,
        'other'::text
      ]
    )
  );
