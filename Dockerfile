FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages packages
COPY apps apps
RUN npx tsc -b && npm run build -w @omnicore/web && npm prune --omit=dev

FROM node:22-bookworm-slim
# Filled in by scripts/update.sh and the GitHub release workflow; shown in /health and the app.
ARG GIT_SHA=unknown
ARG BUILT_AT=
LABEL org.opencontainers.image.title="OmniCore Workspace" \
      org.opencontainers.image.description="Self-hosted notes, tasks and Telegram nag reminders with local AI" \
      org.opencontainers.image.revision=$GIT_SHA
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    OMNICORE_GIT_SHA=$GIT_SHA \
    OMNICORE_BUILT_AT=$BUILT_AT
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/core/package.json packages/core/
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/core/migrations packages/core/migrations
COPY --from=build /app/apps/server/package.json apps/server/
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist
# Starts as root only long enough to create and hand over /data and /vault, then the app
# switches to an unprivileged user (PUID/PGID, or the owner of ./vault): apps/server/src/privileges.ts.
ENV OMNICORE_DOCKER=1 \
    OMNICORE_PROFILES= \
    DATABASE_PATH=/data/app.db \
    VAULT_PATH=/vault
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/server/dist/boot.js"]
