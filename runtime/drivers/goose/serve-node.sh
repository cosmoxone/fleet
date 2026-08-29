#!/usr/bin/env bash
# Remote node side: expose goose serve on the LAN with TLS.
# Usage: GOOSE_SERVER__SECRET_KEY=<secret> ./serve-node.sh [port]
# Plain HTTP for trusted LAN: PLAIN_HTTP=1 GOOSE_SERVER__SECRET_KEY=<secret> ./serve-node.sh
set -euo pipefail

: "${GOOSE_SERVER__SECRET_KEY:?set GOOSE_SERVER__SECRET_KEY (the desktop client must use the same value)}"
PORT="${1:-3284}"

if [[ "${PLAIN_HTTP:-0}" == "1" ]]; then
  exec goose serve --host 0.0.0.0 --port "$PORT"
fi

exec goose serve --host 0.0.0.0 --port "$PORT" --tls
