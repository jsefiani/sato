#!/bin/sh
set -e
echo "Pushing database schema..."
npx drizzle-kit push --config=drizzle.config.ts
echo "Schema push complete. Starting app..."
exec node .output/server/index.mjs
