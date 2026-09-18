import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, Column } from "@/components/table/DataTable";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { TagInput } from "@/components/TagInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  CategoryVariantGroupInput,
  fetchCategoryVariantConfig,
  fetchVariantGroupCatalog,
  saveCategoryVariantConfig,
} from "@/lib/categoryVariantGroups";
import { VariantGroupDefinition } from "@/lib/productVariants";

interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  variant_group_count: number;
  product_count: number;
}

interface CategoryForm {
  name: string;
  description: string;
  variantGroups: CategoryVariantGroupInput[];
}

const emptyCategoryForm: CategoryForm = {
  name: "",
  description: "",
  variantGroups: [],
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function generateUniqueSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name) || "category";
  let candidate = base;
  let suffix = 2;

  while (true) {
    let query = supabase.from("categories").select("id").eq("slug", candidate);
    if (excludeId) query = query.neq("id", excludeId);

    const { data, error } = await query;
    if (error) throw new Error(`Slug check failed: ${error.message}`);
    if (!data || data.length === 0) return candidate;

    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

async function findDuplicateCategoryName(
  name: string,
  excludeId?: string
): Promise<boolean> {
  const { data, error } = await supabase.from("categories").select("id, name");
  if (error) throw new Error(`Category lookup failed: ${error.message}`);

  const normalized = name.trim().toLowerCase();
  return (data || []).some(
    (row) =>
      row.name.trim().toLowerCase() === normalized && row.id !== excludeId
  );
}

function buildDefaultVariantInputs(
  catalog: VariantGroupDefinition[],
  optionsBySlug: Record<string, string[]>
): CategoryVariantGroupInput[] {
  return catalog.map((group) => ({
    variant_group_id: group.id,
    enabled: false,
    is_required: false,
    options: optionsBySlug[group.slug] ?? [],
    sort_order: group.sort_order,
  }));
}

export default function Categories() {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [catalog, setCatalog] = useState<VariantGroupDefinition[]>([]);
  const [catalogOptions, setCatalogOptions] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CategoryForm>(emptyCategoryForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadCategories = useCallback(async () => {
    setLoading(true);

    const { data: categoryData, error: categoryError } = await supabase
      .from("categories")
      .select("id, name, slug, description")
      .order("name");

    if (categoryError) {
      toast.error(`Failed to load categories: ${categoryError.message}`);
      setLoading(false);
      return;
    }

    const [{ data: productCounts, error: productError }, { data: groupCounts, error: groupError }] =
      await Promise.all([
        supabase.from("products").select("category_id").is("deleted_at", null),
        supabase.from("category_variant_groups").select("category_id"),
      ]);

    if (productError || groupError) {
      toast.error("Failed to load category stats");
      setLoading(false);
      return;
    }

    const countMap = new Map<string, number>();
    for (const row of productCounts || []) {
      if (!row.category_id) continue;
      countMap.set(row.category_id, (countMap.get(row.category_id) || 0) + 1);
    }

    const groupCountMap = new Map<string, number>();
    for (const row of groupCounts || []) {
      groupCountMap.set(
        row.category_id,
        (groupCountMap.get(row.category_id) || 0) + 1
      );
    }

    setCategories(
      (categoryData || []).map((row) => ({
        ...row,
        variant_group_count: groupCountMap.get(row.id) || 0,
        product_count: countMap.get(row.id) || 0,
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    fetchVariantGroupCatalog()
      .then(({ groups, optionsBySlug }) => {
        setCatalog(groups);
        setCatalogOptions(optionsBySlug);
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Failed to load variant groups");
      });
  }, []);

  function openAdd() {
    setEditingId(null);
    setForm({
      ...emptyCategoryForm,
      variantGroups: buildDefaultVariantInputs(catalog, catalogOptions),
    });
    setModalOpen(true);
  }

  async function openEdit(category: CategoryRow) {
    setEditingId(category.id);

    try {
      const configs = await fetchCategoryVariantConfig(category.id);
      const inputs = buildDefaultVariantInputs(catalog, catalogOptions).map((input) => {
        const match = configs.find((config) => config.variant_group_id === input.variant_group_id);
        if (!match) return input;

        return {
          ...input,
          enabled: true,
          is_required: match.is_required,
          options: match.options.length > 0 ? match.options : input.options,
          sort_order: match.sort_order,
        };
      });

      setForm({
        name: category.name,
        description: category.description || "",
        variantGroups: inputs,
      });
      setModalOpen(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load category variants");
    }
  }

  function updateVariantGroup(
    variantGroupId: string,
    patch: Partial<CategoryVariantGroupInput>
  ) {
    setForm((current) => ({
      ...current,
      variantGroups: current.variantGroups.map((group) =>
        group.variant_group_id === variantGroupId ? { ...group, ...patch } : group
      ),
    }));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Category name is required");
      return;
    }

    setSaving(true);

    try {
      const isDuplicate = await findDuplicateCategoryName(form.name, editingId || undefined);
      if (isDuplicate) {
        throw new Error("A category with this name already exists");
      }

      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
      };

      let categoryId = editingId;

      if (editingId) {
        const slug = await generateUniqueSlug(form.name, editingId);
        const { error } = await supabase
          .from("categories")
          .update({ ...payload, slug })
          .eq("id", editingId);

        if (error) throw new Error(`Category update failed: ${error.message}`);
      } else {
        const slug = await generateUniqueSlug(form.name);
        const { data, error } = await supabase
          .from("categories")
          .insert({ ...payload, slug })
          .select("id")
          .single();

        if (error) throw new Error(`Category insert failed: ${error.message}`);
        categoryId = data?.id ?? null;
      }

      if (!categoryId) throw new Error("Failed to get category ID");

      await saveCategoryVariantConfig(categoryId, form.variantGroups);
      toast.success(editingId ? "Category updated" : "Category created");

      setModalOpen(false);
      await loadCategories();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save category");
    }

    setSaving(false);
  }

  async function handleDelete() {
    if (!deleteId) return;

    setDeleting(true);

    try {
      const { count, error: countError } = await supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("category_id", deleteId)
        .is("deleted_at", null);

      if (countError) {
        throw new Error(`Failed to check products: ${countError.message}`);
      }

      if ((count || 0) > 0) {
        throw new Error(
          `Cannot delete: ${count} product(s) use this category. Reassign or delete them first.`
        );
      }

      const { error } = await supabase.from("categories").delete().eq("id", deleteId);
      if (error) throw new Error(`Category delete failed: ${error.message}`);

      toast.success("Category deleted");
      setDeleteId(null);
      await loadCategories();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete category");
    }

    setDeleting(false);
  }

  const columns: Column<CategoryRow>[] = [
    {
      key: "name",
      label: "Name",
      render: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: "slug",
      label: "Slug",
      hideOnMobile: true,
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">{row.slug}</span>
      ),
    },
    {
      key: "variant_groups",
      label: "Variant Groups",
      render: (row) => row.variant_group_count,
    },
    {
      key: "products",
      label: "Products",
      render: (row) => row.product_count,
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => void openEdit(row)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDeleteId(row.id)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  const catalogById = new Map(catalog.map((group) => [group.id, group]));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Categories</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure which variant groups apply to each category — size, colour, form, fragrance, finish, pack size, and more.
          </p>
        </div>
        <Button onClick={openAdd} className="w-full sm:w-auto" disabled={catalog.length === 0}>
          <Plus className="h-4 w-4 mr-2" />
          Add Category
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={categories}
        loading={loading}
        emptyMessage="No categories yet. Add one to get started."
      />

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Category" : "Add Category"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Panjabi / Clothing"
              />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional category description"
                rows={3}
              />
            </div>

            <div className="space-y-3">
              <div>
                <Label>Variant Groups</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Enable groups for this category. Mark required groups and set default options products will inherit.
                </p>
              </div>

              {form.variantGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground">Loading variant groups...</p>
              ) : (
                <div className="space-y-3">
                  {form.variantGroups
                    .slice()
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((groupInput) => {
                      const group = catalogById.get(groupInput.variant_group_id);
                      if (!group) return null;

                      return (
                        <div
                          key={groupInput.variant_group_id}
                          className="border rounded-lg p-4 space-y-3 bg-muted/20"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium">{group.name_en}</span>
                                <span className="text-sm text-muted-foreground">({group.name_bn})</span>
                                <Badge variant="outline" className="text-xs">{group.display_type}</Badge>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={groupInput.enabled}
                                  onCheckedChange={(enabled) =>
                                    updateVariantGroup(groupInput.variant_group_id, {
                                      enabled,
                                      is_required: enabled ? groupInput.is_required : false,
                                    })
                                  }
                                />
                                <Label className="text-sm">Enabled</Label>
                              </div>
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={groupInput.is_required}
                                  disabled={!groupInput.enabled}
                                  onCheckedChange={(isRequired) =>
                                    updateVariantGroup(groupInput.variant_group_id, {
                                      is_required: isRequired,
                                    })
                                  }
                                />
                                <Label className="text-sm">Required</Label>
                              </div>
                            </div>
                          </div>

                          {groupInput.enabled && (
                            <div className="space-y-2">
                              <Label className="text-xs">Default options</Label>
                              <TagInput
                                values={groupInput.options}
                                onChange={(options) =>
                                  updateVariantGroup(groupInput.variant_group_id, { options })
                                }
                                placeholder={`Add ${group.name_en.toLowerCase()} options`}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? "Saving..." : editingId ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={Boolean(deleteId)}
        onClose={() => setDeleteId(null)}
        title="Delete category?"
        description="This cannot be undone. Categories with products cannot be deleted."
        confirmLabel="Delete"
        onConfirm={() => void handleDelete()}
        loading={deleting}
      />
    </div>
  );
}
