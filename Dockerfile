# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build && npm prune --omit=dev

FROM debian:bookworm-slim AS runtime-base
RUN mkdir -p /app /data/cache /data/logs && \
    chown -R 65532:65532 /app /data

FROM gcr.io/distroless/nodejs20-debian12:nonroot
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV VOXEL_CACHE_DIR=/data/cache/voxels
ENV LOG_DIR=/data/logs
COPY --from=runtime-base --chown=nonroot:nonroot /data /data
COPY --from=build --chown=nonroot:nonroot /app/package.json ./package.json
COPY --from=build --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=build --chown=nonroot:nonroot /app/dist ./dist
EXPOSE 3001
CMD ["dist/server/index.js"]
