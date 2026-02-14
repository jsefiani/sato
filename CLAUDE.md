# Sato

## Package Manager
Always use `pnpm` — never npm or yarn.

## Code Comments
Avoid unnecessary comments. Only add comments to explain **why** something non-obvious was done — mostly workarounds and intentional trade-offs. Never comment what the code already says.

## Database
Favor Drizzle **relational queries** (`db.query.*`) over raw `select().from().where()` when possible.
