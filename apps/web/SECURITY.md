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
- VPSes communicate with the server only via Tailscale (no public SSH).
- VPSes are isolated from each other at both the Tailscale ACL and UFW layers.
- External services are accessed over HTTPS with appropriate verification.

---

## Implemented Measures

### Network & Infrastructure

- **Tailscale mesh for SSH control plane**: VPSes join a Tailscale tailnet with ephemeral, pre-authorized auth keys tagged `tag:sato-vps`. No public SSH ports are exposed. The Coolify server uses `tag:sato-server` and is the only node permitted to SSH into VPSes (enforced by ACLs — see [Required Manual Setup](#required-manual-setup)).

- **VPS-to-VPS isolation**: Tailscale ACLs follow an implicit-deny model — no rule grants `tag:sato-vps` → `tag:sato-vps` access. Reference policy: [`infra/tailscale-acl.jsonc`](infra/tailscale-acl.jsonc).

- **Per-VPS Hetzner firewalls**: Each VPS gets a dedicated Hetzner Cloud firewall allowing only ports 80 (HTTP), 443 (HTTPS), and 18789 (OpenClaw gateway) from the public internet.

- **UFW on VPS (defense in depth)**: The Tailscale interface (`tailscale0`) only allows TCP port 22 (SSH). Even if Tailscale ACLs are misconfigured, the OS firewall blocks non-SSH traffic between mesh nodes.

- **Cloud-init hardening**: After bootstrap, the `.env` file containing the OpenRouter API key is cleared (`> /opt/openclaw/.env`), and the Hetzner metadata endpoint is blocked via iptables (`-d 169.254.169.254 -j DROP`) to prevent credential leakage from the instance metadata service.

- **fail2ban on VPS snapshot**: Installed and enabled in the base snapshot to protect against brute-force attempts on any exposed service.

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
  - `billing`: 10 req / min
  - `vps-status`: 60 req / min
  - `telegram`: 10 req / min
  - `stripe-webhook`: 100 req / min
  - `auth`: 10 req / min

- **API error sanitization**: Allowlist-based error message filtering (`api-error.ts`). Only pre-approved error messages are returned to clients; all others are replaced with `"Something went wrong"` and logged server-side. Applies to REST JSON responses, SSE error events, and nested fields like `lastError` inside successful response payloads.

### Authentication & Sessions

- **Better Auth**: Session-based authentication with Google OAuth (OIDC).
  - Session expiry: 7 days
  - Session rotation: every 24 hours
  - Trusted origins: restricted to `APP_URL`

### Data Protection

- **Encrypted secrets at rest**: Sensitive values (e.g., Telegram bot tokens) are encrypted with AES-256-GCM before database storage (`crypto.ts`). Each encrypted value includes a unique IV and authentication tag.

- **Database SSL**: PostgreSQL connections use SSL with certificate validation by default (`rejectUnauthorized: true`). Opt-out via `DATABASE_SSL=false` for local development only.

- **Tailscale SSH authentication**: VPS SSH access uses Tailscale SSH — no private keys or known-hosts files. The Tailscale daemon authenticates connections based on node identity and ACL grants. SSH host key verification is handled at the WireGuard tunnel layer.

### Payment & Billing

- **Stripe webhook HMAC verification**: Webhooks are verified using HMAC-SHA256 with timing-safe comparison (`billing.ts`). Includes timestamp validation with a 5-minute tolerance window to prevent replay attacks.

- **Stripe event deduplication**: Processed webhook event IDs are stored in the `stripe_webhook_event` table. Duplicate events are silently skipped.

- **Dispute-triggered subscription cancellation**: On `charge.dispute.created`, the user's subscription is immediately canceled via the Stripe API. This revokes access through the existing access-control logic (`canceled` = `hasAccess: false`). The dispute details (ID, charge, amount, reason) are logged to the audit log. On `charge.dispute.closed`, the outcome (won/lost/withdrawn) is logged. If the dispute is won, the user can re-subscribe manually.

- **Early fraud warning logging**: On `radar.early_fraud_warning.created`, the warning details (charge, payment intent, fraud type) are logged to the audit log for manual investigation. Stripe reports that 80% of early fraud warnings become disputes if not proactively addressed.

### Validation & Configuration

- **Zod input validation**: All POST API endpoints validate request bodies with Zod schemas. Invalid input is rejected before any business logic executes.

- **Zod environment parsing**: All environment variables are validated at startup via a Zod schema (`env.ts`). Missing or malformed values cause an immediate crash with a descriptive error — no silent fallbacks.

### Observability

- **Audit logging**: Key events are written to the `audit_log` table with structured JSON metadata:
  - `vps.provisioned`, `vps.provisioning_failed`, `vps.destroyed`
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
