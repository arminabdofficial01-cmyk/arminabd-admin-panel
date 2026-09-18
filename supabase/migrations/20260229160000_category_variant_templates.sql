-- Per-category default variant options (sizes/colors) for the admin product form.
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS sizes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS colors TEXT[] NOT NULL DEFAULT '{}';
