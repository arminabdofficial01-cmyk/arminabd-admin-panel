import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StatCard } from "@/components/cards/StatCard";
import { DataTable, Column } from "@/components/table/DataTable";
import { Package, ShoppingCart, DollarSign, AlertTriangle, Eye, Hash, MapPin, Phone, User, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { format } from "date-fns";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardStats {
  totalStock: number;
  totalOrders: number;
  totalRevenue: number;
  lowStockCount: number;
}

interface Payment {
  payment_method: string | null;
  payment_status: string | null;
}

interface Profile {
  name: string | null;
  email: string | null;
}

interface ShippingAddress {
  name?: string;
  phone?: string;
  address?: string;
  area?: string;
}

interface Order {
  id: string;
  display_id?: string | null;
  order_status: string;
  total_amount: number;
  created_at: string;
  user_id: string;
  shipping_address?: string | ShippingAddress | null;
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
  product_variants: OrderItemVariant | null;
}

interface CategorySales {
  name: string;
  value: number;
}

interface WeeklySales {
  date: string;
  amount: number;
}

interface OrderItemRaw {
  quantity: number;
  product_variant_id: string;
  product_variants: {
    product_id: string;
    products: {
      category_id: string | null;
      categories: { name: string } | null;
    } | null;
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseShipping(raw: string | ShippingAddress | null | undefined): ShippingAddress | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function shortOrderId(uuid: string) {
  return "#" + uuid.replace(/-/g, "").slice(0, 8).toUpperCase();
}

function displayOrderId(order: Order) {
  return order.display_id ?? shortOrderId(order.id);
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({ totalStock: 0, totalOrders: 0, totalRevenue: 0, lowStockCount: 0 });
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderDetails, setOrderDetails] = useState<OrderItem[]>([]);
  const [weeklySales, setWeeklySales] = useState<WeeklySales[]>([]);
  const [topCategories, setTopCategories] = useState<CategorySales[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);
    const [stockRes, ordersRes, variantsLow, recentRes] = await Promise.all([
      supabase.from("product_variants").select("stock").is("deleted_at", null),
      supabase.from("orders").select("id, display_id, order_status, total_amount, created_at, user_id, shipping_address, profiles(name, email), payments(payment_method, payment_status)"),
      supabase.from("product_variants").select("id").lt("stock", 5).is("deleted_at", null),
      supabase.from("orders").select("id, display_id, order_status, total_amount, created_at, user_id, shipping_address, notes, profiles(name, email), payments(payment_method, payment_status)").order("created_at", { ascending: false }).limit(10),
    ]);

    if (stockRes.error || ordersRes.error || variantsLow.error || recentRes.error) {
      toast.error("Failed to load dashboard data");
      setLoading(false);
      return;
    }

    const totalStock = (stockRes.data || []).reduce((sum, v) => sum + (v.stock || 0), 0);
    const allOrders = (ordersRes.data || []) as unknown as Order[];
    const paidOrders = allOrders.filter((o) => o.payments?.some((p) => p.payment_status === "paid"));
    const totalRevenue = paidOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0);

    setStats({
      totalStock,
      totalOrders: allOrders.length,
      totalRevenue,
      lowStockCount: variantsLow.data?.length || 0,
    });
    setRecentOrders((recentRes.data || []) as unknown as Order[]);

    // Weekly sales - last 7 days
    const last7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return format(d, "yyyy-MM-dd");
    });
    const salesByDay: WeeklySales[] = last7.map((day) => {
      const dayOrders = allOrders.filter((o) => o.created_at?.startsWith(day));
      return {
        date: format(new Date(day), "EEE"),
        amount: dayOrders.reduce((s, o) => s + (o.total_amount || 0), 0),
      };
    });
    setWeeklySales(salesByDay);

    // Top categories
    const { data: orderItems, error: orderItemsError } = await supabase
      .from("order_items")
      .select("quantity, product_variant_id, product_variants(product_id, products(category_id, categories(name)))");

    if (orderItemsError) {
      toast.error("Failed to load category sales data");
      setLoading(false);
      return;
    }

    const catMap: Record<string, number> = {};
    ((orderItems || []) as unknown as OrderItemRaw[]).forEach((item) => {
      const catName = item.product_variants?.products?.categories?.name || "Uncategorized";
      catMap[catName] = (catMap[catName] || 0) + item.quantity;
    });
    setTopCategories(
      Object.entries(catMap)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5)
    );

    setLoading(false);
  }

  async function viewOrder(order: Order) {
    setSelectedOrder(order);
    const { data: items, error } = await supabase
      .from("order_items")
      .select("*, product_variants(size, color, sku, stock, products(name))")
      .eq("order_id", order.id);

    if (error) {
      toast.error("Failed to load order details");
      return;
    }

    setOrderDetails((items || []) as unknown as OrderItem[]);
  }

  const COLORS = [
    "hsl(224, 60%, 25%)",
    "hsl(160, 60%, 40%)",
    "hsl(38, 92%, 50%)",
    "hsl(0, 84%, 60%)",
    "hsl(215, 16%, 47%)",
  ];

  const orderColumns: Column<Order>[] = [
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
        <Button variant="ghost" size="sm" onClick={() => viewOrder(r)} title="View Details">
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Stock" value={stats.totalStock} icon={Package} />
        <StatCard title="Total Orders" value={stats.totalOrders} icon={ShoppingCart} />
        <StatCard title="Total Revenue" value={`৳${stats.totalRevenue.toFixed(2)}`} icon={DollarSign} variant="success" />
        <StatCard title="Low Stock Alert" value={stats.lowStockCount} icon={AlertTriangle} variant="warning" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <div className="rounded-lg border bg-card p-4 sm:p-6">
          <h3 className="font-semibold mb-4">Weekly Sales</h3>
          <div className="h-[220px] sm:h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeklySales}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip formatter={(value: number) => [`৳${value.toFixed(2)}`, "Sales"]} />
              <Bar dataKey="amount" fill="hsl(224, 60%, 25%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4 sm:p-6">
          <h3 className="font-semibold mb-4">Top Selling Categories</h3>
          {topCategories.length > 0 ? (
            <div className="h-[220px] sm:h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={topCategories}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={75}
                  label={({ name }: { name: string }) => name}
                >
                  {topCategories.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-16">No sales data yet</p>
          )}
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-4">Recent Orders</h3>
        <DataTable
          columns={orderColumns}
          data={recentOrders}
          total={recentOrders.length}
          loading={loading}
        />
      </div>

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
                    <p>
                      <span className="text-muted-foreground">Name:</span>{" "}
                      {shipping?.name || selectedOrder.profiles?.name || "Guest"}
                    </p>
                    {shipping?.phone && (
                      <p className="flex items-center gap-1">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        {shipping.phone}
                      </p>
                    )}
                    {selectedOrder.profiles?.email && (
                      <p>
                        <span className="text-muted-foreground">Email:</span>{" "}
                        {selectedOrder.profiles.email}
                      </p>
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
                      {shipping.address && (
                        <p>
                          <span className="text-muted-foreground">Address:</span> {shipping.address}
                        </p>
                      )}
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
                      <span className="uppercase font-semibold">
                        {selectedOrder.payments?.[0]?.payment_method || "N/A"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Payment Status</span>
                      <Badge variant={paymentVariant(selectedOrder.payments?.[0]?.payment_status || "pending")}>
                        {selectedOrder.payments?.[0]?.payment_status || "pending"}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Order Status</span>
                      <Badge variant={statusVariant(selectedOrder.order_status)}>
                        {selectedOrder.order_status}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Date</span>
                      <span>{format(new Date(selectedOrder.created_at), "MMM dd, yyyy • hh:mm a")}</span>
                    </div>
                  </div>
                </div>

                {/* Order Items */}
                <div className="rounded-lg border p-4 space-y-2">
                  <h4 className="font-semibold text-sm flex items-center gap-2">
                    <Package className="h-4 w-4" /> Order Items
                  </h4>
                  <Separator />
                  {orderDetails.length === 0 && (
                    <p className="text-sm text-muted-foreground">No items found.</p>
                  )}
                  {orderDetails.map((item) => (
                    <div key={item.id} className="flex justify-between py-2 border-b last:border-0 text-sm">
                      <div>
                        <p className="font-medium">{item.product_variants?.products?.name || "Unknown Product"}</p>
                        <p className="text-xs text-muted-foreground">
                          {[item.product_variants?.size, item.product_variants?.color].filter(Boolean).join(" / ")}
                          {item.product_variants?.sku && (
                            <span className="ml-2 font-mono">SKU: {item.product_variants.sku}</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Stock: {item.product_variants?.stock}
                        </p>
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <p>{item.quantity} × ৳{Number(item.unit_price).toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">
                          = ৳{(item.quantity * item.unit_price).toFixed(2)}
                        </p>
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
    </div>
  );
}