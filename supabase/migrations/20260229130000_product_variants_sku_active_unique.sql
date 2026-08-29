-- Enforce unique SKUs among active (non-deleted) product variants.
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_sku_active_unique
  ON public.product_variants (sku)
  WHERE deleted_at IS NULL;
