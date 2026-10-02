# syntax=docker/dockerfile:1

FROM node:24-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
RUN npm ci --workspace frontend --include-workspace-root=false --no-audit --no-fund
COPY frontend/ ./frontend/
RUN npm run build --workspace frontend

FROM golang:1.27-alpine AS backend-build
WORKDIR /src
ENV CGO_ENABLED=0
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN go test ./... && go build -trimpath -ldflags="-s -w" -o /out/gank-api ./cmd/server

FROM alpine:3.24 AS production
RUN apk add --no-cache ca-certificates \
    && addgroup -S -g 10001 app \
    && adduser -S -D -H -u 10001 -G app app
WORKDIR /app
COPY --from=backend-build /out/gank-api /app/gank-api
COPY --from=frontend-build /app/frontend/dist /app/public
ENV PORT=3001 \
    STATIC_DIR=/app/public \
    GIN_MODE=release
USER 10001:10001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -T 2 -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1
ENTRYPOINT ["/app/gank-api"]
