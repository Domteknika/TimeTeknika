FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json vite.config.ts index.html components.json ./
COPY src ./src
COPY public ./public
COPY web-assets ./web-assets
RUN pnpm build

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310 DATA_DIR=/app/data
WORKDIR /app
COPY --chown=node:node package.json pnpm-lock.yaml ./
RUN npm install --global pnpm@11.25.0 && pnpm install --prod --frozen-lockfile --ignore-scripts
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node drizzle ./drizzle
COPY --from=build --chown=node:node /app/dist/web ./dist/web
RUN find /app/server /app/public /app/scripts /app/drizzle /app/dist -type d -exec chmod 755 {} + \
    && find /app/server /app/public /app/scripts /app/drizzle /app/dist -type f -exec chmod 644 {} + \
    && mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:4310/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
