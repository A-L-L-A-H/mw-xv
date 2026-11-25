FROM node:24-bookworm-slim AS build

RUN apt-get update \
    && apt-get install --yes --no-install-recommends python3 make g++ curl unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.5" \
    && ln -s /root/.bun/bin/bun /usr/local/bin/bun \
    && ln -s /root/.bun/bin/bunx /usr/local/bin/bunx
WORKDIR /workspace
COPY package.json bun.lock bunfig.toml ./
COPY apps/agent-observability/package.json ./apps/agent-observability/package.json
COPY apps/agent-sandbox/package.json ./apps/agent-sandbox/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/board/package.json ./apps/board/package.json
COPY apps/control-plane/package.json ./apps/control-plane/package.json
COPY apps/desktop/package.json ./apps/desktop/package.json
COPY apps/docs/package.json ./apps/docs/package.json
COPY apps/isp/package.json ./apps/isp/package.json
COPY apps/ui-catalog/package.json ./apps/ui-catalog/package.json
COPY apps/whatsapp/package.json ./apps/whatsapp/package.json
COPY packages/ai-evaluation/package.json ./packages/ai-evaluation/package.json
COPY packages/ai-mcp/package.json ./packages/ai-mcp/package.json
COPY packages/ai-runtime/package.json ./packages/ai-runtime/package.json
COPY packages/assets/package.json ./packages/assets/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/client/package.json ./packages/client/package.json
COPY packages/corpus/package.json ./packages/corpus/package.json
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
COPY packages/jobs/package.json ./packages/jobs/package.json
COPY packages/knowledge/package.json ./packages/knowledge/package.json
COPY packages/local-ai/package.json ./packages/local-ai/package.json
COPY packages/logger/package.json ./packages/logger/package.json
COPY packages/mcp-moonwitness/package.json ./packages/mcp-moonwitness/package.json
COPY packages/orm-ai/package.json ./packages/orm-ai/package.json
COPY packages/orm-a2a/package.json ./packages/orm-a2a/package.json
COPY packages/orm-automation-core/package.json ./packages/orm-automation-core/package.json
COPY packages/orm-base/package.json ./packages/orm-base/package.json
COPY packages/orm-bot-orchestrator/package.json ./packages/orm-bot-orchestrator/package.json
COPY packages/orm-catalog/package.json ./packages/orm-catalog/package.json
COPY packages/orm-cli/package.json ./packages/orm-cli/package.json
COPY packages/orm-clinical/package.json ./packages/orm-clinical/package.json
COPY packages/orm-cloud/package.json ./packages/orm-cloud/package.json
COPY packages/orm-compliance/package.json ./packages/orm-compliance/package.json
COPY packages/orm-content-factory/package.json ./packages/orm-content-factory/package.json
COPY packages/orm-crm/package.json ./packages/orm-crm/package.json
COPY packages/orm-ecommerce-sync/package.json ./packages/orm-ecommerce-sync/package.json
COPY packages/orm-governance/package.json ./packages/orm-governance/package.json
COPY packages/orm-helpdesk/package.json ./packages/orm-helpdesk/package.json
COPY packages/orm-income-ledger/package.json ./packages/orm-income-ledger/package.json
COPY packages/orm-integration/package.json ./packages/orm-integration/package.json
COPY packages/orm-isp/package.json ./packages/orm-isp/package.json
COPY packages/orm-knowledge/package.json ./packages/orm-knowledge/package.json
COPY packages/orm-notification/package.json ./packages/orm-notification/package.json
COPY packages/orm-observability/package.json ./packages/orm-observability/package.json
COPY packages/orm-organization/package.json ./packages/orm-organization/package.json
COPY packages/orm-project/package.json ./packages/orm-project/package.json
COPY packages/orm-public-services/package.json ./packages/orm-public-services/package.json
COPY packages/orm/package.json ./packages/orm/package.json
COPY packages/orm-request/package.json ./packages/orm-request/package.json
COPY packages/orm-rnd/package.json ./packages/orm-rnd/package.json
COPY packages/orm-sales/package.json ./packages/orm-sales/package.json
COPY packages/orm-sensor/package.json ./packages/orm-sensor/package.json
COPY packages/orm-sharia/package.json ./packages/orm-sharia/package.json
COPY packages/orm-signal/package.json ./packages/orm-signal/package.json
COPY packages/orm-sim/package.json ./packages/orm-sim/package.json
COPY packages/orm-storage/package.json ./packages/orm-storage/package.json
COPY packages/orm-subscription/package.json ./packages/orm-subscription/package.json
COPY packages/orm-whatsapp/package.json ./packages/orm-whatsapp/package.json
COPY packages/paas-template-pack-coolify/package.json ./packages/paas-template-pack-coolify/package.json
COPY packages/paas-template-pack-moonwitness/package.json ./packages/paas-template-pack-moonwitness/package.json
COPY packages/research/package.json ./packages/research/package.json
COPY packages/types/package.json ./packages/types/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/orm-workflow/package.json ./packages/orm-workflow/package.json
COPY packages/paas-template-pack-bigbear/package.json ./packages/paas-template-pack-bigbear/package.json
COPY packages/paas-template-pack-dokploy/package.json ./packages/paas-template-pack-dokploy/package.json
COPY packages/plan-taskos/package.json ./packages/plan-taskos/package.json
RUN --mount=type=cache,id=moonwitness-bun-cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM build AS api-deploy
RUN mkdir -p /deploy/api/node_modules/@moonwitness \
    && cp -R apps/api/package.json apps/api/dist /deploy/api/ \
    && cp -R node_modules/. /deploy/api/node_modules/ \
    && for pkg in packages/*; do \
         name=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$pkg/package.json','utf8')).name)"); \
         rm -rf "/deploy/api/node_modules/$name"; \
         mkdir -p "/deploy/api/node_modules/$(dirname "$name")"; \
         cp -R "$pkg" "/deploy/api/node_modules/$name"; \
       done \
    && node scripts/prepare-api-runtime-assets.mjs /deploy/api

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3000 \
    LOG_TO_FILE=false \
    LOG_PRETTY=false
RUN apt-get update \
    && apt-get upgrade --yes \
    && apt-get install --yes --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=api-deploy --chown=node:node /deploy/api ./
RUN mkdir -p /var/lib/moonwitness/attachments && chown node:node /var/lib/moonwitness/attachments
COPY --from=build --chown=node:node /workspace/corpus ./corpus
ENV MOONWITNESS_CORPUS_ROOT=/app/corpus
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/readyz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server.js"]

FROM build AS board-build
ARG NEXT_PUBLIC_SITE_URL
ENV BOARD_API_TARGET=http://api:3000 \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
RUN bun --filter @moonwitness/board build \
    && bun run board:budget

FROM node:24-bookworm-slim AS board-runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=8080
WORKDIR /app
COPY --from=board-build --chown=node:node /workspace/apps/board/.next/standalone ./
COPY --from=board-build --chown=node:node /workspace/apps/board/.next/static ./apps/board/.next/static
COPY --from=board-build --chown=node:node /workspace/apps/board/public ./apps/board/public
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/board/server.js"]


FROM runtime AS api
