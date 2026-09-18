# Supabase setup

## Apply migrations

Run all migrations against the production project before deploying the admin panel:

```bash
supabase link --project-ref mywtkefesizcratdqrzs
supabase db push
```

Or apply the SQL files in `supabase/migrations/` manually via the Supabase SQL editor.

**Required for product upsert (Aug 2026):**

- `20260229120000_add_admin_panel_columns.sql` — display_id, deleted_at, etc.
- `20260229130000_product_variants_sku_active_unique.sql` — unique active SKUs
- `20260229140000_product_variant_upsert_constraints.sql` — one variant per size+color per product
- `20260229150000_backfill_product_display_ids.sql` — backfill display_id on existing products
- `20260229160000_category_variant_templates.sql` — per-category default sizes/colors arrays (legacy; migrated by next migration)
- `20260229170000_ensure_products_storage_bucket.sql` — products storage bucket + admin upload policies
- `20260229180000_dynamic_variant_groups.sql` — dynamic variant groups (size, colour, form, fragrance, finish, pack size), category mapping, `product_variants.attributes`, optional `expires_at`

## Promote an admin user

After the first admin account signs up, run `supabase/seed_admin.sql` in the SQL editor (replace the email address).

## Verify RLS

1. Sign in as a customer account and confirm admin routes redirect to `/unauthorized`.
2. Sign in as an admin and confirm products, orders, and settings load.
3. Run `select public.is_admin();` while authenticated as admin — it should return `true`.

## Keep-alive cron (free tier)

Supabase free-tier projects pause after ~90 days without API activity. A GitHub Actions job fetches recent orders every 2 hours to prevent this.

See **[`cron/README.md`](../cron/README.md)** for setup (GitHub Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) and manual testing.
