import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StatCard } from "@/components/cards/StatCard";
import { DataTable, Column } from "@/components/table/DataTable";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { ProductVariantEditor } from "@/components/products/ProductVariantEditor";
import { fetchCategoryVariantConfig } from "@/lib/categoryVariantGroups";
import {
  AUTO_SKU_PLACEHOLDER,
  EMPTY_VARIANT_STATE,
  ProductVariantState,
  CategoryVariantGroupConfig,
  VariantCombination,
  buildVariantCombinations,
  mergeDimensionValues,
  findDuplicateAttributeKeys,
  resolveVariantSkus,
  buildVariantLookup,
  resolveVariantId,
  VariantLookup,
  syncLegacySizeColor,
  legacyAttributesFromVariant,
  formatAttributesLabel,
  normalizeAttributes,
} from "@/lib/productVariants";
import { Package, CheckCircle, AlertTriangle, XCircle, Plus, Pencil, Trash2, Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  name: string;
}

interface ProductImage {
  id: string;
  product_id: string;
  image_url: string;
  is_primary: boolean;
  sort_order: number;
}

interface ProductVariant {
  id: string;
  product_id: string;
  size: string | null;
  color: string | null;
  attributes?: Record<string, string> | null;
  expires_at?: string | null;
  sku: string;
  stock: number;
}

interface Product {
  id: string;
  display_id?: string | null;
  name: string;
  short_description: string | null;
  description: string | null;
  category_id: string | null;
  base_price: number;
  discounted_price: number | null;
  is_active: boolean;
  is_featured: boolean;
  deleted_at?: string | null;
  created_at: string;
  categories: { name: string } | null;
  product_variants: Pick<ProductVariant, "stock">[];
  product_images: Pick<ProductImage, "image_url" | "is_primary">[];
}

interface Stats {
  total: number;
  active: number;
  lowStock: number;
  outOfStock: number;
}

// ─── No-spinner number input ──────────────────────────────────────────────────

function NumberInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string | number;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Input
      type="text"
      inputMode="decimal"
      value={value}
      placeholder={placeholder}
      className={className}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
          onChange(raw);
        }
      }}
      style={{ MozAppearance: "textfield" } as React.CSSProperties}
    />
  );
}

interface ProductForm {
  name: string;
  short_description: string;
  description: string;
  category_id: string;
  base_price: string;
  discounted_price: string;
  is_active: boolean;
  is_featured: boolean;
  variantState: ProductVariantState;
  images: File[];
  imagePreviews: string[];
}

const emptyForm: ProductForm = {
  name: "", short_description: "", description: "", category_id: "",
  base_price: "", discounted_price: "",
  is_active: true, is_featured: false,
  variantState: EMPTY_VARIANT_STATE, images: [], imagePreviews: [],
};

// ─── Product identity helpers ─────────────────────────────────────────────────

interface ExistingProductMatch {
  id: string;
  display_id: string | null;
  name: string;
}

function normalizeProductName(name: string): string {
  return name.trim().toLowerCase();
}

function findDuplicateSkus(skus: string[]): string | null {
  const seen = new Set<string>();
  for (const sku of skus) {
    const normalized = sku.trim().toUpperCase();
    if (!normalized || normalized === AUTO_SKU_PLACEHOLDER.toUpperCase()) continue;
    if (seen.has(normalized)) return normalized;
    seen.add(normalized);
  }
  return null;
}

async function ensureProductDisplayId(productId: string): Promise<string> {
  const { data: productRow, error: productRowError } = await supabase
    .from("products")
    .select("display_id")
    .eq("id", productId)
    .single();

  if (productRowError) {
    throw new Error(`Failed to load product display ID: ${productRowError.message}`);
  }

  if (productRow?.display_id) return productRow.display_id;

  const { data: maxRows, error: maxError } = await supabase
    .from("products")
    .select("display_id")
    .like("display_id", "PRD-%")
    .order("display_id", { ascending: false })
    .limit(1);

  if (maxError) {
    throw new Error(`Failed to assign product display ID: ${maxError.message}`);
  }

  const nextNum = maxRows?.[0]?.display_id
    ? parseInt(maxRows[0].display_id.slice(4), 10) + 1
    : 1;
  const displayId = `PRD-${String(nextNum).padStart(6, "0")}`;

  const { error: updateError } = await supabase
    .from("products")
    .update({ display_id: displayId })
    .eq("id", productId);

  if (updateError) {
    throw new Error(`Failed to assign product display ID: ${updateError.message}`);
  }

  return displayId;
}

