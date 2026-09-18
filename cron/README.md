# Supabase Keep-Alive Cron

This folder contains a scheduled job that fetches recent orders from Supabase every **2 hours**. It keeps the Supabase free-tier project active (projects pause after ~90 days without API activity) and mirrors the read-only order query used by the admin Sales page.

## How it runs

GitHub Actions workflow: [`.github/workflows/keep-alive-orders.yml`](../.github/workflows/keep-alive-orders.yml)

- **Schedule:** every 2 hours (`0 */2 * * *` UTC)
- **Manual run:** GitHub → Actions → **Supabase Keep-Alive** → **Run workflow**

## One-time setup: GitHub Secrets

In your repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Where to find it |
|--------|------------------|
| `SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API → **service_role** (secret key) |

**Important:** The service role key bypasses Row Level Security. Never put it in `VITE_*` variables, client code, or committed files. Only use it in GitHub Actions secrets or local `.env` for testing.

## Manual local test

```bash
cd cron
cp .env.example .env
# Edit .env with your real values

export $(grep -v '^#' .env | xargs)
node fetch-recent-orders.mjs
```

Expected output:

```
[2026-09-18T12:00:00.000Z] Fetched 5 recent order(s).
Latest: id=..., display_id=..., status=pending
```

Exit code `0` = success. Exit code `1` = failure (check URL/key).

## What the script does

1. Calls Supabase PostgREST: `GET /rest/v1/orders` with the 20 most recent orders
2. Selects: `id`, `display_id`, `order_status`, `total_amount`, `created_at`
3. Logs the count and latest order id (read-only — no writes)

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Missing required environment variable` | Add both secrets in GitHub Actions |
| `401` / `403` | Wrong service role key or URL |
| Workflow not running on schedule | GitHub disables scheduled workflows on inactive repos; push a commit or run manually once |
| Workflow permission error | Ensure Actions are enabled under repo Settings → Actions |

## Files

| File | Purpose |
|------|---------|
| `fetch-recent-orders.mjs` | Standalone Node script (no npm dependencies) |
| `.env.example` | Template for local testing |
