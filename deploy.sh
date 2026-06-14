#!/usr/bin/env bash
# Deploy dbview. It reuses jira's already-materialized Oracle secrets (same ADB),
# so jira must have been deployed at least once (HOST_SECRETS_DIR populated).
# A persistent access password + cookie secret are generated once into
# /engineering/local/dbview.env (gitignored) and reused on every deploy.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"

SECRETS_STORE="/engineering/local/dbview.env"
if [ ! -f "$SECRETS_STORE" ]; then
  mkdir -p "$(dirname "$SECRETS_STORE")"
  {
    echo "DBVIEW_PASSWORD=$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)"
    echo "DBVIEW_COOKIE_SECRET=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)"
  } > "$SECRETS_STORE"
  chmod 600 "$SECRETS_STORE"
  echo "generated $SECRETS_STORE (access password stored there)"
fi
set -a; . "$SECRETS_STORE"; set +a

HOST_SECRETS_DIR="${HOST_SECRETS_DIR:-/run/emibs/jira}"
[ -f "$HOST_SECRETS_DIR/app.env" ] || { echo "ERROR: $HOST_SECRETS_DIR/app.env not found — deploy jira first (it materializes the ADB creds dbview reuses)." >&2; exit 1; }

HOST_SECRETS_DIR="$HOST_SECRETS_DIR" docker compose -f docker-compose.app.yml up -d --build
echo "dbview up on 127.0.0.1:6210. Access password is in $SECRETS_STORE"
