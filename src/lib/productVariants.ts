export const AUTO_SKU_PLACEHOLDER = "Auto on save";

export interface VariantGroupDefinition {
  id: string;
  slug: string;
  name_en: string;
  name_bn: string;
  display_type: string;
  sort_order: number;
}

export interface CategoryVariantGroupConfig {
  variant_group_id: string;
  slug: string;
  name_en: string;
  name_bn: string;
  display_type: string;
  is_required: boolean;
  options: string[];
  sort_order: number;
}

export interface VariantCombination {
  id?: string;
  attributes: Record<string, string>;
  sku: string;
  stock: string;
  expires_at: string;
  skuManuallyEdited: boolean;
}

export interface ProductVariantState {
  dimensionValues: Record<string, string[]>;
  combinations: VariantCombination[];
}

export const EMPTY_VARIANT_STATE: ProductVariantState = {
  dimensionValues: {},
  combinations: [],
};

const SKU_ABBREV: Record<string, string> = {
  size: "SZ",
  colour: "CL",
  form: "FM",
  fragrance: "FR",
  finish: "FN",
  pack_size: "PK",
};

export function normalizeAttributes(attributes: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    const trimmed = value?.trim();
    if (trimmed) normalized[key] = trimmed;
  }
  return normalized;
}

export function attributesKey(attributes: Record<string, string>): string {
  return Object.entries(normalizeAttributes(attributes))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value.toLowerCase()}`)
    .join("|");
}

export function syncLegacySizeColor(attributes: Record<string, string>): {
  size: string | null;
  color: string | null;
} {
  const normalized = normalizeAttributes(attributes);
  return {
    size: normalized.size || null,
    color: normalized.colour || null,
  };
}

export function legacyAttributesFromVariant(
  size: string | null,
  color: string | null
): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (size?.trim()) attributes.size = size.trim();
  if (color?.trim()) attributes.colour = color.trim();
  return attributes;
}

export function generateVariantSku(
  displayId: string,
  attributes: Record<string, string>
): string {
  const id = displayId.trim().toUpperCase();
  const normalized = normalizeAttributes(attributes);
  const entries = Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) return `${id}-DEFAULT`;

  const parts = [id];
  for (const [slug, value] of entries) {
    const prefix = SKU_ABBREV[slug] || slug.slice(0, 2).toUpperCase();
    const valuePart = value.replace(/\s+/g, "").replace(/[^A-Za-z0-9+]/g, "").toUpperCase();
    parts.push(`${prefix}-${valuePart || "X"}`);
  }

  return parts.join("-");
}

function cartesianAttributes(
  groups: { slug: string; values: string[] }[]
): Record<string, string>[] {
  if (groups.length === 0) return [{}];

  return groups.reduce<Record<string, string>[]>(
    (acc, group) => {
      const values = group.values.length > 0 ? group.values : [""];
      const next: Record<string, string>[] = [];
      for (const combo of acc) {
        for (const value of values) {
          next.push({ ...combo, [group.slug]: value });
        }
      }
      return next;
    },
    [{}]
  );
}

export function buildVariantCombinations(
  configs: CategoryVariantGroupConfig[],
  dimensionValues: Record<string, string[]>,
  displayId: string | null,
  existingCombos: VariantCombination[] = []
): VariantCombination[] {
  const groups = configs
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((config) => ({
      slug: config.slug,
      values: dimensionValues[config.slug] ?? config.options ?? [],
    }));

  const attributeSets = cartesianAttributes(groups);

  return attributeSets.map((attributes) => {
    const normalized = normalizeAttributes(attributes);
    const key = attributesKey(normalized);
    const existing = existingCombos.find(
      (combo) => attributesKey(combo.attributes) === key
    );

    const autoSku = displayId
      ? generateVariantSku(displayId, normalized)
      : AUTO_SKU_PLACEHOLDER;

    return {
      id: existing?.id,
      attributes: normalized,
      sku: existing?.skuManuallyEdited ? existing.sku : autoSku,
      stock: existing?.stock ?? "0",
      expires_at: existing?.expires_at ?? "",
      skuManuallyEdited: existing?.skuManuallyEdited ?? false,
    };
  });
}

export function mergeDimensionValues(
  configs: CategoryVariantGroupConfig[],
  ...sources: Array<Record<string, string[]> | undefined>
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};

  for (const config of configs) {
    const collected: string[] = [];
    for (const source of sources) {
      if (source?.[config.slug]) collected.push(...source[config.slug]);
    }
    if (config.options.length > 0) collected.push(...config.options);
    merged[config.slug] = normalizeTagValues(collected);
  }

  return merged;
}

export function normalizeTagValues(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export function findDuplicateAttributeKeys(
  combos: VariantCombination[]
): string | null {
  const seen = new Set<string>();
  for (const combo of combos) {
    const key = attributesKey(combo.attributes);
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}

export function resolveVariantSkus(
  combos: VariantCombination[],
  displayId: string,
  options: { isCreateFlow: boolean }
): VariantCombination[] {
  return combos.map((combo) => {
    const autoSku = generateVariantSku(displayId, combo.attributes);
    const keepManualSku =
      !options.isCreateFlow &&
      combo.skuManuallyEdited &&
      combo.sku !== AUTO_SKU_PLACEHOLDER;

    return {
      ...combo,
      sku: keepManualSku ? combo.sku.trim().toUpperCase() : autoSku,
    };
  });
}

export interface VariantLookup {
  byKey: Map<string, string>;
  bySku: Map<string, string>;
}

export function buildVariantLookup(
  variants: {
    id: string;
    attributes?: Record<string, string> | null;
    size?: string | null;
    color?: string | null;
    sku: string;
  }[]
): VariantLookup {
  const byKey = new Map<string, string>();
  const bySku = new Map<string, string>();

  for (const variant of variants) {
    const attributes =
      variant.attributes && Object.keys(variant.attributes).length > 0
        ? normalizeAttributes(variant.attributes as Record<string, string>)
        : legacyAttributesFromVariant(variant.size || null, variant.color || null);

    byKey.set(attributesKey(attributes), variant.id);
    bySku.set(variant.sku.trim().toUpperCase(), variant.id);
  }

  return { byKey, bySku };
}

export function resolveVariantId(
  combo: VariantCombination,
  lookup: VariantLookup
): string | null {
  if (combo.id) return combo.id;

  const keyMatch = lookup.byKey.get(attributesKey(combo.attributes));
  if (keyMatch) return keyMatch;

  const sku = combo.sku.trim().toUpperCase();
  if (sku && sku !== AUTO_SKU_PLACEHOLDER.toUpperCase()) {
    return lookup.bySku.get(sku) ?? null;
  }

  return null;
}

export function formatAttributesLabel(attributes: Record<string, string>): string {
  const normalized = normalizeAttributes(attributes);
  const parts = Object.entries(normalized).map(([, value]) => value);
  return parts.length > 0 ? parts.join(" / ") : "Default";
}
