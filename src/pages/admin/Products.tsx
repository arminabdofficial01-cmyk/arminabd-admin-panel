import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StatCard } from "@/components/cards/StatCard";
import { DataTable, Column } from "@/components/table/DataTable";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
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

// ─── Variant types ────────────────────────────────────────────────────────────

interface VariantCombination {
  id?: string;
  size: string;
  color: string;
  sku: string;
  stock: string;
  skuManuallyEdited: boolean;
}

interface VariantGroup {
  id?: string;
  sizes: string[];
  colors: string[];
  combinations: VariantCombination[];
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
  variantGroups: VariantGroup[];
  images: File[];
  imagePreviews: string[];
}

const emptyForm: ProductForm = {
  name: "", short_description: "", description: "", category_id: "",
  base_price: "", discounted_price: "",
  is_active: true, is_featured: false,
  variantGroups: [], images: [], imagePreviews: [],
};

// ─── Tag Input ────────────────────────────────────────────────────────────────

function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");

  function addTag(raw: string) {
    const tag = raw.trim();
    if (tag && !values.includes(tag)) onChange([...values, tag]);
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && !input && values.length) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-wrap gap-1 border rounded-md px-2 py-1 min-h-9 items-center focus-within:ring-1 focus-within:ring-ring">
      {values.map((v) => (
        <span key={v} className="flex items-center gap-1 bg-secondary text-secondary-foreground text-xs px-2 py-0.5 rounded">
          {v}
          <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} className="hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        className="flex-1 min-w-16 text-sm outline-none bg-transparent"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => input && addTag(input)}
        placeholder={values.length === 0 ? placeholder : ""}
      />
    </div>
  );
}

// ─── SKU helpers ──────────────────────────────────────────────────────────────

function generateSku(productName: string, size: string, color: string): string {
  const namePart = productName.trim().replace(/\s+/g, "-").toUpperCase().slice(0, 10);
  const parts = [namePart, size?.toUpperCase(), color?.toUpperCase()].filter(Boolean);
  return parts.join("-");
}

