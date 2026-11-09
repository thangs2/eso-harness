# Build context: eso/ui (compose builds with that directory).

FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY angular.json tsconfig.json tsconfig.app.json ./
COPY src ./src
COPY apps ./apps
COPY libs ./libs
COPY scripts ./scripts

RUN bun run build:ng

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

# The nginx server config is NOT baked: compose mounts deploy/docker/nginx.conf at
# /etc/nginx/conf.d/default.conf:ro so dev/staging/prod share one source of truth.
COPY --from=build /app/dist/control-plane/browser /usr/share/nginx/html

EXPOSE 8080

USER 101

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

LABEL org.opencontainers.image.title="eso-ui" \
      org.opencontainers.image.description="ESO control plane UI (Angular, served by nginx)" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.source="https://github.com/thangs2/eso-harness"
