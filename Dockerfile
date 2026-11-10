# syntax=docker/dockerfile:1

# One linux/amd64 image: the NestJS backend serving the built Angular frontend.
ARG NODE_VERSION=22.22.3

FROM node:${NODE_VERSION}-slim AS build
ENV CI=true
RUN npm install --global pnpm@12.18.0
WORKDIR /app

# Install dependencies first so this layer is cached until the manifests change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
COPY shared/package.json shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
# Production dependencies only, for the runtime image.
RUN pnpm --filter @bankapp/backend deploy --prod /out

FROM node:${NODE_VERSION}-slim
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/public
WORKDIR /app

COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/frontend/dist/frontend/browser ./public

# Database and backups live here; mount a volume over it.
RUN mkdir /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "dist/main.js"]
