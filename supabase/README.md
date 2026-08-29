# Supabase setup

## Apply migrations

Run all migrations against the production project before deploying the admin panel:

```bash
supabase link --project-ref mywtkefesizcratdqrzs
supabase db push
```

Or apply the SQL files in `supabase/migrations/` manually via the Supabase SQL editor.

## Promote an admin user

After the first admin account signs up, run `supabase/seed_admin.sql` in the SQL editor (replace the email address).

## Verify RLS

1. Sign in as a customer account and confirm admin routes redirect to `/unauthorized`.
2. Sign in as an admin and confirm products, orders, and settings load.
3. Run `select public.is_admin();` while authenticated as admin — it should return `true`.
