import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, Column } from "@/components/table/DataTable";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { TagInput, normalizeTagList } from "@/components/TagInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sizes: string[];
  colors: string[];
  product_count: number;
}

interface CategoryForm {
  name: string;
  description: string;
  sizes: string[];
  colors: string[];
}

const emptyCategoryForm: CategoryForm = {
  name: "",
  description: "",
  sizes: [],
  colors: [],
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

export default function Categories() {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
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
      .select("id, name, slug, description, sizes, colors")
      .order("name");

    if (categoryError) {
      toast.error(`Failed to load categories: ${categoryError.message}`);
      setLoading(false);
      return;
    }

    const { data: productCounts, error: productError } = await supabase
      .from("products")
      .select("category_id")
      .is("deleted_at", null);

    if (productError) {
      toast.error(`Failed to load product counts: ${productError.message}`);
      setLoading(false);
      return;
    }

    const countMap = new Map<string, number>();
    for (const row of productCounts || []) {
      if (!row.category_id) continue;
      countMap.set(row.category_id, (countMap.get(row.category_id) || 0) + 1);
    }

    setCategories(
      (categoryData || []).map((row) => ({
        ...row,
        sizes: row.sizes || [],
        colors: row.colors || [],
        product_count: countMap.get(row.id) || 0,
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  function openAdd() {
    setEditingId(null);
    setForm(emptyCategoryForm);
    setModalOpen(true);
  }

  function openEdit(category: CategoryRow) {
    setEditingId(category.id);
    setForm({
      name: category.name,
      description: category.description || "",
      sizes: category.sizes || [],
      colors: category.colors || [],
    });
    setModalOpen(true);
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
        sizes: normalizeTagList(form.sizes),
        colors: normalizeTagList(form.colors),
      };

      if (editingId) {
        const slug = await generateUniqueSlug(form.name, editingId);
        const { error } = await supabase
          .from("categories")
          .update({ ...payload, slug })
          .eq("id", editingId);

        if (error) throw new Error(`Category update failed: ${error.message}`);
        toast.success("Category updated");
      } else {
        const slug = await generateUniqueSlug(form.name);
        const { error } = await supabase
          .from("categories")
          .insert({ ...payload, slug });

        if (error) throw new Error(`Category insert failed: ${error.message}`);
        toast.success("Category created");
      }

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
      key: "sizes",
      label: "Sizes",
      render: (row) => row.sizes.length,
    },
    {
      key: "colors",
      label: "Colors",
      hideOnMobile: true,
      render: (row) => row.colors.length,
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
          <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDeleteId(row.id)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Categories</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Define default sizes and colors per category. Products inherit these options.
          </p>
        </div>
        <Button onClick={openAdd} className="w-full sm:w-auto">
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
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Category" : "Add Category"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Panjabi"
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

            <div className="space-y-2">
              <Label>Default Sizes</Label>
              <TagInput
                values={form.sizes}
                onChange={(v) => setForm((f) => ({ ...f, sizes: v }))}
                placeholder="e.g. S, M, L, XL"
              />
            </div>

            <div className="space-y-2">
              <Label>Default Colors</Label>
              <TagInput
                values={form.colors}
                onChange={(v) => setForm((f) => ({ ...f, colors: v }))}
                placeholder="e.g. Red, Blue, White"
              />
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
