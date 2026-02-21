# Security Architecture

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        Internet                                  │
│  ┌──────────┐  ┌─────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │  Stripe  │  │ Google OAuth│  │ OpenRouter │  │  Hetzner    │  │
│  └────┬─────┘  └──────┬──────┘  └──────┬─────┘  └──────┬──────┘  │
└───────┼───────────────┼────────────────┼───────────────┼─────────┘
        │               │                │               │
   webhooks          OAuth           API keys       server API
   (HMAC)          (OIDC)                           + snapshots
        │               │                │               │
┌───────┴───────────────┴────────────────┴───────────────┴─────────┐
│                    Coolify Server (tag:sato-server)              │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Sato Web App (TanStack Start + Nitro)                     │  │
│  │  ├── Better Auth (sessions, Google OAuth)                  │  │
│  │  ├── Drizzle ORM → PostgreSQL (SSL)                        │  │
│  │  ├── Stripe billing + webhook verification                 │  │
│  │  └── Tailscale API (ephemeral auth keys)                   │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────┬───────────────────────────────────────┘
                           │ Tailscale mesh (SSH on port 22 only)
          ┌────────────────┼────────────────┐
          │                │                │
    ┌─────┴─────┐    ┌─────┴─────┐    ┌─────┴─────┐
    │  User VPS │    │  User VPS │    │  User VPS │
    │ tag:sato- │    │ tag:sato- │    │ tag:sato- │
    │    vps    │    │    vps    │    │    vps    │
    └───────────┘    └───────────┘    └───────────┘
    (isolated — no VPS-to-VPS traffic)
