# ---- Build stage ----
# Full Node image: has the toolchain (tsc via `npm run build`); discarded from
# the final image. Matches package.json engines.node ^22.7.5.
FROM node:22 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage ----
# Pinned by digest for reproducible, supply-chain-safe builds (node:22-alpine,
# v22.23.0, ~55 MB). This is a manual Milestone-1 pin: renew it via
# renovate/dependabot in a later milestone (documented, not implemented here).
# Future hardening: gcr.io/distroless/nodejs22 removes the shell + apk for a
# smaller attack surface, at the cost of debug ergonomics and a shell-based
# HEALTHCHECK (documented as a future upgrade, not implemented this milestone).
FROM node:22-alpine@sha256:ab07539e0988b63558ff621f5fbe1077054c39d9809112974fb79993949d41cd AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# Prod deps only (the 5 runtime deps). dist/index.js imports none of the dev
# toolchain, so node dist/index.js runs without tsx.
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist

# Container defaults. The env var is MCP_TRANSPORT (read by src/config.ts) — there
# is NO bare TRANSPORT variable. To run HTTP mode in a port-mapped container,
# override BOTH: -e MCP_TRANSPORT=http -e MCP_HTTP_HOST=0.0.0.0. The resulting
# SEC-02 `http_bound_non_loopback` WARN is expected and correct here — the Docker
# port mapping is the network trust boundary, not the in-container bind.
ENV MCP_TRANSPORT=stdio \
    MCP_HTTP_HOST=127.0.0.1 \
    MCP_HTTP_PORT=3000
EXPOSE 3000

# Run as non-root (SEC-16).
USER node

# HEALTHCHECK is intentionally OMITTED: the default transport is stdio, which has
# no HTTP server (so /health does not exist), and alpine ships no curl. A
# HEALTHCHECK curling /health would mark every default container unhealthy
# forever. Operators who flip MCP_TRANSPORT=http can add this (alpine has wget):
#   HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
#     CMD wget -qO- http://127.0.0.1:3000/health || exit 1

# Exec form (JSON array) makes node PID-1, so docker stop's SIGTERM reaches
# src/lifecycle/shutdown.ts → drain → process.exit(0) (exit 0, not a forced 137).
ENTRYPOINT ["node", "dist/index.js"]
