FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
WORKDIR /opt/autoclip
COPY deploy/local-worker/package.json ./package.json
COPY deploy/local-worker/package-lock.json ./package-lock.json
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY scripts/media-video-worker.mjs ./media-video-worker.mjs
USER node
ENV NODE_ENV=production
CMD ["node", "/opt/autoclip/media-video-worker.mjs"]
