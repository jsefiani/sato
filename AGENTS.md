# Sato

## Package Manager

Always use `pnpm` — never npm or yarn.

## Code Comments

Avoid unnecessary comments. Only add comments to explain **why** something non-obvious was done — mostly workarounds and intentional trade-offs. Never comment what the code already says.

## Database (Drizzle)

Prefer **relational queries** via `db.query.*` (e.g. `findFirst`, `findMany`) over raw `select().from().where()` when possible.

## Function parameters

Prefer a **single object parameter** over multiple separate parameters for maintainability and readability (e.g. `fn({ a, b, c })` instead of `fn(a, b, c)` when there are several args or they may grow).

## Commands

```sh
pnpm --filter=web typecheck  # type-check
pnpm --filter=web lint       # lint
pnpm --filter=web check      # format + lint fix
pnpm --filter=web test       # run tests
pnpm --filter=web dev        # dev server on port 3000
pnpm --filter=web build      # production build
```

Always use `pnpm --filter=web <script>` — never `cd` into the directory or run `eslint`/`vitest` directly.

## UI Components (shadcn + Base UI)

shadcn is configured with the `base-vega` style, which uses **Base UI** (`@base-ui/react`) as the primitive library — **not Radix UI**. Never use `asChild`; use the `render` prop instead (e.g. `<Button render={<a href="/" />}>Link</Button>`). Don't add size classes to icons inside `<Button>` — the button variants already auto-size SVGs via `[&_svg]:size-*`.

## Colors & Styling

Never use Tailwind's default palette (`zinc-*`, `gray-*`, `red-*`, etc.) — it's reset. Only use semantic tokens defined in `apps/web/src/styles.css`.

## API Response Security (Server -> Client)

Default to **deny-by-default** for response fields. Only return data that is strictly required by the current UI state.

Never expose infrastructure/provider/internal details to the frontend unless there is a documented, user-facing requirement:

- IPs and hostnames (`ipv4Address`, `tailscaleIp`, internal URLs)
- infrastructure metadata (`region`, `serverType`, server/firewall IDs, cloud provider internals)
- provider internals and model identifiers (prefer display labels over provider-coded IDs in client payloads)
- low-level diagnostics (stack traces, raw probe/runtime errors, CLI output, detailed failure internals)
- secrets/tokens/keys or anything derived from them

When implementing API routes, SSE streams, loaders, or server functions:

- return explicit, minimal response shapes (avoid spreading internal objects/DB rows into responses)
- sanitize errors before returning them; log detailed errors server-side only
- use separate internal vs client response types when helpful (`Internal*` -> `Client*`)
- apply the same minimization rules to dev tools and admin endpoints exposed through the web UI

Before finishing a change that touches server/client boundaries, do a quick payload audit:

- identify every field returned to the browser
- remove fields not directly used by the UI
- verify no sensitive metadata can leak via success payloads, error payloads, or stream events

## After making changes

Always run type-checking, linting, and formatting after any code changes:

- `pnpm --filter=web typecheck` (type-check)
- `pnpm --filter=web check` (format + lint fix)

After code changes, check whether any docs need updating (e.g. `apps/web/SECURITY.md` for security-related changes). Keep docs in sync with the implementation.
