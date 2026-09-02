#!/usr/bin/env bash
# Production start for /desk when there is no hosted URL.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env ]]; then
  echo "Copy .env.example to .env and set DATABASE_URL first."
  exit 1
fi
if [[ ! -f dist/index.cjs ]]; then
  echo "Building…"
  npm run build
fi
export NODE_ENV=production
export PORT="${PORT:-5000}"
echo "Desk: http://127.0.0.1:${PORT}/desk"
exec node dist/index.cjs
