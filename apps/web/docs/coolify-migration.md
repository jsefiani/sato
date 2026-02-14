# Coolify Migration (Fresh DB)

This guide moves the `web` app from Railway to Hetzner + Coolify with a fresh PostgreSQL database.

## 1) Build the base infrastructure

1. Run the bootstrap script (recommended):

```bash
SKIP_CONFIRM=true bash apps/web/scripts/provision-foundation.sh
```

2. The script creates/reuses:
   - Hetzner private network
   - Bastion + WireGuard
   - Coolify VPS + base firewall rules
3. Restrict bastion SSH access to WireGuard peers only.
4. Keep assistant VPS ingress locked down (no public `22` or public gateway port exposure).

## 2) Install Coolify

1. Provision a separate Hetzner VPS for Coolify.
2. Install Coolify following its docs.
3. Keep Coolify dashboard private (WireGuard-only or strict allowlist).

## 3) Create a fresh PostgreSQL service in Coolify

1. Create a new PostgreSQL resource.
2. Save the generated `DATABASE_URL`.
3. Do not reuse old Railway data.

## 4) Create the `web` app in Coolify

Use Dockerfile deploy settings:

- Repository root as build context
- Dockerfile path: `apps/web/Dockerfile`
- Exposed port: `3000`

## 5) Configure environment variables

Use `apps/web/.env.example` as baseline and set production values.

Important values for this setup:

- `DATABASE_URL`
- `APP_URL`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `APP_ENCRYPTION_KEY`
- `OPENROUTER_PROVISIONING_KEY`
- `HETZNER_API_TOKEN`
- `HETZNER_SSH_KEY_ID`
- `HETZNER_SNAPSHOT_ID`
- `HETZNER_SSH_PRIVATE_KEY` (recommended in Coolify secret storage)
- `VPS_SSH_STRICT_HOST_KEY_CHECKING=accept-new`
- `VPS_SSH_KNOWN_HOSTS_PATH=/tmp/sato-vps-known-hosts`
- `VPS_SSH_BASTION_HOST` / `VPS_SSH_BASTION_USER` / `VPS_SSH_BASTION_PORT` (if bastion routing is enabled)

## 6) Initialize schema on the fresh DB

From your local repo:

```bash
DATABASE_URL="<coolify-postgres-url>" pnpm --filter web db:push
```

## 7) Deploy and verify

1. Deploy `web` in Coolify.
2. Confirm login works.
3. Confirm `/api/vps/provision` succeeds.
4. Confirm `/api/vps/status` and `/api/vps/verify` work for a new assistant.
5. Rotate old Railway-side secrets after successful cutover.
