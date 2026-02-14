import { defineConfig } from 'drizzle-kit'

try { require('dotenv').config({ path: ['.env.local', '.env'] }) } catch {}

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
})
