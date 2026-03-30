#!/usr/bin/env bash
# PredictionInsider — production-style start on Linux (VPS)
# Usage (after clone + npm install + .env with DATABASE_URL):
#   chmod +x scripts/start-vps.sh
#   ./scripts/start-vps.sh           # dev: docker db + db:init + npm run dev
#   ./scripts/start-vps.sh production # build + node dist (set PORT in .env)
#
# For managed Postgres (Neon, DO): skip docker — set DATABASE_URL only, then db:init + start.

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-dev}"

if command -v docker >/dev/null 2>&1 && [ -f docker-compose.yml ]; then
  echo "[start-vps] Starting local Postgres container..."
  docker compose up -d
  echo "[start-vps] Waiting for Postgres..."
  for i in $(seq 1 45); do
    if docker compose exec -T db pg_isready -U predictioninsider -d predictioninsider >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
fi

echo "[start-vps] init-db.sql (db:init) — skipping db:push; see drizzle.config.ts comment"
npm run db:init

if [ "$MODE" = "production" ]; then
  echo "[start-vps] npm run build..."
  npm run build
  export NODE_ENV=production
  echo "[start-vps] Starting dist/index.cjs (use PM2 in real deployment — see README.md)"
  node dist/index.cjs
else
  echo "[start-vps] npm run dev — http://127.0.0.1:${PORT:-5000}"
  npm run dev
fi
