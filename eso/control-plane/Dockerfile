# Build context: eso/control-plane (compose builds with that directory).
# The Bun runtime executes the TypeScript entrypoint directly; the tsc `dist/` output is not used.

FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM oven/bun:1-alpine AS runtime
WORKDIR /app

# The Bun app binds 127.0.0.1 only (src/common/http/server.ts, `host = '127.0.0.1'`),
# which is unreachable from outside the container. socat owns the public
# 0.0.0.0:8787 listener and forwards to the loopback app on 127.0.0.1:8788.
# This keeps the compose contract (container port 8787) without changing product
# source to alter the bind host.
RUN apk add --no-cache socat

ENV NODE_ENV=production ESO_PORT=8788

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./package.json
# Bun reads tsconfig.json for module resolution and decorator settings while it
# transpiles the TypeScript sources it runs.
COPY tsconfig.json ./tsconfig.json
COPY src ./src

# Source files are copied from a host tree that may be 0600; the runtime user must read them.
RUN chmod -R a+rX /app/src /app/package.json /app/tsconfig.json

USER bun

# The container contract is 8787; the Bun app itself listens on loopback:8788
# and is bridged by socat above.
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8787/health || exit 1

# Same entrypoint as eso/e2e/ui-smoke.e2e.mjs (`bun src/common/http/server.ts`);
# the image only sets ESO_PORT=8788 so socat can own the public 8787 port.
CMD ["sh", "-c", "socat TCP-LISTEN:8787,fork,reuseaddr TCP:127.0.0.1:8788 & exec bun src/common/http/server.ts"]

LABEL org.opencontainers.image.title="eso-control-plane" \
      org.opencontainers.image.description="ESO control plane (Bun/Fastify)" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.source="https://github.com/thangs2/eso-harness"
