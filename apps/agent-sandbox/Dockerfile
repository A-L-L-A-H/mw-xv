# Build context: ./apps/agent-sandbox (the sidecar is self-contained by design).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN ./node_modules/.bin/tsc -p tsconfig.json

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
RUN addgroup -S mw && adduser -S mw -G mw \
  && mkdir -p /var/lib/agent-sandbox \
  && chown -R mw:mw /var/lib/agent-sandbox /app
USER mw
EXPOSE 3020
CMD ["node", "dist/server.js"]
