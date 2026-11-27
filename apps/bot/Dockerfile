FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @viewonce/db generate && pnpm --filter @viewonce/bot install --prod

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/prisma ./prisma

CMD ["node", "apps/bot/index.js"]
