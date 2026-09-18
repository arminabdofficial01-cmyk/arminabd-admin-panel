import { supabase } from "@/integrations/supabase/client";
import {
  CategoryVariantGroupConfig,
  VariantGroupDefinition,
  normalizeTagValues,
} from "@/lib/productVariants";

export interface VariantGroupCatalog {
  groups: VariantGroupDefinition[];
  optionsBySlug: Record<string, string[]>;
}

export interface CategoryVariantGroupInput {
  variant_group_id: string;
  enabled: boolean;
  is_required: boolean;
  options: string[];
  sort_order: number;
}

export async function fetchVariantGroupCatalog(): Promise<VariantGroupCatalog> {
  const [{ data: groups, error: groupsError }, { data: options, error: optionsError }] =
    await Promise.all([
      supabase
        .from("variant_groups")
        .select("id, slug, name_en, name_bn, display_type, sort_order")
        .order("sort_order"),
      supabase
        .from("variant_group_options")
        .select("value, sort_order, variant_groups!inner(slug)")
        .order("sort_order"),
    ]);

  if (groupsError) throw new Error(`Failed to load variant groups: ${groupsError.message}`);
  if (optionsError) throw new Error(`Failed to load variant options: ${optionsError.message}`);

  const optionsBySlug: Record<string, string[]> = {};
  for (const row of options || []) {
    const slug = (row.variant_groups as { slug: string }).slug;
    if (!optionsBySlug[slug]) optionsBySlug[slug] = [];
    optionsBySlug[slug].push(row.value);
  }

  return {
    groups: (groups || []) as VariantGroupDefinition[],
    optionsBySlug,
  };
}

export async function fetchCategoryVariantConfig(
  categoryId: string
): Promise<CategoryVariantGroupConfig[]> {
  const { data, error } = await supabase
    .from("category_variant_groups")
    .select(
      "is_required, options, sort_order, variant_groups(id, slug, name_en, name_bn, display_type, sort_order)"
    )
    .eq("category_id", categoryId)
    .order("sort_order");

  if (error) throw new Error(`Failed to load category variant config: ${error.message}`);

  return (data || []).map((row) => {
    const group = row.variant_groups as VariantGroupDefinition;
    return {
      variant_group_id: group.id,
      slug: group.slug,
      name_en: group.name_en,
      name_bn: group.name_bn,
      display_type: group.display_type,
      is_required: row.is_required,
      options: row.options || [],
      sort_order: row.sort_order ?? group.sort_order,
    };
  });
}

export async function saveCategoryVariantConfig(
  categoryId: string,
  inputs: CategoryVariantGroupInput[]
): Promise<void> {
  const enabled = inputs.filter((input) => input.enabled);

  const { error: deleteError } = await supabase
    .from("category_variant_groups")
    .delete()
    .eq("category_id", categoryId);

  if (deleteError) {
    throw new Error(`Failed to update category variants: ${deleteError.message}`);
  }

  if (enabled.length === 0) return;

  const { error: insertError } = await supabase.from("category_variant_groups").insert(
    enabled.map((input) => ({
      category_id: categoryId,
      variant_group_id: input.variant_group_id,
      is_required: input.is_required,
      options: normalizeTagValues(input.options),
      sort_order: input.sort_order,
    }))
  );

  if (insertError) {
    throw new Error(`Failed to save category variants: ${insertError.message}`);
  }
}