```

Key points:

- The Coolify server is the sole control plane for all VPSes.
- VPSes communicate with the server only via Tailscale.
- VPSes are isolated from each other at both the Tailscale ACL and UFW layers.
- External services are accessed over HTTPS with appropriate verification.

---

## Implemented Measures

### Network & Infrastructure

- **Tailscale mesh for control plane traffic**: VPSes join a Tailscale tailnet with ephemeral, pre-authorized auth keys tagged `tag:sato-vps`. The Coolify server uses `tag:sato-server` and is the only node permitted to reach VPS SSH (`22`) and OpenClaw gateway (`18789`) over Tailscale (enforced by ACLs — see [Required Manual Setup](#required-manual-setup)).

- **VPS-to-VPS isolation**: Tailscale ACLs follow an implicit-deny model — no rule grants `tag:sato-vps` → `tag:sato-vps` access. Reference policy: [`infra/tailscale-acl.jsonc`](infra/tailscale-acl.jsonc).

- **Per-VPS Hetzner firewalls**: User VPS firewalls are deny-by-default for public inbound traffic. No public service ports are opened by default; a temporary SSH debug override can be enabled explicitly for incidents.

- **UFW on VPS (defense in depth)**: SSH and OpenClaw gateway traffic are allowed only on the Tailscale interface (`tailscale0`). Even if Tailscale ACLs are misconfigured, the OS firewall blocks public SSH and gateway access by default. Bootstrap applies these rules on a best-effort basis so provisioning does not fail if a legacy snapshot is missing `ufw`; the canonical snapshot must still include `ufw`.

- **OpenClaw gateway exposure model**: OpenClaw is configured with loopback binding, and remote control-plane access is provided through `tailscale serve` TCP forwarding (`127.0.0.1:18789` -> tailnet `:18789`). The gateway is not exposed on public interfaces.

- **Temporary debug override (opt-in only)**: For incident debugging, you can temporarily expose public SSH by setting `SNAPSHOT_DEBUG_PUBLIC_SSH=true` during snapshot build and `HETZNER_DEBUG_ALLOW_PUBLIC_SSH=true` at runtime (optionally restricting source CIDRs with `HETZNER_DEBUG_SSH_SOURCE_IPS`). This mode must be disabled after debugging.

- **Bootstrap checkpoints (phone-home)**: The cloud-init bootstrap script reports signed progress checkpoints (`started`, `tailscale_joined`, `gateway_ready`, `completed`, `failed`) back to the control plane, allowing setup diagnostics without opening public SSH.

- **Cloud-init hardening**: After bootstrap, the temporary OpenRouter key file is cleared (`> /etc/sato/openclaw.env`), and the Hetzner metadata endpoint is blocked via iptables (`-d 169.254.169.254 -j DROP`) to prevent credential leakage from the instance metadata service.

- **fail2ban on VPS snapshot**: Installed and enabled in the base snapshot to protect against brute-force attempts on any exposed service.

- **Automatic OS security patching**: `unattended-upgrades` is installed and configured in the VPS snapshot to apply security-only updates daily (`${distro_codename}-security`). Automatic reboot is disabled so OpenClaw is not disrupted. Older VPSes provisioned before this snapshot can be retroactively patched via the `enable-unattended-upgrades` maintenance action.

- **No `--accept-routes` on VPSes**: VPSes do not accept subnet routes from other Tailscale nodes, preventing lateral network access if another node advertises routes.

### Application Security

- **Security headers**: Static headers served on all routes via Nitro route rules (`vite.config.ts`):
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  - `Content-Security-Policy` set dynamically per request in `server.ts` with a cryptographic nonce (`crypto.randomBytes`). Each SSR response gets a unique `'nonce-<base64>'` in `script-src`, allowlisting TanStack Start's inline hydration scripts without `'unsafe-inline'`. Restrictive `default-src 'self'` with allowlisted Stripe/Google domains and `object-src 'none'`.

- **CSRF protection**: Origin header verification on all mutating API endpoints (`csrf.ts`). Requests without a matching `Origin` or `Referer` header are rejected with 403.

- **Rate limiting**: In-memory sliding window rate limiter (`rate-limit.ts`) with per-category limits:
  - `vps-provision`: 3 req / 10 min
  - `vps-unlock`: 30 req / min
  - `billing`: 10 req / min
  - `vps-status`: 60 req / min
  - `telegram`: 30 req / min
  - `stripe-webhook`: 100 req / min
  - `auth`: 10 req / min

- **Single-flight VPS provisioning**: Provisioning start is guarded by a per-user PostgreSQL advisory transaction lock plus an atomic status transition (`pending`/`failed`/`terminated` -> `provisioning`). Requests are denied while a VPS is `provisioning`, `bootstrapping`, `active`, or `cleanup_pending`.

- **Provisioning idempotency keys**: `POST /api/vps/provision` supports `Idempotency-Key` (validated server-side), persisted with provisioning jobs. Retries with the same key replay the original outcome instead of creating duplicate provider resources.

- **Database uniqueness guardrails for provisioning jobs**: `provisioning_job` enforces at most one in-progress `provision` job per user (partial unique index), plus unique `(user_id, idempotency_key)` for non-null keys.

- **Provider orphan mitigation**: Provisioning preflight cleans up lingering Hetzner resources by label (`app=sato`, `sato_user=<user>`) before creating new resources. A background sweeper periodically scans labeled resources against DB ownership and removes confirmed orphans.

- **API error sanitization**: Allowlist-based error message filtering (`api-error.ts`). Only pre-approved error messages are returned to clients; all others are replaced with `"Something went wrong"` and logged server-side. Applies to REST JSON responses, SSE error events, and nested fields like `lastError` inside successful response payloads.

- **Response data minimization**: Client-facing API payloads intentionally exclude infrastructure/provider details (for example server IDs, public/private IPs, region/server type, and low-level gateway probe diagnostics). Responses return only fields required for the current UI state.

### Authentication & Sessions

- **Better Auth**: Session-based authentication with Google OAuth (OIDC).
  - Session expiry: 7 days
  - Session rotation: every 24 hours
  - Trusted origins: restricted to `APP_URL`

- **Admin role**: Better Auth's built-in `admin` plugin adds a `role` column to the `user` table (default `'user'`). The `requireAdminSession()` helper checks `session.user.role === 'admin'` and rejects non-admin requests with 403. Admin-only endpoints (e.g., `POST /api/admin/vps/maintain`) use this check for authorization. Bootstrap: promote the first admin via a direct SQL `UPDATE "user" SET role = 'admin' WHERE email = '...'`, then use the plugin's `/admin/set-role` API for subsequent admins.

### Data Protection

- **Encrypted secrets at rest**: Sensitive values (e.g., Telegram bot tokens) are encrypted with AES-256-GCM before database storage (`crypto.ts`). Each encrypted value includes a unique IV and authentication tag.

- **OpenClaw data encrypted at rest**: During bootstrap, Sato creates an encrypted LUKS data container and mounts it at `/opt/openclaw` before OpenClaw starts. The OpenClaw runtime then reads/writes on the encrypted volume transparently. Provisioning fails closed if unlock or mount fails.

- **Provider backups disabled by default**: New VPS provisioning explicitly disables Hetzner automatic backups for user nodes until an encrypted backup/restore pipeline is rolled out.

- **Managed-trust boundary**: Encryption at rest protects offline disk/snapshot access, but does not prevent privileged access on a running VPS. Production operator access is restricted and audited.

- **Database SSL**: PostgreSQL connections use SSL with certificate validation by default (`rejectUnauthorized: true`). Opt-out via `DATABASE_SSL=false` for local development only.

- **Tailscale SSH authentication**: VPS SSH access uses Tailscale SSH — no private keys or known-hosts files. The Tailscale daemon authenticates connections based on node identity and ACL grants. SSH host key verification is handled at the WireGuard tunnel layer.

### Payment & Billing

- **Stripe webhook HMAC verification**: Webhooks are verified using HMAC-SHA256 with timing-safe comparison (`billing.ts`). Includes timestamp validation with a 5-minute tolerance window to prevent replay attacks.

- **Stripe event deduplication**: Processed webhook event IDs are stored in the `stripe_webhook_event` table. Duplicate events are silently skipped.

- **Duplicate subscription checkout prevention**: Subscription checkout creation is denied when the user already has an `active`/`trialing` subscription (checked in local billing state and Stripe customer subscriptions). Subscription Checkout Session creation also uses a scoped Stripe idempotency key to reduce duplicate sessions from rapid retries.

- **Dispute-triggered subscription cancellation**: On `charge.dispute.created`, the user's subscription is immediately canceled via the Stripe API. This revokes access through the existing access-control logic (`canceled` = `hasAccess: false`). The dispute details (ID, charge, amount, reason) are logged to the audit log. On `charge.dispute.closed`, the outcome (won/lost/withdrawn) is logged. If the dispute is won, the user can re-subscribe manually.

- **Early fraud warning logging**: On `radar.early_fraud_warning.created`, the warning details (charge, payment intent, fraud type) are logged to the audit log for manual investigation. Stripe reports that 80% of early fraud warnings become disputes if not proactively addressed.

### Validation & Configuration

- **Zod input validation**: All POST API endpoints validate request bodies with Zod schemas. Invalid input is rejected before any business logic executes.

- **Zod environment parsing**: All environment variables are validated at startup via a Zod schema (`env.ts`). Missing or malformed values cause an immediate crash with a descriptive error — no silent fallbacks.

### Observability

- **Audit logging**: Key events are written to the `audit_log` table with structured JSON metadata:
  - `vps.provisioned`, `vps.provisioning_failed`, `vps.destroyed`
  - `vps.orphan_sweep_succeeded`, `vps.orphan_sweep_partially_failed`
  - `vps.data_volume_unlocked`, `vps.data_volume_unlock_denied`
  - `vps.maintenance_succeeded`, `vps.maintenance_failed` (admin-triggered VPS maintenance)
  - Billing events (subscription changes, top-up purchases)
  - Stripe webhook processing

---

## Required Manual Setup

These items must be configured outside the codebase:

### 1. Tailscale ACLs

Apply the reference ACL policy from [`infra/tailscale-acl.jsonc`](infra/tailscale-acl.jsonc) in the Tailscale admin console **before** joining any devices with tags:

https://login.tailscale.com/admin/acls

This defines the `tag:sato-server` and `tag:sato-vps` tags, ensures VPS-to-VPS traffic is blocked, and permits the Coolify server to SSH into VPSes.

### 2. Install Tailscale on the Coolify Host

Open the **server terminal** in Coolify (Servers > your server > Terminal — not a container terminal) and run:

```sh
curl -fsSL https://tailscale.com/install.sh | bash
tailscale up --advertise-tags=tag:sato-server
```

The second command prints a URL — open it in your browser to authenticate with your Tailscale account. This is a one-time step; Tailscale persists across reboots.

Docker containers on the host can reach Tailscale IPs (`100.x.y.z`) through the default bridge NAT — no Docker networking changes needed.

### 3. `APP_ENCRYPTION_KEY` Generation

Generate a 32-byte base64-encoded encryption key:

```sh
openssl rand -base64 32
```

Set the result as `APP_ENCRYPTION_KEY` in your environment.

### 4. Stripe Webhook Endpoint

Configure a webhook endpoint in the Stripe dashboard pointing to:

```
https://<your-domain>/api/stripe/webhook
```

Subscribe to these events:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.trial_will_end`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `invoice.finalization_failed`
- `charge.dispute.created`
- `charge.dispute.closed`
- `radar.early_fraud_warning.created`

Set the signing secret as `STRIPE_WEBHOOK_SECRET`.

---

## Future Improvements

- **Redis-backed rate limiting**: The current in-memory rate limiter resets on deploy and doesn't share state across instances. A Redis backend would be needed for multi-instance deployments.

- **CSP report-uri endpoint**: Add a `report-uri` / `report-to` directive to the Content-Security-Policy header and an endpoint to collect CSP violation reports.

- **Automated VPS health monitoring**: Periodic health checks on provisioned VPSes to detect and alert on unresponsive or degraded instances.
