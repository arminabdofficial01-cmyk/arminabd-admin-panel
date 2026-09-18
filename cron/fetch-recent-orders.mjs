/**
 * Fetches recent orders from Supabase to keep the free-tier project active.
 * Run via GitHub Actions every 2 hours, or manually with env vars set.
 */

const ORDER_LIMIT = 20;

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function fetchRecentOrders() {
  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const params = new URLSearchParams({
    select: "id,display_id,order_status,total_amount,created_at",
    order: "created_at.desc",
    limit: String(ORDER_LIMIT),
  });

  const url = `${supabaseUrl}/rest/v1/orders?${params.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${body}`);
  }

  const orders = await response.json();
  if (!Array.isArray(orders)) {
    throw new Error("Unexpected response: expected an array of orders");
  }

  return orders;
}

async function main() {
  const startedAt = new Date().toISOString();

  try {
    const orders = await fetchRecentOrders();
    const sample = orders[0];

    console.log(`[${startedAt}] Fetched ${orders.length} recent order(s).`);
    if (sample) {
      console.log(
        `Latest: id=${sample.id}, display_id=${sample.display_id ?? "—"}, status=${sample.order_status}`
      );
    } else {
      console.log("No orders in database yet.");
    }

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${startedAt}] Keep-alive failed: ${message}`);
    process.exit(1);
  }
}

main();
