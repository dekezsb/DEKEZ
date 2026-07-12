# Supabase Setup

Run the migrations in `supabase/migrations` against the DEKEZ Supabase project before enabling production authentication.

Required application environment variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_SERVICE_ROLE_KEY` is reserved for trusted server-side admin tasks. Do not expose it to client components.