function buildCombinations(
  group: VariantGroup,
  productName: string,
  existingCombos: VariantCombination[]
): VariantCombination[] {
  const sizes = group.sizes.length > 0 ? group.sizes : [""];
  const colors = group.colors.length > 0 ? group.colors : [""];
  const combos: VariantCombination[] = [];
  sizes.forEach((size) => {
    colors.forEach((color) => {
      const existing = existingCombos.find((c) => c.size === size && c.color === color);
      const autoSku = generateSku(productName, size, color);
      combos.push({
        id: existing?.id,
        size,
        color,
        sku: existing?.skuManuallyEdited ? existing.sku : autoSku,
        stock: existing?.stock ?? "0",
        skuManuallyEdited: existing?.skuManuallyEdited ?? false,
      });
    });
  });
  return combos;
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      .select("*")
      .then(({ data, error }) => {
        if (error) {
          toast.error(`Failed to load categories: ${error.message}`);
          return;
        }
        setCategories((data as Category[]) || []);
      });
  }, []);

  function resetImageState() {
    setExistingImages([]);
    setRemovedImageIds([]);
  }

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function openAdd() {
    setEditingId(null);
    setForm(emptyForm);
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
      resetImageState();
      setExistingImages((images as ProductImage[]) || []);
      const combinations: VariantCombination[] = ((variants as ProductVariant[]) || []).map((v) => ({
        id: v.id,
        size: v.size || "",
        color: v.color || "",
        sku: v.sku,
        stock: String(v.stock),
        skuManuallyEdited: true,
      }));
      const sizes = [...new Set(combinations.map((c) => c.size).filter(Boolean))];
      const colors = [...new Set(combinations.map((c) => c.color).filter(Boolean))];
      setForm({
        name: product.name,
        short_description: product.short_description || "",
        description: product.description || "",
        category_id: product.category_id || "",
        base_price: String(product.base_price),
        discounted_price: product.discounted_price ? String(product.discounted_price) : "",
        is_active: product.is_active,
        is_featured: product.is_featured,
        variantGroups: combinations.length > 0 ? [{ sizes, colors, combinations }] : [],
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

  function updateGroupSizesOrColors(
    groupIdx: number,
    field: "sizes" | "colors",
    values: string[]
  ) {
    setForm((f) => {
      const groups = [...f.variantGroups];
      const group = { ...groups[groupIdx], [field]: values };
      group.combinations = buildCombinations(group, f.name, group.combinations);
      groups[groupIdx] = group;
      return { ...f, variantGroups: groups };
    });
  }

  function handleNameChange(name: string) {
    setForm((f) => {
      const variantGroups = f.variantGroups.map((group) => ({
        ...group,
        combinations: group.combinations.map((c) => ({
          ...c,
          sku: c.skuManuallyEdited ? c.sku : generateSku(name, c.size, c.color),
        })),
      }));
      return { ...f, name, variantGroups };
    });
  }

  function updateCombination(
    groupIdx: number,
    comboIdx: number,
    field: keyof VariantCombination,
    value: string
  ) {
    setForm((f) => {
      const groups = [...f.variantGroups];
      const combos = [...groups[groupIdx].combinations];
      combos[comboIdx] = {
        ...combos[comboIdx],
        [field]: value,
        ...(field === "sku" ? { skuManuallyEdited: true } : {}),
      };
      groups[groupIdx] = { ...groups[groupIdx], combinations: combos };
      return { ...f, variantGroups: groups };
    });
  }

  function addVariantGroup() {
    setForm((f) => ({
      ...f,
      variantGroups: [
        ...f.variantGroups,
        { sizes: [], colors: [], combinations: [] },
      ],
    }));
  }

  function removeVariantGroup(groupIdx: number) {
    setForm((f) => ({
      ...f,
      variantGroups: f.variantGroups.filter((_, i) => i !== groupIdx),
    }));
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

    setSaving(true);
    try {
      let productId = editingId;

      // Slug is required by the DB schema — auto-generate silently.
      const baseSlug = form.name
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      const slug = editingId ? baseSlug : `${baseSlug}-${Date.now()}`;

      const productData = {
        name: form.name,
        slug,
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
          .update(productData)
          .eq("id", editingId);
        if (error) throw new Error(`Product update error: ${error.message}`);
      } else {
        const { data, error } = await supabase
          .from("products")
          .insert(productData)
          .select("id")
          .single();
        if (error) throw new Error(`Product insert error: ${error.message}`);
        productId = data?.id;
      }

      if (!productId) throw new Error("Failed to get product ID");

      const allCombos = form.variantGroups.flatMap((group) => group.combinations);
      const keptVariantIds: string[] = [];

      for (const combo of allCombos) {
        const variantPayload = {
          product_id: productId,
          size: combo.size || null,
          color: combo.color || null,
          sku: combo.sku,
          stock: parseInt(combo.stock, 10) || 0,
        };

        if (combo.id) {
          const { error } = await supabase
            .from("product_variants")
            .update(variantPayload)
            .eq("id", combo.id);
          if (error) throw new Error(`Variant update error: ${error.message}`);
          keptVariantIds.push(combo.id);
        } else {
          const { data, error } = await supabase
            .from("product_variants")
            .insert(variantPayload)
            .select("id")
            .single();
          if (error) throw new Error(`Variant insert error: ${error.message}`);
          if (data?.id) keptVariantIds.push(data.id);
        }
      }

      if (editingId) {
        const now = new Date().toISOString();
        const { data: existingVariants, error: fetchVariantsError } = await supabase
          .from("product_variants")
          .select("id")
          .eq("product_id", editingId)
          .is("deleted_at", null);

        if (fetchVariantsError) {
          throw new Error(`Variant cleanup error: ${fetchVariantsError.message}`);
        }

        const toSoftDelete = (existingVariants || [])
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

      for (const imageId of removedImageIds) {
        const image = existingImages.find((img) => img.id === imageId);
        if (!image) continue;

        const storagePath = extractStoragePath(image.image_url);
        if (storagePath) {
          await supabase.storage.from("products").remove([storagePath]);
        }

        const { error: imageDeleteError } = await supabase
          .from("product_images")
          .delete()
          .eq("id", imageId);

        if (imageDeleteError) {
          throw new Error(`Failed to delete image: ${imageDeleteError.message}`);
        }
      }

      const { count: existingImageCount, error: imageCountError } = await supabase
        .from("product_images")
        .select("id", { count: "exact", head: true })
        .eq("product_id", productId);

      if (imageCountError) {
        throw new Error(`Failed to count images: ${imageCountError.message}`);
      }

      if (form.images.length > 0) {
        for (let i = 0; i < form.images.length; i++) {
          const file = form.images[i];
          if (file.size > 5 * 1024 * 1024) {
            toast.error(`Image ${file.name} exceeds 5MB limit`);
            continue;
          }
          if (!file.type.startsWith("image/")) {
            toast.error(`File ${file.name} is not an image`);
            continue;
          }

          const sanitizedName = file.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
          const path = `${productId}/${Date.now()}_${sanitizedName}`;

          const { error: uploadError } = await supabase.storage
            .from("products")
            .upload(path, file, { cacheControl: "3600", upsert: false });

          if (uploadError) {
            throw new Error(`Image upload failed: ${uploadError.message}`);
          }

          const { data: urlData } = supabase.storage
            .from("products")
            .getPublicUrl(path);

          const isPrimary = i === 0 && (existingImageCount === 0 || existingImageCount === null);

          const { error: dbError } = await supabase.from("product_images").insert({
            product_id: productId,
            image_url: urlData.publicUrl,
            is_primary: isPrimary,
            sort_order: (existingImageCount || 0) + i,
          });

          if (dbError) {
            throw new Error(`Failed to save image record: ${dbError.message}`);
          }
        }
      }

      toast.success(editingId ? "Product updated" : "Product created");
      setModalOpen(false);
      resetImageState();
      loadProducts();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "An unknown error occurred");
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Product Management</h1>
        <Button onClick={openAdd}>
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
        className="max-w-sm"
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
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
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
                placeholder="e.g. Panjabi"
              />
            </div>

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
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={form.category_id}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, category_id: v }))
                  }
                >
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
            <div className="flex gap-6">
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
              <div className="flex items-center justify-between">
                <div>
                  <Label>Variants</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Add sizes and colors — each combination gets its own SKU and stock count.
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addVariantGroup}>
                  <Plus className="h-3 w-3 mr-1" /> Add Variant Group
                </Button>
              </div>

              {form.variantGroups.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6 border rounded-md border-dashed">
                  No variants yet. Click "Add Variant Group" to add sizes and colors.
                </p>
              )}

              {form.variantGroups.map((group, gi) => (
                <div key={gi} className="border rounded-lg p-4 space-y-4 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">Variant Group {gi + 1}</p>
                    <Button variant="ghost" size="sm" onClick={() => removeVariantGroup(gi)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs mb-1 block">
                        Sizes{" "}
                        <span className="text-muted-foreground">(press Enter or comma)</span>
                      </Label>
                      <TagInput
                        values={group.sizes}
                        onChange={(v) => updateGroupSizesOrColors(gi, "sizes", v)}
                        placeholder="e.g. S, M, L, XL"
                      />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">
                        Colors{" "}
                        <span className="text-muted-foreground">(press Enter or comma)</span>
                      </Label>
                      <TagInput
                        values={group.colors}
                        onChange={(v) => updateGroupSizesOrColors(gi, "colors", v)}
                        placeholder="e.g. Red, Blue, White"
                      />
                    </div>
                  </div>

                  {group.combinations.length > 0 && (
                    <div className="space-y-1">
                      <div className="grid grid-cols-4 gap-2 text-xs font-semibold text-muted-foreground px-1">
                        <span>Size</span>
                        <span>Color</span>
                        <span>SKU <span className="font-normal">(auto-generated, editable)</span></span>
                        <span>Stock</span>
                      </div>
                      {group.combinations.map((combo, ci) => (
                        <div
                          key={`${combo.size}-${combo.color}`}
                          className="grid grid-cols-4 gap-2 items-center bg-background rounded-md p-2 border"
                        >
                          <span className="text-sm font-medium">
                            {combo.size || <span className="text-muted-foreground italic">—</span>}
                          </span>
                          <span className="text-sm font-medium">
                            {combo.color || <span className="text-muted-foreground italic">—</span>}
                          </span>
                          <Input
                            value={combo.sku}
                            onChange={(e) =>
                              updateCombination(gi, ci, "sku", e.target.value.toUpperCase())
                            }
                            className="h-8 text-xs font-mono"
                            placeholder="SKU"
                          />
                          <NumberInput
                            value={combo.stock}
                            onChange={(v) => updateCombination(gi, ci, "stock", v)}
                            placeholder="0"
                            className="h-8 text-sm"
                          />
                        </div>
                      ))}
                      <p className="text-xs text-muted-foreground pt-1">
                        Total stock for this group:{" "}
                        <span className="font-semibold">
                          {group.combinations.reduce((sum, c) => sum + (parseInt(c.stock) || 0), 0)}
                        </span>
                      </p>
                    </div>
                  )}

                  {group.combinations.length === 0 &&
                    (group.sizes.length > 0 || group.colors.length > 0) && (
                      <p className="text-xs text-muted-foreground text-center py-2">
                        Add both sizes and colors to see combinations, or add just one to create
                        single-dimension variants.
                      </p>
                    )}
                </div>
              ))}

              {form.variantGroups.some((g) => g.combinations.length > 0) && (
                <div className="flex justify-end text-sm font-semibold">
                  Total Stock:{" "}
                  {form.variantGroups.reduce(
                    (t, g) => t + g.combinations.reduce((s, c) => s + (parseInt(c.stock) || 0), 0),
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
                    <span>Size</span>
                    <span>Color</span>
                    <span>SKU</span>
                    <span className="text-right">Stock</span>
                  </div>
                  {viewVariants.map((v) => (
                    <div
                      key={v.id}
                      className="grid grid-cols-4 gap-2 items-center py-2 border-b text-sm"
                    >
                      <span>{v.size || "—"}</span>
                      <span>{v.color || "—"}</span>
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
                  ))}
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