async function findExistingProduct(
  name: string,
  categoryId: string | null
): Promise<ExistingProductMatch | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  let query = supabase
    .from("products")
    .select("id, display_id, name")
    .is("deleted_at", null)
    .ilike("name", trimmed)
    .limit(1);

  if (categoryId) {
    query = query.eq("category_id", categoryId);
  } else {
    query = query.is("category_id", null);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Product lookup failed: ${error.message}`);

  const match = data?.[0];
  if (!match || normalizeProductName(match.name) !== normalizeProductName(trimmed)) {
    return null;
  }

  return {
    id: match.id,
    display_id: match.display_id,
    name: match.name,
  };
}

async function findConflictingSkusInDb(
  skus: string[],
  excludeVariantIds: string[] = []
): Promise<string[]> {
  const normalizedSkus = [
    ...new Set(
      skus
        .map((sku) => sku.trim().toUpperCase())
        .filter((sku) => sku && sku !== AUTO_SKU_PLACEHOLDER.toUpperCase())
    ),
  ];
  if (normalizedSkus.length === 0) return [];

  const { data, error } = await supabase
    .from("product_variants")
    .select("id, sku")
    .in("sku", normalizedSkus)
    .is("deleted_at", null);

  if (error) throw new Error(`SKU check failed: ${error.message}`);

  const exclude = new Set(excludeVariantIds);
  return (data || [])
    .filter((row) => !exclude.has(row.id))
    .map((row) => row.sku);
}

function formatSaveError(err: unknown): string {
  const message = err instanceof Error ? err.message : "An unknown error occurred";

  if (
    message.includes("product_variants_sku_active_unique") ||
    message.includes("product_variants_product_attributes_active_unique") ||
    message.includes("product_variants_product_size_color_active_unique") ||
    message.includes("duplicate key value violates unique constraint")
  ) {
    const skuMatch = message.match(/Key \(sku\)=\(([^)]+)\)/i);
    if (skuMatch?.[1]) {
      return `SKU "${skuMatch[1]}" is already used by another product. Please change it.`;
    }
    if (message.includes("product_variants_product_attributes_active_unique")) {
      return "A variant with this attribute combination already exists for this product.";
    }
    if (message.includes("product_variants_product_size_color_active_unique")) {
      return "A variant with this size and color already exists for this product.";
    }
    return "This SKU is already used by another product. Please use a unique SKU for each variant.";
  }

  if (message.includes("Bucket not found")) {
    return "Image storage is not configured. Run the Supabase storage migration on your project.";
  }

  if (
    message.includes("row-level security") ||
    message.includes("new row violates row-level security policy")
  ) {
    return "Image upload denied. Ensure your account has admin permissions in Supabase.";
  }

  if (message.includes("Image upload failed") || message.includes("Failed to save image record")) {
    return message;
  }

  return message;
}

async function rollbackCreatedProduct(productId: string) {
  await supabase.from("product_variants").delete().eq("product_id", productId);
  await supabase.from("product_images").delete().eq("product_id", productId);
  await supabase.from("products").delete().eq("id", productId);
}

// ─── Helper: extract storage path from public URL ────────────────────────────

function extractStoragePath(imageUrl: string): string | null {
  try {
    const url = new URL(imageUrl);
    const marker = "/object/public/products/";
    const idx = url.pathname.indexOf(marker);
    if (idx !== -1) return url.pathname.slice(idx + marker.length);
    const fallback = url.pathname.split("/products/");
    return fallback.length > 1 ? fallback[1] : null;
  } catch {
    return null;
  }
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"]);

function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext ? IMAGE_EXTENSIONS.has(ext) : false;
}

function getImageContentType(file: File): string {
  if (file.type.startsWith("image/")) return file.type;

  const ext = file.name.split(".").pop()?.toLowerCase();
  const mimeByExt: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
  };

  return (ext && mimeByExt[ext]) || "image/jpeg";
}

function buildImageStoragePath(productId: string, file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const safeExt = IMAGE_EXTENSIONS.has(ext) ? ext : "jpg";
  return `${productId}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${safeExt}`;
}

const VARIANT_UPDATE_CHUNK = 20;

interface VariantPersistPayload {
  product_id: string;
  attributes: Record<string, string>;
  size: string | null;
  color: string | null;
  sku: string;
  stock: number;
  expires_at: string | null;
}

function buildVariantPayload(
  productId: string,
  combo: VariantCombination
): VariantPersistPayload {
  const legacy = syncLegacySizeColor(combo.attributes);
  return {
    product_id: productId,
    attributes: combo.attributes,
    size: legacy.size,
    color: legacy.color,
    sku: combo.sku,
    stock: parseInt(combo.stock, 10) || 0,
    expires_at: combo.expires_at || null,
  };
}

async function persistProductVariants(
  productId: string,
  combos: VariantCombination[],
  lookup: VariantLookup
): Promise<string[]> {
  const keptVariantIds: string[] = [];
  const toInsert: VariantPersistPayload[] = [];
  const toUpdate: Array<{ id: string; payload: VariantPersistPayload }> = [];

  for (const combo of combos) {
    const payload = buildVariantPayload(productId, combo);
    const variantId = resolveVariantId(combo, lookup);

    if (variantId) {
      toUpdate.push({ id: variantId, payload });
      keptVariantIds.push(variantId);
    } else {
      toInsert.push(payload);
    }
  }

  for (let i = 0; i < toUpdate.length; i += VARIANT_UPDATE_CHUNK) {
    const chunk = toUpdate.slice(i, i + VARIANT_UPDATE_CHUNK);
    const results = await Promise.all(
      chunk.map(({ id, payload }) =>
        supabase.from("product_variants").update(payload).eq("id", id)
      )
    );

    const failed = results.find((result) => result.error);
    if (failed?.error) {
      throw new Error(`Variant update error: ${failed.error.message}`);
    }
  }

  if (toInsert.length === 0) return keptVariantIds;

  const { data: inserted, error: batchInsertError } = await supabase
    .from("product_variants")
    .insert(toInsert)
    .select("id");

  if (!batchInsertError) {
    keptVariantIds.push(...(inserted || []).map((row) => row.id));
    return keptVariantIds;
  }

  if (!batchInsertError.message.includes("product_variants_sku_active_unique")) {
    throw new Error(`Variant insert error: ${batchInsertError.message}`);
  }

  const insertResults = await Promise.all(
    toInsert.map(async (payload) => {
      const { data, error } = await supabase
        .from("product_variants")
        .insert(payload)
        .select("id")
        .single();

      if (error?.message?.includes("product_variants_sku_active_unique")) {
        const fallbackId = lookup.bySku.get(payload.sku.trim().toUpperCase());
        if (fallbackId) {
          const { error: updateError } = await supabase
            .from("product_variants")
            .update(payload)
            .eq("id", fallbackId);
          if (updateError) {
            throw new Error(`Variant update error: ${updateError.message}`);
          }
          return fallbackId;
        }
      }

      if (error) throw new Error(`Variant insert error: ${error.message}`);
      return data?.id ?? null;
    })
  );

  keptVariantIds.push(...insertResults.filter((id): id is string => Boolean(id)));
  return keptVariantIds;
}

async function removeProductImages(
  removedIds: string[],
  existingImages: ProductImage[]
): Promise<void> {
  if (removedIds.length === 0) return;

  await Promise.all(
    removedIds.map(async (imageId) => {
      const image = existingImages.find((img) => img.id === imageId);
      if (!image) return;

      const storagePath = extractStoragePath(image.image_url);
      if (storagePath) {
        await supabase.storage.from("products").remove([storagePath]);
      }

      const { error } = await supabase.from("product_images").delete().eq("id", imageId);
      if (error) throw new Error(`Failed to delete image: ${error.message}`);
    })
  );
}

async function uploadProductImages(
  productId: string,
  files: File[],
  visibleImageCount: number
): Promise<void> {
  if (files.length === 0) return;

  for (const file of files) {
    if (file.size > 5 * 1024 * 1024) {
      throw new Error(`Image ${file.name} exceeds 5MB limit.`);
    }
    if (!isImageFile(file)) {
      throw new Error(`File ${file.name} is not a supported image type.`);
    }
  }

  const uploadPlans = files.map((file, index) => ({
    file,
    path: buildImageStoragePath(productId, file),
    contentType: getImageContentType(file),
    sortOrder: visibleImageCount + index,
    isPrimary: visibleImageCount === 0 && index === 0,
  }));

  const uploadedPaths: string[] = [];

  const imageRows = await Promise.all(
    uploadPlans.map(async (plan) => {
      const { error: uploadError } = await supabase.storage
        .from("products")
        .upload(plan.path, plan.file, {
          cacheControl: "3600",
          upsert: false,
          contentType: plan.contentType,
        });

      if (uploadError) {
        throw new Error(`Image upload failed: ${uploadError.message}`);
      }

      uploadedPaths.push(plan.path);
      const { data: urlData } = supabase.storage.from("products").getPublicUrl(plan.path);

      return {
        product_id: productId,
        image_url: urlData.publicUrl,
        is_primary: plan.isPrimary,
        sort_order: plan.sortOrder,
      };
    })
  );

  const { error: dbError } = await supabase.from("product_images").insert(imageRows);
  if (dbError) {
    await supabase.storage.from("products").remove(uploadedPaths);
    throw new Error(`Failed to save image record: ${dbError.message}`);
  }
}

function combosFromDbVariants(variants: ProductVariant[]): VariantCombination[] {
  return variants.map((variant) => {
    const attributes =
      variant.attributes && Object.keys(variant.attributes).length > 0
        ? normalizeAttributes(variant.attributes)
        : legacyAttributesFromVariant(variant.size, variant.color);

    return {
      id: variant.id,
      attributes,
      sku: variant.sku,
      stock: String(variant.stock),
      expires_at: variant.expires_at || "",
      skuManuallyEdited: true,
    };
  });
}

function buildVariantState(
  configs: CategoryVariantGroupConfig[],
  existingCombos: VariantCombination[],
  displayId: string | null,
  existingDimensionValues?: Record<string, string[]>
): ProductVariantState {
  const dimensionValues = mergeDimensionValues(
    configs,
    existingDimensionValues,
    Object.fromEntries(
      configs.map((config) => [
        config.slug,
        existingCombos.flatMap((combo) =>
          combo.attributes[config.slug] ? [combo.attributes[config.slug]] : []
        ),
      ])
    )
  );

  return {
    dimensionValues,
    combinations: buildVariantCombinations(
      configs,
      dimensionValues,
      displayId,
      existingCombos
    ),
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, lowStock: 0, outOfStock: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [viewProduct, setViewProduct] = useState<Product | null>(null);
  const [viewVariants, setViewVariants] = useState<ProductVariant[]>([]);
  const [viewImages, setViewImages] = useState<ProductImage[]>([]);
  const [existingImages, setExistingImages] = useState<ProductImage[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<string[]>([]);

  const [searchDebounce, setSearchDebounce] = useState("");
  const [productDisplayId, setProductDisplayId] = useState<string | null>(null);
  const [mergePreview, setMergePreview] = useState<ExistingProductMatch | null>(null);
  const [categoryVariantConfigs, setCategoryVariantConfigs] = useState<CategoryVariantGroupConfig[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function getEffectiveDisplayId(): string | null {
    return productDisplayId || mergePreview?.display_id || null;
  }

  function rebuildVariantSkus(displayId: string | null) {
    setForm((f) => ({
      ...f,
      variantState: buildVariantState(
        categoryVariantConfigs,
        f.variantState.combinations,
        displayId,
        f.variantState.dimensionValues
      ),
    }));
  }

  async function loadCategoryVariantConfigs(categoryId: string) {
    if (!categoryId) {
      setCategoryVariantConfigs([]);
      return [];
    }

    const configs = await fetchCategoryVariantConfig(categoryId);
    setCategoryVariantConfigs(configs);
    return configs;
  }

  async function checkForExistingProduct(name: string, categoryId: string) {
    if (editingId || !name.trim()) {
      setMergePreview(null);
      if (!editingId) setProductDisplayId(null);
      return;
    }

    try {
      const existing = await findExistingProduct(name, categoryId || null);
      if (existing) {
        setMergePreview(existing);
        const displayId = existing.display_id;
        if (displayId) setProductDisplayId(displayId);

        const { data: variants, error: variantsError } = await supabase
          .from("product_variants")
          .select("id, size, color, attributes, stock, sku, expires_at")
          .eq("product_id", existing.id)
          .is("deleted_at", null);

        if (variantsError) throw new Error(`Variant lookup failed: ${variantsError.message}`);

        const dbCombos = combosFromDbVariants((variants as ProductVariant[]) || []);
        const lookup = buildVariantLookup((variants as ProductVariant[]) || []);

        setForm((f) => {
          const variantState = buildVariantState(
            categoryVariantConfigs,
            f.variantState.combinations.map((combo) => {
              const matchId = resolveVariantId(combo, lookup);
              const match = dbCombos.find((row) => row.id === matchId);
              return {
                ...combo,
                id: match?.id,
                stock: match ? match.stock : combo.stock,
                expires_at: match?.expires_at ?? combo.expires_at,
                sku: displayId
                  ? resolveVariantSkus([combo], displayId, { isCreateFlow: true })[0].sku
                  : AUTO_SKU_PLACEHOLDER,
                skuManuallyEdited: false,
              };
            }),
            displayId,
            f.variantState.dimensionValues
          );

          return { ...f, variantState };
        });
      } else {
        setMergePreview(null);
        setProductDisplayId(null);
        rebuildVariantSkus(null);
      }
    } catch (err: unknown) {
      toast.error(formatSaveError(err));
    }
  }

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounce(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    return () => {
      form.imagePreviews.forEach(URL.revokeObjectURL);
    };
  }, [form.imagePreviews]);

  const loadProducts = useCallback(async () => {
    setLoading(true);

    let query = supabase
      .from("products")
      .select(
        "*, categories(name), product_variants(stock), product_images(image_url, is_primary)",
        { count: "exact" }
      )
      .is("deleted_at", null);

    if (searchDebounce) {
      query = query.or(
        `name.ilike.%${searchDebounce}%,display_id.ilike.%${searchDebounce}%`
      );
    }

    query = query
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    const { data, count, error } = await query;
    if (error) {
      toast.error(`Failed to load products: ${error.message}`);
      setProducts([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    setProducts((data as Product[]) || []);
    setTotal(count || 0);

    const { data: allVariants, error: variantsError } = await supabase
      .from("product_variants")
      .select("stock, product_id")
      .is("deleted_at", null);

    if (variantsError) {
      toast.error(`Failed to load product stats: ${variantsError.message}`);
      setLoading(false);
      return;
    }

    const { count: activeCount, error: activeError } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .is("deleted_at", null);

    const { count: totalCount, error: totalError } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null);

    if (activeError || totalError) {
      toast.error("Failed to load product counts");
      setLoading(false);
      return;
    }

    const variantsByProduct: Record<string, number> = {};
    (allVariants || []).forEach((v) => {
      variantsByProduct[v.product_id] = (variantsByProduct[v.product_id] || 0) + v.stock;
    });

    setStats({
      total: totalCount || 0,
      active: activeCount || 0,
      lowStock: Object.values(variantsByProduct).filter((s) => s > 0 && s < 5).length,
      outOfStock: Object.values(variantsByProduct).filter((s) => s === 0).length,
    });

    setLoading(false);
  }, [page, searchDebounce]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    supabase
      .from("categories")
      .select("id, name")
      .order("name")
      .then(({ data, error }) => {
        if (error) {
          toast.error(`Failed to load categories: ${error.message}`);
          return;
        }
        setCategories((data as Category[]) || []);
      });
  }, []);

  async function handleCategoryChange(categoryId: string) {
    const displayId = getEffectiveDisplayId();

    try {
      const configs = await loadCategoryVariantConfigs(categoryId);
      setForm((f) => ({
        ...f,
        category_id: categoryId,
        variantState: buildVariantState(
          configs,
          f.variantState.combinations,
          displayId,
          f.variantState.dimensionValues
        ),
      }));
      void checkForExistingProduct(form.name, categoryId);
    } catch (err: unknown) {
      toast.error(formatSaveError(err));
    }
  }

  function resetImageState() {
    setExistingImages([]);
    setRemovedImageIds([]);
  }

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function openAdd() {
    setEditingId(null);
    setForm(emptyForm);
    setCategoryVariantConfigs([]);
    setProductDisplayId(null);
    setMergePreview(null);
    resetImageState();
    setModalOpen(true);
  }

  async function openEdit(id: string) {
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("*")
      .eq("id", id)
      .single();

    const { data: variants, error: variantsError } = await supabase
      .from("product_variants")
      .select("*")
      .eq("product_id", id)
      .is("deleted_at", null);

    const { data: images, error: imagesError } = await supabase
      .from("product_images")
      .select("*")
      .eq("product_id", id)
      .order("sort_order");

    if (productError || variantsError || imagesError) {
      toast.error("Failed to load product for editing");
      return;
    }

    if (product) {
      setEditingId(id);
      setProductDisplayId(product.display_id || null);
      setMergePreview(null);
      resetImageState();
      setExistingImages((images as ProductImage[]) || []);
      const combinations = combosFromDbVariants((variants as ProductVariant[]) || []);
      const configs = product.category_id
        ? await fetchCategoryVariantConfig(product.category_id)
        : [];
      setCategoryVariantConfigs(configs);
      setForm({
        name: product.name,
        short_description: product.short_description || "",
        description: product.description || "",
        category_id: product.category_id || "",
        base_price: String(product.base_price),
        discounted_price: product.discounted_price ? String(product.discounted_price) : "",
        is_active: product.is_active,
        is_featured: product.is_featured,
        variantState: buildVariantState(
          configs,
          combinations,
          product.display_id || null
        ),
        images: [],
        imagePreviews: [],
      });
      setModalOpen(true);
    }
  }

  async function openView(product: Product) {
    setViewProduct(product);
    const [{ data: variants }, { data: images }] = await Promise.all([
      supabase
        .from("product_variants")
        .select("*")
        .eq("product_id", product.id)
        .is("deleted_at", null),
      supabase
        .from("product_images")
        .select("*")
        .eq("product_id", product.id)
        .order("sort_order"),
    ]);
    setViewVariants((variants as ProductVariant[]) || []);
    setViewImages((images as ProductImage[]) || []);
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(e.target.files || []);
    const remaining = 3 - existingImages.length + removedImageIds.length - form.images.length;
    if (remaining <= 0) return;
    const toAdd = incoming.slice(0, remaining);
    const previews = toAdd.map((f) => URL.createObjectURL(f));
    setForm((f) => ({
      ...f,
      images: [...f.images, ...toAdd],
      imagePreviews: [...f.imagePreviews, ...previews],
    }));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeImage(index: number) {
    URL.revokeObjectURL(form.imagePreviews[index]);
    setForm((f) => ({
      ...f,
      images: f.images.filter((_, i) => i !== index),
      imagePreviews: f.imagePreviews.filter((_, i) => i !== index),
    }));
  }

  function removeExistingImage(image: ProductImage) {
    setRemovedImageIds((ids) => [...ids, image.id]);
  }

  const visibleExistingImages = existingImages.filter((img) => !removedImageIds.includes(img.id));
  const totalImageCount = visibleExistingImages.length + form.images.length;

  function handleNameChange(name: string) {
    setForm((f) => ({ ...f, name }));
  }

  function handleVariantStateChange(variantState: ProductVariantState) {
    setForm((f) => ({ ...f, variantState }));
  }

  // ─── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.name) {
      toast.error("Product name is required");
      return;
    }
    if (!form.base_price || isNaN(Number(form.base_price))) {
      toast.error("Valid original price is required");
      return;
    }

    const allCombos = form.variantState.combinations;
    const duplicateVariantKey = findDuplicateAttributeKeys(allCombos);
    if (duplicateVariantKey) {
      toast.error("Duplicate variant combination in form. Each variant must be unique.");
      return;
    }

    for (const config of categoryVariantConfigs) {
      if (!config.is_required) continue;
      const values = form.variantState.dimensionValues[config.slug] ?? config.options;
      if (values.length === 0) {
        toast.error(`${config.name_en} is required for this category. Add at least one option.`);
        return;
      }
    }

    setSaving(true);
    const isCreateFlow = !editingId;
    let createdProductId: string | null = null;
    let shouldRollbackProduct = false;
    let mergedIntoExisting = false;

    try {
      let productId = editingId;
      const baseSlug = form.name
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");

      const productFields = {
        name: form.name,
        short_description: form.short_description || null,
        description: form.description || null,
        category_id: form.category_id || null,
        base_price: Number(form.base_price),
        discounted_price: form.discounted_price ? Number(form.discounted_price) : null,
        is_active: form.is_active,
        is_featured: form.is_featured,
      };

      if (editingId) {
        const { error } = await supabase
          .from("products")
          .update({ ...productFields, slug: baseSlug })
          .eq("id", editingId);
        if (error) throw new Error(`Product update error: ${error.message}`);
      } else {
        const existing = await findExistingProduct(form.name, form.category_id || null);
        if (existing) {
          productId = existing.id;
          mergedIntoExisting = true;
          const { error } = await supabase
            .from("products")
            .update(productFields)
            .eq("id", existing.id);
          if (error) throw new Error(`Product update error: ${error.message}`);
        } else {
          const { data, error } = await supabase
            .from("products")
            .insert({ ...productFields, slug: `${baseSlug}-${Date.now()}` })
            .select("id")
            .single();
          if (error) throw new Error(`Product insert error: ${error.message}`);
          productId = data?.id ?? null;
          createdProductId = productId;
          shouldRollbackProduct = true;
        }
      }

      if (!productId) throw new Error("Failed to get product ID");

      const cachedDisplayId = productDisplayId || mergePreview?.display_id || null;
      const displayId = cachedDisplayId ?? (await ensureProductDisplayId(productId));
      const resolvedCombos = resolveVariantSkus(allCombos, displayId, {
        isCreateFlow,
      });

      const duplicateResolvedSku = findDuplicateSkus(
        resolvedCombos.map((combo) => combo.sku)
      );
      if (duplicateResolvedSku) {
        throw new Error(
          `Duplicate SKU in form: ${duplicateResolvedSku}. Each variant needs a unique SKU.`
        );
      }

      const manualSkus = resolvedCombos
        .filter((combo) => combo.skuManuallyEdited)
        .map((combo) => combo.sku);
      const duplicateManualSku = findDuplicateSkus(manualSkus);
      if (duplicateManualSku) {
        throw new Error(
          `Duplicate SKU in form: ${duplicateManualSku}. Each variant needs a unique SKU.`
        );
      }

      const { data: ownVariants, error: ownVariantsError } = await supabase
        .from("product_variants")
        .select("id, size, color, attributes, sku")
        .eq("product_id", productId)
        .is("deleted_at", null);

      if (ownVariantsError) {
        throw new Error(`Variant lookup failed: ${ownVariantsError.message}`);
      }

      const variantLookup = buildVariantLookup(ownVariants || []);
      const excludeVariantIds = (ownVariants || []).map((variant) => variant.id);
      const conflictingSkus = await findConflictingSkusInDb(
        resolvedCombos.map((combo) => combo.sku),
        excludeVariantIds
      );
      if (conflictingSkus.length > 0) {
        throw new Error(
          `SKU "${conflictingSkus[0]}" is already used by another product. Please change it.`
        );
      }

      const keptVariantIds = await persistProductVariants(
        productId,
        resolvedCombos,
        variantLookup
      );

      shouldRollbackProduct = false;

      if (editingId) {
        const now = new Date().toISOString();
        const toSoftDelete = (ownVariants || [])
          .map((variant) => variant.id)
          .filter((id) => !keptVariantIds.includes(id));

        if (toSoftDelete.length > 0) {
          const { error: softDeleteError } = await supabase
            .from("product_variants")
            .update({ deleted_at: now })
            .in("id", toSoftDelete);

          if (softDeleteError) {
            throw new Error(`Variant cleanup error: ${softDeleteError.message}`);
          }
        }
      }

      await removeProductImages(removedImageIds, existingImages);

      const visibleImageCount = visibleExistingImages.length;

      if (form.images.length > 0) {
        if (visibleImageCount + form.images.length > 3) {
          throw new Error("Maximum 3 images allowed per product.");
        }

        await uploadProductImages(productId, form.images, visibleImageCount);
      }

      if (mergedIntoExisting) {
        toast.success(`Updated existing product ${form.name} (${displayId})`);
      } else {
        toast.success(editingId ? "Product updated" : "Product created");
      }
      setModalOpen(false);
      setProductDisplayId(null);
      setMergePreview(null);
      resetImageState();
      loadProducts();
    } catch (err: unknown) {
      if (isCreateFlow && createdProductId && shouldRollbackProduct) {
        await rollbackCreatedProduct(createdProductId);
      }
      toast.error(formatSaveError(err));
    }
    setSaving(false);
  }

  // ─── Soft Delete ─────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const now = new Date().toISOString();

      const { error: variantError } = await supabase
        .from("product_variants")
        .update({ deleted_at: now })
        .eq("product_id", deleteId);

      if (variantError) throw new Error(`Failed to remove variants: ${variantError.message}`);

      const { error: productError } = await supabase
        .from("products")
        .update({ deleted_at: now, is_active: false })
        .eq("id", deleteId);

      if (productError) throw new Error(`Failed to delete product: ${productError.message}`);

      toast.success("Product deleted");
      setDeleteId(null);
      loadProducts();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete product");
    }
    setDeleting(false);
  }

  // ─── Table columns ──────────────────────────────────────────────────────────

  const columns: Column<Product>[] = [
    {
      key: "image",
      label: "Image",
      render: (r) => {
        const primary =
          r.product_images?.find((i) => i.is_primary)?.image_url ||
          r.product_images?.[0]?.image_url;
        return primary ? (
          <img src={primary} alt={r.name} className="h-10 w-10 rounded object-cover" />
        ) : (
          <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
            <Package className="h-4 w-4 text-muted-foreground" />
          </div>
        );
      },
    },
    {
      key: "display_id",
      label: "Product ID",
      hideOnMobile: true,
      render: (r) => (
        <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded text-muted-foreground whitespace-nowrap">
          {r.display_id ?? "—"}
        </span>
      ),
    },
    {
      key: "name",
      label: "Name",
      render: (r) => <span className="font-medium">{r.name}</span>,
    },
    {
      key: "category",
      label: "Category",
      hideOnMobile: true,
      render: (r) => r.categories?.name || "—",
    },
    {
      key: "price",
      label: "Price",
      render: (r) => (
        <div>
          {r.discounted_price ? (
            <>
              <p className="font-semibold text-sm">
                ৳{Number(r.discounted_price).toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground line-through">
                ৳{Number(r.base_price).toFixed(2)}
              </p>
            </>
          ) : (
            <p className="font-semibold text-sm">
              ৳{Number(r.base_price).toFixed(2)}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "stock",
      label: "Total Stock",
      render: (r) =>
        (r.product_variants || []).reduce((s, v) => s + v.stock, 0),
    },
    {
      key: "variants",
      label: "Variants",
      hideOnMobile: true,
      render: (r) => (r.product_variants || []).length,
    },
    {
      key: "status",
      label: "Status",
      render: (r) => (
        <Badge variant={r.is_active ? "default" : "secondary"}>
          {r.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (r) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => openView(r)}>
            <Eye className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => openEdit(r.id)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDeleteId(r.id)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl sm:text-2xl font-bold">Product Management</h1>
        <Button onClick={openAdd} className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" />
          Add Product
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Products" value={stats.total} icon={Package} />
        <StatCard title="Active Products" value={stats.active} icon={CheckCircle} variant="success" />
        <StatCard title="Low Stock" value={stats.lowStock} icon={AlertTriangle} variant="warning" />
        <StatCard title="Out of Stock" value={stats.outOfStock} icon={XCircle} variant="destructive" />
      </div>

      <Input
        placeholder="Search by name or product ID (e.g. PRD-1001)..."
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        className="w-full sm:max-w-sm"
      />

      <DataTable
        columns={columns}
        data={products}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        loading={loading}
      />

      {/* ── Add / Edit Modal ───────────────────────────────────────────────── */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Product" : "Add Product"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">

            {/* Name */}
            <div className="space-y-2">
              <Label>
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.name}
                onChange={(e) => handleNameChange(e.target.value)}
                onBlur={() => void checkForExistingProduct(form.name, form.category_id)}
                placeholder="e.g. Panjabi"
              />
            </div>

            {mergePreview && !editingId && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                {mergePreview.name} already exists ({mergePreview.display_id ?? "existing product"})
                — saving will add or update variants on that product.
              </p>
            )}

            {/* Short Description */}
            <div className="space-y-2">
              <Label>
                Short Description
                <span className="text-xs text-muted-foreground ml-1">
                  (shown in product cards)
                </span>
              </Label>
              <Input
                value={form.short_description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, short_description: e.target.value }))
                }
                placeholder="Brief one-line summary of the product"
                maxLength={160}
              />
              <p className="text-xs text-muted-foreground text-right">
                {form.short_description.length}/160
              </p>
            </div>

            {/* Full Description */}
            <div className="space-y-2">
              <Label>
                Full Description
                <span className="text-xs text-muted-foreground ml-1">
                  (shown on product page)
                </span>
              </Label>
              <Textarea
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Detailed product description..."
                rows={4}
              />
            </div>

            {/* Category & Prices */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={form.category_id} onValueChange={handleCategoryChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>
                  Original Price <span className="text-destructive">*</span>
                </Label>
                <NumberInput
                  value={form.base_price}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, base_price: v }))
                  }
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>
                  Discounted Price
                  <span className="text-xs text-muted-foreground ml-1">
                    (optional)
                  </span>
                </Label>
                <NumberInput
                  value={form.discounted_price}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, discounted_price: v }))
                  }
                  placeholder="0.00"
                />
              </div>
            </div>

            {form.category_id && (
              <p className="text-xs text-muted-foreground">
                Variant groups load from the category. You can add extra options per product below.
              </p>
            )}
            {form.category_id && categoryVariantConfigs.length === 0 && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                No variant groups enabled for this category — configure them in Categories.
              </p>
            )}

            {/* Price preview */}
            {form.discounted_price &&
              form.base_price &&
              Number(form.discounted_price) < Number(form.base_price) && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground line-through">
                    ৳{Number(form.base_price).toFixed(2)}
                  </span>
                  <span className="font-semibold text-green-600">
                    ৳{Number(form.discounted_price).toFixed(2)}
                  </span>
                  <Badge variant="secondary" className="text-green-700 bg-green-100">
                    {Math.round(
                      (1 - Number(form.discounted_price) / Number(form.base_price)) * 100
                    )}% off
                  </Badge>
                </div>
              )}
            {form.discounted_price &&
              form.base_price &&
              Number(form.discounted_price) >= Number(form.base_price) && (
                <p className="text-xs text-destructive">
                  Discounted price must be less than original price.
                </p>
              )}

            {/* Toggles */}
            <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.is_active}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
                />
                <Label>Active</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.is_featured}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, is_featured: v }))}
                />
                <Label>Featured</Label>
              </div>
            </div>

            {/* Images */}
            <div className="space-y-2">
              <Label>
                Images{" "}
                <span className="text-xs text-muted-foreground">(max 3)</span>
              </Label>
              {(visibleExistingImages.length > 0 || form.imagePreviews.length > 0) && (
                <div className="flex gap-2 flex-wrap">
                  {visibleExistingImages.map((image, i) => (
                    <div key={image.id} className="relative group">
                      <img
                        src={image.image_url}
                        alt={`existing-${i}`}
                        className="h-20 w-20 rounded object-cover border"
                      />
                      <button
                        type="button"
                        onClick={() => removeExistingImage(image)}
                        className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      {image.is_primary && (
                        <span className="absolute bottom-0 left-0 right-0 text-center text-[10px] bg-black/50 text-white rounded-b">
                          Primary
                        </span>
                      )}
                    </div>
                  ))}
                  {form.imagePreviews.map((src, i) => (
                    <div key={`new-${i}`} className="relative group">
                      <img
                        src={src}
                        alt={`preview-${i}`}
                        className="h-20 w-20 rounded object-cover border"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {totalImageCount < 3 ? (
                <Input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleImageChange}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Maximum 3 images reached.
                </p>
              )}
            </div>

            {/* Variants */}
            <div className="space-y-3">
              <div>
                <Label>Variants</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Configure size, colour, form, fragrance, finish, pack size, and more based on category. Each combination gets its own SKU, stock, and optional expiry date.
                </p>
              </div>

              {!form.category_id ? (
                <p className="text-sm text-muted-foreground text-center py-4 border rounded-md border-dashed">
                  Select a category to load variant groups.
                </p>
              ) : (
                <div className="border rounded-lg p-4 bg-muted/20">
                  <ProductVariantEditor
                    configs={categoryVariantConfigs}
                    variantState={form.variantState}
                    displayId={getEffectiveDisplayId()}
                    onChange={handleVariantStateChange}
                  />
                </div>
              )}

              {form.variantState.combinations.length > 0 && (
                <div className="flex justify-end text-sm font-semibold">
                  Total Stock:{" "}
                  {form.variantState.combinations.reduce(
                    (sum, combo) => sum + (parseInt(combo.stock, 10) || 0),
                    0
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save Product"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Confirm Delete ─────────────────────────────────────────────────── */}
      <ConfirmModal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Product"
        description="This product will be removed from your store. Order history will be preserved."
        confirmLabel="Delete"
        loading={deleting}
      />

      {/* ── View Product Sheet ─────────────────────────────────────────────── */}
      <Sheet open={!!viewProduct} onOpenChange={(v) => !v && setViewProduct(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{viewProduct?.name}</SheetTitle>
          </SheetHeader>
          {viewProduct && (
            <div className="mt-6 space-y-6">
              {viewImages.length > 0 ? (
                <div className="flex gap-2 flex-wrap">
                  {viewImages.map((img) => (
                    <div key={img.id} className="relative">
                      <img
                        src={img.image_url}
                        className="h-20 w-20 rounded object-cover border"
                        alt=""
                      />
                      {img.is_primary && (
                        <span className="absolute bottom-0 left-0 right-0 text-center text-[10px] bg-black/50 text-white rounded-b">
                          Primary
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-20 w-20 rounded border bg-muted">
                  <Package className="h-8 w-8 text-muted-foreground" />
                </div>
              )}

              <div className="space-y-2 text-sm">
                {viewProduct.display_id && (
                  <p className="text-muted-foreground">
                    Product ID:{" "}
                    <span className="font-mono bg-muted px-2 py-0.5 rounded text-xs">
                      {viewProduct.display_id}
                    </span>
                  </p>
                )}
                <p className="text-muted-foreground">
                  Category: {viewProduct.categories?.name || "—"}
                </p>
                <div className="flex items-center gap-2">
                  {viewProduct.discounted_price ? (
                    <>
                      <span className="font-bold text-base">
                        ৳{Number(viewProduct.discounted_price).toFixed(2)}
                      </span>
                      <span className="text-muted-foreground line-through text-sm">
                        ৳{Number(viewProduct.base_price).toFixed(2)}
                      </span>
                      <Badge variant="secondary" className="text-green-700 bg-green-100 text-xs">
                        {Math.round(
                          (1 - viewProduct.discounted_price / viewProduct.base_price) * 100
                        )}% off
                      </Badge>
                    </>
                  ) : (
                    <span className="font-bold text-base">
                      ৳{Number(viewProduct.base_price).toFixed(2)}
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground">
                  Status: {viewProduct.is_active ? "Active" : "Inactive"}
                </p>
                {viewProduct.short_description && (
                  <div className="rounded-md bg-muted px-3 py-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                      Short Description
                    </p>
                    <p>{viewProduct.short_description}</p>
                  </div>
                )}
                {viewProduct.description && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                      Full Description
                    </p>
                    <p className="text-muted-foreground">{viewProduct.description}</p>
                  </div>
                )}
              </div>

              <div>
                <h4 className="font-semibold mb-2">Variants ({viewVariants.length})</h4>
                <div className="space-y-1">
                  <div className="grid grid-cols-4 gap-2 text-xs font-semibold text-muted-foreground px-1">
                    <span className="col-span-2">Variant</span>
                    <span>SKU</span>
                    <span className="text-right">Stock</span>
                  </div>
                  {viewVariants.map((v) => {
                    const attributes =
                      v.attributes && Object.keys(v.attributes).length > 0
                        ? normalizeAttributes(v.attributes)
                        : legacyAttributesFromVariant(v.size, v.color);

                    return (
                    <div
                      key={v.id}
                      className="grid grid-cols-4 gap-2 items-center py-2 border-b text-sm"
                    >
                      <span className="col-span-2">
                        {formatAttributesLabel(attributes)}
                        {v.expires_at && (
                          <span className="block text-xs text-muted-foreground">
                            Exp: {v.expires_at}
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{v.sku}</span>
                      <span
                        className={`text-right font-semibold text-xs ${
                          v.stock === 0
                            ? "text-destructive"
                            : v.stock < 5
                            ? "text-yellow-600"
                            : "text-green-600"
                        }`}
                      >
                        {v.stock}
                      </span>
                    </div>
                    );
                  })}
                  <div className="flex justify-between pt-2 font-semibold text-sm">
                    <span>Total Stock</span>
                    <span>{viewVariants.reduce((s, v) => s + v.stock, 0)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

