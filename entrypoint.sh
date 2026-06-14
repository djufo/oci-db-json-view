#!/bin/sh
# Load runtime DB secrets from SECRETS_DIR (the same tmpfs jira materializes:
# app.env + wallet/), then exec the app. Values may contain parens (the Oracle
# connect descriptor) so they are read literally, never shell-sourced. DBVIEW_*
# config comes from the container environment, not the secrets file.
set -e
SECRETS_DIR="${SECRETS_DIR:-/secrets}"

if [ -f "$SECRETS_DIR/app.env" ]; then
  while IFS='=' read -r k v; do
    case "$k" in ''|\#*) continue ;; esac
    case "$k" in ORA_*|TNS_ADMIN) export "$k=$v" ;; esac
  done < "$SECRETS_DIR/app.env"
fi
[ -d "$SECRETS_DIR/wallet" ] && export ORA_WALLET="$SECRETS_DIR/wallet"

exec "$@"
