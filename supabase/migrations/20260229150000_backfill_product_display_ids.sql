-- Backfill display_id for products created before the admin panel migration.
DO $$
DECLARE
  r RECORD;
  next_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(display_id FROM 5) AS INTEGER)), 0)
  INTO next_num
  FROM public.products
  WHERE display_id ~ '^PRD-[0-9]+$';

  FOR r IN
    SELECT id
    FROM public.products
    WHERE display_id IS NULL
    ORDER BY created_at
  LOOP
    next_num := next_num + 1;
    UPDATE public.products
    SET display_id = 'PRD-' || LPAD(next_num::TEXT, 6, '0')
    WHERE id = r.id;
  END LOOP;
END $$;

-- Assign display_id on UPDATE when still missing (not only on INSERT).
DROP TRIGGER IF EXISTS set_product_display_id ON public.products;
CREATE TRIGGER set_product_display_id
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_product_display_id();
