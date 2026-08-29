-- Add columns used by the admin panel that were missing from the initial schema.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS short_description TEXT,
  ADD COLUMN IF NOT EXISTS discounted_price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS display_id TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS display_id TEXT,
  ADD COLUMN IF NOT EXISTS order_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS products_display_id_key
  ON public.products (display_id)
  WHERE display_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS orders_display_id_key
  ON public.orders (display_id)
  WHERE display_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS orders_order_id_key
  ON public.orders (order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_deleted_at_idx
  ON public.products (deleted_at);

CREATE INDEX IF NOT EXISTS product_variants_deleted_at_idx
  ON public.product_variants (deleted_at);

-- Human-readable product IDs (e.g. PRD-000001)
CREATE OR REPLACE FUNCTION public.generate_product_display_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_num INTEGER;
BEGIN
  IF NEW.display_id IS NULL THEN
    SELECT COALESCE(MAX(CAST(SUBSTRING(display_id FROM 5) AS INTEGER)), 0) + 1
    INTO next_num
    FROM public.products
    WHERE display_id ~ '^PRD-[0-9]+$';

    NEW.display_id := 'PRD-' || LPAD(next_num::TEXT, 6, '0');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_product_display_id ON public.products;
CREATE TRIGGER set_product_display_id
  BEFORE INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_product_display_id();

-- Human-readable order IDs (e.g. ORD-000001)
CREATE OR REPLACE FUNCTION public.generate_order_display_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_num INTEGER;
BEGIN
  IF NEW.display_id IS NULL THEN
    SELECT COALESCE(MAX(CAST(SUBSTRING(display_id FROM 5) AS INTEGER)), 0) + 1
    INTO next_num
    FROM public.orders
    WHERE display_id ~ '^ORD-[0-9]+$';

    NEW.display_id := 'ORD-' || LPAD(next_num::TEXT, 6, '0');
  END IF;

  IF NEW.order_id IS NULL THEN
    NEW.order_id := NEW.display_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_order_display_id ON public.orders;
CREATE TRIGGER set_order_display_id
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_order_display_id();
