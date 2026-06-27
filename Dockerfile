FROM node:20-alpine AS ui-builder
WORKDIR /app
COPY ui/package.json ui/package-lock.json* ./ui/
WORKDIR /app/ui
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY ui ./
RUN npm run build

FROM golang:1.23-alpine AS api-builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY api ./api
RUN CGO_ENABLED=0 GOOS=linux go build -o /bin/dbview ./api/cmd/server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
COPY --from=api-builder /bin/dbview /dbview
COPY --from=ui-builder /app/ui/dist /ui
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENV PORT=6210
ENV SECRETS_DIR=/secrets
ENV DBVIEW_UI_DIR=/ui
EXPOSE 6210
ENTRYPOINT ["/entrypoint.sh"]
CMD ["/dbview"]
