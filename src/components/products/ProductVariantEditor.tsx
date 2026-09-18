import { TagInput } from "@/components/TagInput";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AUTO_SKU_PLACEHOLDER,
  CategoryVariantGroupConfig,
  ProductVariantState,
  VariantCombination,
  buildVariantCombinations,
  formatAttributesLabel,
} from "@/lib/productVariants";

interface ProductVariantEditorProps {
  configs: CategoryVariantGroupConfig[];
  variantState: ProductVariantState;
  displayId: string | null;
  onChange: (state: ProductVariantState) => void;
}

function NumberInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
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
        if (raw === "" || /^\d*$/.test(raw)) onChange(raw);
      }}
    />
  );
}

export function ProductVariantEditor({
  configs,
  variantState,
  displayId,
  onChange,
}: ProductVariantEditorProps) {
  const enabledConfigs = configs.slice().sort((a, b) => a.sort_order - b.sort_order);

  function updateDimensionValues(slug: string, values: string[]) {
    const dimensionValues = { ...variantState.dimensionValues, [slug]: values };
    const combinations = buildVariantCombinations(
      enabledConfigs,
      dimensionValues,
      displayId,
      variantState.combinations
    );
    onChange({ dimensionValues, combinations });
  }

  function updateCombination(index: number, field: keyof VariantCombination, value: string) {
    const combinations = variantState.combinations.map((combo, comboIndex) =>
      comboIndex === index
        ? {
            ...combo,
            [field]: value,
            ...(field === "sku" ? { skuManuallyEdited: true } : {}),
          }
        : combo
    );
    onChange({ ...variantState, combinations });
  }

  if (enabledConfigs.length === 0) {
    return (
      <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
        No variant groups configured for this category. Enable groups in Categories, or add options below after selecting a category.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4">
        {enabledConfigs.map((config) => (
          <div key={config.slug} className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Label className="text-sm">
                {config.name_en}{" "}
                <span className="text-muted-foreground font-normal">({config.name_bn})</span>
              </Label>
              {config.is_required && <Badge variant="secondary">Required</Badge>}
              <Badge variant="outline" className="text-xs">{config.display_type}</Badge>
            </div>
            <TagInput
              values={variantState.dimensionValues[config.slug] ?? config.options}
              onChange={(values) => updateDimensionValues(config.slug, values)}
              placeholder={`Add ${config.name_en.toLowerCase()} options`}
            />
          </div>
        ))}
      </div>

      {variantState.combinations.length > 0 && (
        <div className="space-y-2">
          <Label>Variant combinations</Label>
          <div className="hidden lg:grid grid-cols-5 gap-2 text-xs font-semibold text-muted-foreground px-1">
            <span>Variant</span>
            <span>SKU</span>
            <span>Stock</span>
            <span>Expiry</span>
            <span />
          </div>
          {variantState.combinations.map((combo, index) => (
            <div
              key={attributesRowKey(combo, index)}
              className="grid grid-cols-1 lg:grid-cols-5 gap-2 items-center bg-background rounded-md p-3 border"
            >
              <div>
                <span className="text-xs text-muted-foreground lg:hidden">Variant</span>
                <p className="text-sm font-medium">{formatAttributesLabel(combo.attributes)}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground lg:hidden">SKU</span>
                <Input
                  value={combo.sku}
                  readOnly={!combo.skuManuallyEdited && combo.sku === AUTO_SKU_PLACEHOLDER}
                  onChange={(e) => updateCombination(index, "sku", e.target.value.toUpperCase())}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground lg:hidden">Stock</span>
                <NumberInput
                  value={combo.stock}
                  onChange={(value) => updateCombination(index, "stock", value)}
                  placeholder="0"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground lg:hidden">Expiry</span>
                <Input
                  type="date"
                  value={combo.expires_at}
                  onChange={(e) => updateCombination(index, "expires_at", e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Total stock:{" "}
            <span className="font-semibold">
              {variantState.combinations.reduce(
                (sum, combo) => sum + (parseInt(combo.stock, 10) || 0),
                0
              )}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

function attributesRowKey(combo: VariantCombination, index: number): string {
  return `${index}-${Object.entries(combo.attributes).map(([k, v]) => `${k}:${v}`).join("|")}`;
}
