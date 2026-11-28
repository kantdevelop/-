FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl && corepack enable
# Manifests first so the install layer caches; pnpm needs every workspace package.json.
COPY package.json pnpm-workspace.yaml ./
COPY apps/bot/package.json apps/bot/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm --filter @viewonce/db generate

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/prisma ./prisma
# Apply migrations to the volume-mounted SQLite DB, then start the bot.
CMD ["sh", "-c", "./packages/db/node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma && node apps/bot/index.js"]
