-- One active variant per size+color combination per product
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_product_size_color_active_unique
  ON public.product_variants (product_id, COALESCE(size, ''), COALESCE(color, ''))
  WHERE deleted_at IS NULL;
