# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter web...

FROM deps AS build
WORKDIR /app
COPY apps/web apps/web
RUN pnpm --filter web build
RUN cd apps/web/.output/server && pnpm install --prod --frozen-lockfile=false --ignore-workspace

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssh-client bash ca-certificates
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/apps/web/.output /app/.output

# Drizzle push dependencies
COPY apps/web/drizzle.config.ts /app/drizzle.config.ts
COPY apps/web/src/db/schema.ts /app/src/db/schema.ts
RUN npm install --no-save drizzle-kit@0.31.9 drizzle-orm@0.45.1 pg@8.18.0

COPY apps/web/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

RUN mkdir -p /app/data && chown node:node /app/data
ENV VPS_SSH_KNOWN_HOSTS_PATH=/app/data/sato-vps-known-hosts
VOLUME ["/app/data"]

EXPOSE 3000
USER node
CMD ["/app/entrypoint.sh"]
