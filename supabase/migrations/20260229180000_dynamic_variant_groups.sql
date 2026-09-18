-- Dynamic variant groups (Size, Colour, Form, Fragrance, Finish, Pack Size)

CREATE TABLE IF NOT EXISTS public.variant_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name_en TEXT NOT NULL,
  name_bn TEXT NOT NULL,
  display_type TEXT NOT NULL DEFAULT 'button',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.variant_group_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_group_id UUID NOT NULL REFERENCES public.variant_groups(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (variant_group_id, value)
);

CREATE TABLE IF NOT EXISTS public.category_variant_groups (
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  variant_group_id UUID NOT NULL REFERENCES public.variant_groups(id) ON DELETE CASCADE,
  is_required BOOLEAN NOT NULL DEFAULT false,
  options TEXT[] NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (category_id, variant_group_id)
);

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS expires_at DATE;

-- Backfill attributes from legacy size/color columns
UPDATE public.product_variants
SET attributes = jsonb_strip_nulls(
  jsonb_build_object(
    'size', NULLIF(trim(size), ''),
    'colour', NULLIF(trim(color), '')
  )
)
WHERE attributes = '{}'::jsonb
  AND (COALESCE(trim(size), '') <> '' OR COALESCE(trim(color), '') <> '');

ALTER TABLE public.variant_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.variant_group_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_variant_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read variant groups"
  ON public.variant_groups FOR SELECT USING (true);
CREATE POLICY "Admins manage variant groups"
  ON public.variant_groups FOR ALL USING (public.is_admin());

CREATE POLICY "Anyone can read variant group options"
  ON public.variant_group_options FOR SELECT USING (true);
CREATE POLICY "Admins manage variant group options"
  ON public.variant_group_options FOR ALL USING (public.is_admin());

CREATE POLICY "Anyone can read category variant groups"
  ON public.category_variant_groups FOR SELECT USING (true);
CREATE POLICY "Admins manage category variant groups"
  ON public.category_variant_groups FOR ALL USING (public.is_admin());

-- Replace size/color uniqueness with attributes fingerprint
DROP INDEX IF EXISTS public.product_variants_product_size_color_active_unique;

CREATE UNIQUE INDEX IF NOT EXISTS product_variants_product_attributes_active_unique
  ON public.product_variants (product_id, md5(COALESCE(attributes::text, '{}')))
  WHERE deleted_at IS NULL;

-- Seed master variant groups
INSERT INTO public.variant_groups (slug, name_en, name_bn, display_type, sort_order)
VALUES
  ('size', 'Size', 'সাইজ', 'button', 1),
  ('colour', 'Colour / Shade', 'কালার / শেড', 'swatch', 2),
  ('form', 'Form / Type', 'ফর্ম / টাইপ', 'dropdown', 3),
  ('fragrance', 'Fragrance / Flavour', 'সুগন্ধ / ফ্লেভার', 'dropdown', 4),
  ('finish', 'Finish / Strength', 'ফিনিশ / স্ট্রেংথ', 'dropdown', 5),
  ('pack_size', 'Pack Size', 'প্যাক সাইজ', 'button', 6)
ON CONFLICT (slug) DO NOTHING;

-- Seed default option catalog
WITH groups AS (
  SELECT id, slug FROM public.variant_groups
)
INSERT INTO public.variant_group_options (variant_group_id, value, sort_order)
SELECT g.id, opt.value, opt.ord
FROM groups g
JOIN LATERAL (
  VALUES
    ('size', 'S', 1), ('size', 'M', 2), ('size', 'L', 3), ('size', 'XL', 4), ('size', 'XXL', 5),
    ('size', '15ml', 6), ('size', '30ml', 7), ('size', '50ml', 8), ('size', '100ml', 9),
    ('size', '200ml', 10), ('size', '250ml', 11), ('size', '500ml', 12), ('size', '1L', 13),
    ('size', '50g', 14), ('size', '100g', 15), ('size', '250g', 16), ('size', '500g', 17),
    ('size', '30 pcs', 18), ('size', '60 pcs', 19), ('size', '90 pcs', 20),
    ('colour', 'Black', 1), ('colour', 'White', 2), ('colour', 'Navy', 3), ('colour', 'Maroon', 4),
    ('colour', 'Beige', 5), ('colour', 'Ivory 01', 6), ('colour', 'Warm Beige 03', 7),
    ('colour', 'Ruby Red', 8), ('colour', 'Nude Pink', 9), ('colour', 'Metallic Gold', 10),
    ('form', 'Cream', 1), ('form', 'Gel', 2), ('form', 'Serum', 3), ('form', 'Oil', 4),
    ('form', 'Lotion', 5), ('form', 'Powder', 6), ('form', 'Foam', 7), ('form', 'Liquid', 8),
    ('form', 'Stick', 9), ('form', 'Tablet', 10), ('form', 'Capsule', 11), ('form', 'Bar', 12),
    ('fragrance', 'Unscented', 1), ('fragrance', 'Rose', 2), ('fragrance', 'Lavender', 3),
    ('fragrance', 'Coconut', 4), ('fragrance', 'Sandalwood', 5), ('fragrance', 'Citrus', 6),
    ('fragrance', 'Chocolate', 7), ('fragrance', 'Mango', 8), ('fragrance', 'Orange', 9),
    ('fragrance', 'Mixed Berry', 10),
    ('finish', 'Matte', 1), ('finish', 'Glossy', 2), ('finish', 'Satin', 3), ('finish', 'Shimmer', 4),
    ('finish', 'Metallic', 5), ('finish', 'SPF 30', 6), ('finish', 'SPF 50+', 7),
    ('finish', '500mg', 8), ('finish', '1000mg', 9), ('finish', '5000 IU', 10),
    ('pack_size', 'Single', 1), ('pack_size', 'Combo (2 pcs)', 2), ('pack_size', '3-Pack', 3),
    ('pack_size', 'Family Pack', 4), ('pack_size', 'Travel Size', 5), ('pack_size', 'Refill', 6)
) AS opt(group_slug, value, ord) ON opt.group_slug = g.slug
ON CONFLICT (variant_group_id, value) DO NOTHING;

-- Migrate legacy category sizes/colors arrays into category_variant_groups
INSERT INTO public.category_variant_groups (category_id, variant_group_id, is_required, options, sort_order)
SELECT c.id, vg.id, true, c.sizes, 1
FROM public.categories c
CROSS JOIN public.variant_groups vg
WHERE vg.slug = 'size'
  AND COALESCE(array_length(c.sizes, 1), 0) > 0
ON CONFLICT (category_id, variant_group_id) DO UPDATE
SET options = EXCLUDED.options, is_required = true;

INSERT INTO public.category_variant_groups (category_id, variant_group_id, is_required, options, sort_order)
SELECT c.id, vg.id, true, c.colors, 2
FROM public.categories c
CROSS JOIN public.variant_groups vg
WHERE vg.slug = 'colour'
  AND COALESCE(array_length(c.colors, 1), 0) > 0
ON CONFLICT (category_id, variant_group_id) DO UPDATE
SET options = EXCLUDED.options, is_required = true;
