import { useEffect, useState, useCallback, forwardRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StatCard } from "@/components/cards/StatCard";
import { DataTable, Column } from "@/components/table/DataTable";
import { CheckCircle, Truck, XCircle, Eye, MapPin, Phone, User, Package, CreditCard, Hash, type LucideProps } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { format } from "date-fns";
import { toast } from "sonner";


// ─── Taka Icon (forwardRef to satisfy Lucide's icon type) ────────────────────
const TakaIcon = forwardRef<SVGSVGElement, LucideProps>(
  ({ className, size = 24, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <text x="12" y="17" textAnchor="middle" fontSize="16" fontWeight="bold"
        stroke="none" fill="currentColor" fontFamily="serif">৳</text>
    </svg>
  )
);
TakaIcon.displayName = "TakaIcon";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShippingAddress {
  name?: string;
  phone?: string;
  address?: string;
  area?: string;
}

interface Payment {
  id: string;
  payment_method: string | null;
  payment_status: string | null;
  amount?: number | null;
}

interface Profile {
  name: string | null;
  email: string | null;
}

interface Order {
  id: string;
  display_id?: string | null;
  order_id?: string | null;
  order_status: string;
  total_amount: number;
  created_at: string;
  user_id: string;
  shipping_address: string | ShippingAddress | null;
  notes?: string | null;
  profiles: Profile | null;
  payments: Payment[];
}

interface OrderItemVariant {
  size: string | null;
  color: string | null;
  sku: string;
  stock: number;
  products: { name: string } | null;
}

interface OrderItem {
  id: string;
  quantity: number;
  unit_price: number;
  product_variant_id: string | null;
  product_variants: OrderItemVariant | null;
}

// Stock preview row shown before confirming a stock-deducting status change
interface StockPreviewRow {
  productName: string;
  variantLabel: string;
  sku: string;
  currentStock: number;
  deductQty: number;
  afterStock: number;
}

interface ChartEntry {
  name: string;
  value: number;
}

interface MonthlyRevenue {
  month: string;
  amount: number;
}

interface DashboardStats {
  totalSales: number;
  paidOrders: number;
  codOrders: number;
  cancelled: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseShipping(raw: string | ShippingAddress | null | undefined): ShippingAddress | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function displayOrderId(order: Order) {
  return order.order_id ?? order.display_id ?? ("#" + order.id.replace(/-/g, "").slice(0, 8).toUpperCase());
}

const ORDER_STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled"];
const PAYMENT_STATUSES = ["pending", "paid", "failed"];
const PAYMENT_METHODS = ["cod", "card", "bank_transfer"];

const STOCK_DEDUCT_STATUSES = new Set(["shipped", "delivered"]);

// ─── Stock preview helper ─────────────────────────────────────────────────────
// Fetches current stock for each item in an order and returns preview rows.

async function buildStockPreview(orderId: string): Promise<StockPreviewRow[]> {
  const { data: items, error } = await supabase
    .from("order_items")
    .select("quantity, product_variant_id, product_variants(size, color, sku, stock, products(name))")
    .eq("order_id", orderId);

  if (error || !items) return [];

  return (items as unknown as OrderItem[]).map((item) => {
    const variant = item.product_variants;
    const productName = variant?.products?.name || "Unknown Product";
    const variantParts = [variant?.size, variant?.color].filter(Boolean);
    const variantLabel = variantParts.length > 0 ? variantParts.join(" / ") : "—";
    const sku = variant?.sku || "—";
    const currentStock = variant?.stock ?? 0;
    const deductQty = item.quantity;
    const afterStock = Math.max(0, currentStock - deductQty);

    return { productName, variantLabel, sku, currentStock, deductQty, afterStock };
  });
}

// ─── Stock Reduction Preview Component ───────────────────────────────────────

function StockReductionPreview({ rows }: { rows: StockPreviewRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
      <p className="text-xs font-semibold text-amber-700 flex items-center gap-1">
        ⚠ Stock will be reduced upon saving:
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-amber-600 border-b border-amber-200">
              <th className="text-left pb-1 font-semibold">Product</th>
              <th className="text-left pb-1 font-semibold">SKU</th>
              <th className="text-center pb-1 font-semibold">Current</th>
              <th className="text-center pb-1 font-semibold">Deduct</th>
              <th className="text-center pb-1 font-semibold">After</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-amber-100 last:border-0">
                <td className="py-1 pr-2">
                  <p className="font-medium text-gray-800">{row.productName}</p>
                  {row.variantLabel !== "—" && (
                    <p className="text-gray-500">{row.variantLabel}</p>
                  )}
                </td>
                <td className="py-1 pr-2 font-mono text-gray-600">{row.sku}</td>
                <td className="py-1 text-center font-medium text-gray-700">{row.currentStock}</td>
                <td className="py-1 text-center font-semibold text-red-500">−{row.deductQty}</td>
                <td className="py-1 text-center">
                  <span className={`font-bold ${row.afterStock === 0 ? "text-red-600" : row.afterStock <= 5 ? "text-amber-600" : "text-green-700"}`}>
                    {row.afterStock}
                    {row.afterStock === 0 && (
                      <span className="ml-1 text-red-500 font-normal">(out of stock)</span>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Stock deduction helper ───────────────────────────────────────────────────

async function deductStockForOrder(orderId: string) {
  const { data: items, error } = await supabase
    .from("order_items")
    .select("product_variant_id, quantity")
    .eq("order_id", orderId);

  if (error) throw error;
  if (!items || items.length === 0) return;

  for (const item of items) {
    if (!item.product_variant_id) continue;

    const { data: variant, error: variantError } = await supabase
      .from("product_variants")
      .select("stock")
      .eq("id", item.product_variant_id)
      .single();

    if (variantError) throw variantError;
    if (!variant) continue;

    const newStock = Math.max(0, (variant.stock ?? 0) - item.quantity);

    const { error: updateError } = await supabase
      .from("product_variants")
      .update({ stock: newStock })
      .eq("id", item.product_variant_id);

    if (updateError) throw updateError;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Sales() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 10;

  const [filterOrderStatus, setFilterOrderStatus] = useState("");
  const [filterPaymentStatus, setFilterPaymentStatus] = useState("");
  const [filterPaymentMethod, setFilterPaymentMethod] = useState("");
  const [search, setSearch] = useState("");
  const [searchDebounce, setSearchDebounce] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [stats, setStats] = useState<DashboardStats>({ totalSales: 0, paidOrders: 0, codOrders: 0, cancelled: 0 });
  const [paymentBreakdown, setPaymentBreakdown] = useState<ChartEntry[]>([]);
  const [monthlyRevenue, setMonthlyRevenue] = useState<MonthlyRevenue[]>([]);

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [newOrderStatus, setNewOrderStatus] = useState("");
  const [updatingOrderStatus, setUpdatingOrderStatus] = useState(false);
  const [newPaymentStatus, setNewPaymentStatus] = useState("");
  const [newPaymentMethod, setNewPaymentMethod] = useState("");
  const [updatingPayment, setUpdatingPayment] = useState(false);

  // Stock preview state for detail sheet
  const [detailStockPreview, setDetailStockPreview] = useState<StockPreviewRow[]>([]);
  const [loadingDetailPreview, setLoadingDetailPreview] = useState(false);

  const [updateOrder, setUpdateOrder] = useState<Order | null>(null);
  const [quickOrderStatus, setQuickOrderStatus] = useState("");
  const [quickPaymentStatus, setQuickPaymentStatus] = useState("");
  const [quickPaymentMethod, setQuickPaymentMethod] = useState("");
  const [quickUpdating, setQuickUpdating] = useState(false);

  // Stock preview state for quick update sheet
  const [quickStockPreview, setQuickStockPreview] = useState<StockPreviewRow[]>([]);
  const [loadingQuickPreview, setLoadingQuickPreview] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounce(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadData = useCallback(async () => {
    setLoading(true);

    const { data: allOrdersRaw, error: statsError } = await supabase
      .from("orders")
      .select("*, payments(id, payment_method, payment_status, amount)");

    if (statsError) {
      toast.error(`Failed to load sales data: ${statsError.message}`);
      setLoading(false);
      return;
    }

    const all = (allOrdersRaw || []) as unknown as Order[];
    const paid = all.filter((o) => o.payments?.some((p) => p.payment_status === "paid"));
    const cod = all.filter((o) => o.payments?.some((p) => p.payment_method === "cod"));
    const cancelled = all.filter((o) => o.order_status === "cancelled");
    const totalSales = paid.reduce((s, o) => s + (o.total_amount || 0), 0);
    setStats({ totalSales, paidOrders: paid.length, codOrders: cod.length, cancelled: cancelled.length });

    const statusMap: Record<string, number> = {};
    all.forEach((o) => {
      const ps = o.payments?.[0]?.payment_status || "pending";
      statusMap[ps] = (statusMap[ps] || 0) + 1;
    });
    setPaymentBreakdown(Object.entries(statusMap).map(([name, value]) => ({ name, value })));

    const monthMap: Record<string, number> = {};
    paid.forEach((o) => {
      const m = format(new Date(o.created_at), "MMM yyyy");
      monthMap[m] = (monthMap[m] || 0) + (o.total_amount || 0);
    });
    setMonthlyRevenue(
      Object.entries(monthMap).map(([month, amount]) => ({ month, amount })).slice(-6)
    );

    let query = supabase
      .from("orders")
      .select("*, profiles(name, email), payments(id, payment_method, payment_status)")
      .order("created_at", { ascending: false });

    if (filterOrderStatus) query = query.eq("order_status", filterOrderStatus);
    if (dateFrom) query = query.gte("created_at", dateFrom);
    if (dateTo) query = query.lte("created_at", dateTo + "T23:59:59");

    const { data: allData, error: listError } = await query;
    if (listError) {
      toast.error(`Failed to load orders: ${listError.message}`);
      setLoading(false);
      return;
    }

    let filtered = (allData || []) as unknown as Order[];

    if (filterPaymentStatus) {
      filtered = filtered.filter((o) =>
        o.payments?.some((p) => p.payment_status === filterPaymentStatus)
      );
    }
    if (filterPaymentMethod) {
      filtered = filtered.filter((o) =>
        o.payments?.some((p) => p.payment_method === filterPaymentMethod)
      );
    }
    if (searchDebounce) {
      const term = searchDebounce.toLowerCase();
      filtered = filtered.filter((o) => {
        const shipping = parseShipping(o.shipping_address);
        return (
          o.profiles?.name?.toLowerCase().includes(term) ||
          shipping?.name?.toLowerCase().includes(term) ||
          shipping?.phone?.includes(term) ||
          o.order_id?.toLowerCase().includes(term) ||
          o.display_id?.toLowerCase().includes(term)
        );
      });
    }

    const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
    setOrders(paginated);
    setTotal(filtered.length);
    setLoading(false);
  }, [page, filterOrderStatus, filterPaymentStatus, filterPaymentMethod, searchDebounce, dateFrom, dateTo]);

  useEffect(() => { loadData(); }, [loadData]);

  async function viewOrder(order: Order) {
    setSelectedOrder(order);
    setNewOrderStatus(order.order_status);
    setNewPaymentStatus(order.payments?.[0]?.payment_status || "pending");
    setNewPaymentMethod(order.payments?.[0]?.payment_method || "cod");
    setDetailStockPreview([]);
    const { data, error } = await supabase
      .from("order_items")
      .select("*, product_variants(size, color, sku, stock, products(name))")
      .eq("order_id", order.id);

    if (error) {
      toast.error("Failed to load order items");
      return;
    }

    setOrderItems((data || []) as unknown as OrderItem[]);
  }

  // Load stock preview when detail sheet status selector changes
  async function handleDetailStatusChange(status: string) {
    setNewOrderStatus(status);
    setDetailStockPreview([]);

    if (
      selectedOrder &&
      STOCK_DEDUCT_STATUSES.has(status) &&
      !STOCK_DEDUCT_STATUSES.has(selectedOrder.order_status)
    ) {
      setLoadingDetailPreview(true);
      const preview = await buildStockPreview(selectedOrder.id);
      setDetailStockPreview(preview);
      setLoadingDetailPreview(false);
    }
  }

  // Load stock preview when quick update sheet status selector changes
  async function handleQuickStatusChange(status: string) {
    setQuickOrderStatus(status);
    setQuickStockPreview([]);

    if (
      updateOrder &&
      STOCK_DEDUCT_STATUSES.has(status) &&
      !STOCK_DEDUCT_STATUSES.has(updateOrder.order_status)
    ) {
      setLoadingQuickPreview(true);
      const preview = await buildStockPreview(updateOrder.id);
      setQuickStockPreview(preview);
      setLoadingQuickPreview(false);
    }
  }

  async function handleUpdateOrderStatus() {
    if (!selectedOrder || !newOrderStatus) return;
    setUpdatingOrderStatus(true);
    try {
      const prevStatus = selectedOrder.order_status;
      const { error } = await supabase
        .from("orders")
        .update({ order_status: newOrderStatus })
        .eq("id", selectedOrder.id);

      if (error) throw error;

      if (
        STOCK_DEDUCT_STATUSES.has(newOrderStatus) &&
        !STOCK_DEDUCT_STATUSES.has(prevStatus)
      ) {
        await deductStockForOrder(selectedOrder.id);
        toast.success(`Order marked as ${newOrderStatus} — stock updated`);
      } else {
        toast.success("Order status updated");
      }

      setSelectedOrder({ ...selectedOrder, order_status: newOrderStatus });
      setDetailStockPreview([]);
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update order status");
    }
    setUpdatingOrderStatus(false);
  }

  async function handleUpdatePayment() {
    if (!selectedOrder) return;
    const paymentId = selectedOrder.payments?.[0]?.id;
    if (!paymentId) return;
    setUpdatingPayment(true);
    const { error } = await supabase
      .from("payments")
      .update({ payment_status: newPaymentStatus, payment_method: newPaymentMethod })
      .eq("id", paymentId);
    if (!error) {
      const updatedPayments: Payment[] = [
        { ...selectedOrder.payments[0], payment_status: newPaymentStatus, payment_method: newPaymentMethod },
        ...selectedOrder.payments.slice(1),
      ];
      setSelectedOrder({ ...selectedOrder, payments: updatedPayments });
      toast.success("Payment updated");
      await loadData();
    } else {
      toast.error("Failed to update payment");
    }
    setUpdatingPayment(false);
  }

  async function handleQuickUpdate() {
    if (!updateOrder) return;
    setQuickUpdating(true);
    try {
      const prevStatus = updateOrder.order_status;

      const { error: orderError } = await supabase
        .from("orders")
        .update({ order_status: quickOrderStatus })
        .eq("id", updateOrder.id);

      if (orderError) throw orderError;

      const paymentId = updateOrder.payments?.[0]?.id;
      if (paymentId) {
        const { error: paymentError } = await supabase
          .from("payments")
          .update({ payment_status: quickPaymentStatus, payment_method: quickPaymentMethod })
          .eq("id", paymentId);

        if (paymentError) throw paymentError;
      }

      if (
        STOCK_DEDUCT_STATUSES.has(quickOrderStatus) &&
        !STOCK_DEDUCT_STATUSES.has(prevStatus)
      ) {
        await deductStockForOrder(updateOrder.id);
        toast.success(`Order marked as ${quickOrderStatus} — stock updated`);
      } else {
        toast.success("Order updated");
      }

      setUpdateOrder(null);
      setQuickStockPreview([]);
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update order");
    }
    setQuickUpdating(false);
  }

  const statusVariant = (s: string): "default" | "destructive" | "secondary" | "outline" => {
    if (s === "delivered") return "default";
    if (s === "cancelled") return "destructive";
    if (s === "shipped") return "secondary";
    return "outline";
  };

  const paymentVariant = (s: string): "default" | "destructive" | "secondary" => {
    if (s === "paid") return "default";
    if (s === "failed") return "destructive";
    return "secondary";
  };

  const COLORS = ["hsl(160, 60%, 40%)", "hsl(38, 92%, 50%)", "hsl(0, 84%, 60%)", "hsl(215, 16%, 47%)"];

  const columns: Column<Order>[] = [
    {
      key: "order_id",
      label: "Order ID",
      render: (r) => (
        <span className="font-mono text-xs font-bold text-primary">{displayOrderId(r)}</span>
      ),
    },
    {
      key: "customer",
      label: "Customer",
      render: (r) => {
        const shipping = parseShipping(r.shipping_address);
        const name = shipping?.name || r.profiles?.name || "Guest";
        const phone = shipping?.phone;
        return (
          <div>
            <p className="font-medium text-sm">{name}</p>
            {phone && <p className="text-xs text-muted-foreground">{phone}</p>}
          </div>
        );
      },
    },
    {
      key: "area",
      label: "Area",
      hideOnMobile: true,
      render: (r) => {
        const shipping = parseShipping(r.shipping_address);
        return shipping?.area ? (
          <span className="text-xs text-muted-foreground capitalize">
            {shipping.area.replace(/-/g, " ")}
          </span>
        ) : <span className="text-muted-foreground">—</span>;
      },
    },
    {
      key: "payment_method",
      label: "Method",
      hideOnMobile: true,
      render: (r) => (
        <span className="text-xs uppercase font-semibold">
          {r.payments?.[0]?.payment_method || "N/A"}
        </span>
      ),
    },
    {
      key: "payment_status",
      label: "Payment",
      render: (r) => {
        const s = r.payments?.[0]?.payment_status || "pending";
        return <Badge variant={paymentVariant(s)}>{s}</Badge>;
      },
    },
    {
      key: "order_status",
      label: "Order Status",
      render: (r) => <Badge variant={statusVariant(r.order_status)}>{r.order_status}</Badge>,
    },
    {
      key: "total",
      label: "Total",
      render: (r) => <span className="font-semibold">৳{Number(r.total_amount).toFixed(2)}</span>,
    },
    {
      key: "date",
      label: "Date",
      hideOnMobile: true,
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {format(new Date(r.created_at), "MMM dd, yyyy")}
        </span>
      ),
    },
    {
      key: "action",
      label: "Actions",
      render: (r) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => viewOrder(r)} title="View Details">
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setUpdateOrder(r);
              setQuickOrderStatus(r.order_status);
              setQuickPaymentStatus(r.payments?.[0]?.payment_status || "pending");
              setQuickPaymentMethod(r.payments?.[0]?.payment_method || "cod");
              setQuickStockPreview([]);
            }}
          >
            Update
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold">Sales</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Sales" value={`৳${stats.totalSales.toFixed(2)}`} icon={TakaIcon} variant="success" />
        <StatCard title="Paid Orders" value={stats.paidOrders} icon={CheckCircle} variant="success" />
        <StatCard title="COD Orders" value={stats.codOrders} icon={Truck} />
        <StatCard title="Cancelled" value={stats.cancelled} icon={XCircle} variant="destructive" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <div className="rounded-lg border bg-card p-4 sm:p-6">
          <h3 className="font-semibold mb-4">Payment Status Breakdown</h3>
          <div className="h-[220px] sm:h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={paymentBreakdown}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={75}
                label={({ name, value }: { name: string; value: number }) => `${name}: ${value}`}
              >
                {paymentBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4 sm:p-6">
          <h3 className="font-semibold mb-4">Monthly Revenue</h3>
          <div className="h-[220px] sm:h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyRevenue}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="month" className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip formatter={(value: number) => [`৳${value.toFixed(2)}`, "Revenue"]} />
              <Bar dataKey="amount" fill="hsl(160, 60%, 40%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        <Input
          placeholder="Search name, phone or order ID..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full sm:col-span-2 lg:col-span-1"
        />
        <Select value={filterOrderStatus} onValueChange={(v) => { setFilterOrderStatus(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Order Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {ORDER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterPaymentStatus} onValueChange={(v) => { setFilterPaymentStatus(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Payment Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterPaymentMethod} onValueChange={(v) => { setFilterPaymentMethod(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Method" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="cod">COD</SelectItem>
            <SelectItem value="card">Card</SelectItem>
            <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="w-full" />
        <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="w-full" />
      </div>

      <DataTable
        columns={columns}
        data={orders}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        loading={loading}
      />

      {/* ── View Order Details Sheet ── */}
      <Sheet open={!!selectedOrder} onOpenChange={(v) => !v && setSelectedOrder(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Hash className="h-4 w-4" />
              Order {selectedOrder ? displayOrderId(selectedOrder) : ""}
            </SheetTitle>
          </SheetHeader>

          {selectedOrder && (() => {
            const shipping = parseShipping(selectedOrder.shipping_address);
            return (
              <div className="mt-6 space-y-4">

                {/* Customer Info */}
                <div className="rounded-lg border p-4 space-y-2">
                  <h4 className="font-semibold text-sm flex items-center gap-2">
                    <User className="h-4 w-4" /> Customer Info
                  </h4>
                  <Separator />
                  <div className="space-y-1 text-sm">
                    <p><span className="text-muted-foreground">Name:</span> {shipping?.name || selectedOrder.profiles?.name || "Guest"}</p>
                    {shipping?.phone && (
                      <p className="flex items-center gap-1">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        {shipping.phone}
                      </p>
                    )}
                    {selectedOrder.profiles?.email && (
                      <p><span className="text-muted-foreground">Email:</span> {selectedOrder.profiles.email}</p>
                    )}
                  </div>
                </div>

                {/* Shipping Address */}
                {shipping && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <h4 className="font-semibold text-sm flex items-center gap-2">
                      <MapPin className="h-4 w-4" /> Shipping Address
                    </h4>
                    <Separator />
                    <div className="space-y-1 text-sm">
                      {shipping.address && <p><span className="text-muted-foreground">Address:</span> {shipping.address}</p>}
                      {shipping.area && (
                        <p>
                          <span className="text-muted-foreground">Area:</span>{" "}
                          <span className="capitalize">{shipping.area.replace(/-/g, " ")}</span>
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Current Status */}
                <div className="rounded-lg border p-4 space-y-2">
                  <h4 className="font-semibold text-sm flex items-center gap-2">
                    <CreditCard className="h-4 w-4" /> Current Status
                  </h4>
                  <Separator />
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Payment Method</span>
                      <span className="uppercase font-semibold">{selectedOrder.payments?.[0]?.payment_method || "N/A"}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Payment Status</span>
                      <Badge variant={paymentVariant(selectedOrder.payments?.[0]?.payment_status || "pending")}>
                        {selectedOrder.payments?.[0]?.payment_status || "pending"}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Order Status</span>
                      <Badge variant={statusVariant(selectedOrder.order_status)}>{selectedOrder.order_status}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Date</span>
                      <span>{format(new Date(selectedOrder.created_at), "MMM dd, yyyy • hh:mm a")}</span>
                    </div>
                  </div>
                </div>

                {/* Update Order Status */}
                <div className="rounded-lg border p-4 space-y-3">
                  <h4 className="font-semibold text-sm">Update Order Status</h4>
                  <Separator />

                  <div className="flex gap-2">
                    <Select value={newOrderStatus} onValueChange={handleDetailStatusChange}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        {ORDER_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={handleUpdateOrderStatus}
                      disabled={updatingOrderStatus || newOrderStatus === selectedOrder.order_status}
                    >
                      {updatingOrderStatus ? "Saving..." : "Save"}
                    </Button>
                  </div>

                  {/* Stock reduction preview */}
                  {loadingDetailPreview && (
                    <p className="text-xs text-muted-foreground animate-pulse">Loading stock preview...</p>
                  )}
                  {!loadingDetailPreview && detailStockPreview.length > 0 && (
                    <StockReductionPreview rows={detailStockPreview} />
                  )}
                </div>

                {/* Update Payment */}
                <div className="rounded-lg border p-4 space-y-3">
                  <h4 className="font-semibold text-sm flex items-center gap-2">
                    <CreditCard className="h-4 w-4" /> Update Payment
                  </h4>
                  <Separator />
                  <div className="space-y-2">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Payment Method</p>
                      <Select value={newPaymentMethod} onValueChange={setNewPaymentMethod}>
                        <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
                        <SelectContent>
                          {PAYMENT_METHODS.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Payment Status</p>
                      <Select value={newPaymentStatus} onValueChange={setNewPaymentStatus}>
                        <SelectTrigger><SelectValue placeholder="Select payment status" /></SelectTrigger>
                        <SelectContent>
                          {PAYMENT_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      className="w-full"
                      onClick={handleUpdatePayment}
                      disabled={
                        updatingPayment ||
                        (newPaymentStatus === selectedOrder.payments?.[0]?.payment_status &&
                          newPaymentMethod === selectedOrder.payments?.[0]?.payment_method)
                      }
                    >
                      {updatingPayment ? "Saving..." : "Save Payment"}
                    </Button>
                  </div>
                </div>

                {/* Order Items */}
                <div className="rounded-lg border p-4 space-y-2">
                  <h4 className="font-semibold text-sm flex items-center gap-2">
                    <Package className="h-4 w-4" /> Order Items
                  </h4>
                  <Separator />
                  {orderItems.length === 0 && (
                    <p className="text-sm text-muted-foreground">No items found.</p>
                  )}
                  {orderItems.map((item) => (
                    <div key={item.id} className="flex justify-between py-2 border-b last:border-0 text-sm">
                      <div>
                        <p className="font-medium">{item.product_variants?.products?.name || "Unknown Product"}</p>
                        <p className="text-xs text-muted-foreground">
                          {[item.product_variants?.size, item.product_variants?.color].filter(Boolean).join(" / ")}
                          {item.product_variants?.sku && (
                            <span className="ml-2 font-mono">SKU: {item.product_variants.sku}</span>
                          )}
                        </p>
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <p>{item.quantity} × ৳{Number(item.unit_price).toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">= ৳{(item.quantity * item.unit_price).toFixed(2)}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-between font-bold text-lg px-1">
                  <span>Total</span>
                  <span>৳{Number(selectedOrder.total_amount).toFixed(2)}</span>
                </div>

                {selectedOrder.notes && (
                  <div className="rounded-lg border p-4">
                    <h4 className="font-semibold text-sm mb-1">Notes</h4>
                    <p className="text-sm text-muted-foreground">{selectedOrder.notes}</p>
                  </div>
                )}
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* ── Quick Update Sheet ── */}
      <Sheet open={!!updateOrder} onOpenChange={(v) => !v && setUpdateOrder(null)}>
        <SheetContent className="sm:max-w-sm overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Update Order</SheetTitle>
          </SheetHeader>
          {updateOrder && (() => {
            const shipping = parseShipping(updateOrder.shipping_address);
            return (
              <div className="mt-6 space-y-4">
                <div className="rounded-lg bg-muted p-3 space-y-1">
                  <p className="text-sm font-bold">{displayOrderId(updateOrder)}</p>
                  <p className="text-sm">{shipping?.name || updateOrder.profiles?.name || "Guest"}</p>
                  {shipping?.phone && <p className="text-xs text-muted-foreground">{shipping.phone}</p>}
                  <p className="text-sm font-semibold">৳{Number(updateOrder.total_amount).toFixed(2)}</p>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-semibold">Order Status</p>
                  <div className="flex items-center gap-2 text-sm mb-1">
                    <span className="text-muted-foreground">Current:</span>
                    <Badge variant={statusVariant(updateOrder.order_status)}>{updateOrder.order_status}</Badge>
                  </div>
                  <Select value={quickOrderStatus} onValueChange={handleQuickStatusChange}>
                    <SelectTrigger><SelectValue placeholder="Select order status" /></SelectTrigger>
                    <SelectContent>
                      {ORDER_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Stock reduction preview for quick update */}
                  {loadingQuickPreview && (
                    <p className="text-xs text-muted-foreground animate-pulse">Loading stock preview...</p>
                  )}
                  {!loadingQuickPreview && quickStockPreview.length > 0 && (
                    <StockReductionPreview rows={quickStockPreview} />
                  )}
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="text-sm font-semibold">Payment Method</p>
                  <div className="flex items-center gap-2 text-sm mb-1">
                    <span className="text-muted-foreground">Current:</span>
                    <span className="uppercase font-medium">{updateOrder.payments?.[0]?.payment_method || "N/A"}</span>
                  </div>
                  <Select value={quickPaymentMethod} onValueChange={setQuickPaymentMethod}>
                    <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-semibold">Payment Status</p>
                  <div className="flex items-center gap-2 text-sm mb-1">
                    <span className="text-muted-foreground">Current:</span>
                    <Badge variant={paymentVariant(updateOrder.payments?.[0]?.payment_status || "pending")}>
                      {updateOrder.payments?.[0]?.payment_status || "pending"}
                    </Badge>
                  </div>
                  <Select value={quickPaymentStatus} onValueChange={setQuickPaymentStatus}>
                    <SelectTrigger><SelectValue placeholder="Select payment status" /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button className="w-full" onClick={handleQuickUpdate} disabled={quickUpdating}>
                  {quickUpdating ? "Updating..." : "Save All Changes"}
                </Button>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}