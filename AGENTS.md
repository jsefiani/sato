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
pnpm --filter=web lint      # lint
pnpm --filter=web check     # format + lint fix
pnpm --filter=web test      # run tests
pnpm --filter=web dev       # dev server on port 3000
pnpm --filter=web build     # production build
```

Always use `pnpm --filter=web <script>` — never `cd` into the directory or run `eslint`/`vitest` directly.

## After making changes

Always run linting and formatting after any code changes: `pnpm --filter=web check` (format + lint fix).

After code changes, check whether any docs need updating (e.g. `apps/web/SECURITY.md` for security-related changes). Keep docs in sync with the implementation.
